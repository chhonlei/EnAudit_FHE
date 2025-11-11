import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface EnergyAuditData {
  id: string;
  name: string;
  energyUsage: string;
  efficiencyScore: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface AuditAnalysis {
  energyScore: number;
  efficiencyDiff: number;
  compliance: number;
  riskLevel: number;
  potentialSavings: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [audits, setAudits] = useState<EnergyAuditData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingAudit, setCreatingAudit] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newAuditData, setNewAuditData] = useState({ name: "", usage: "", score: "" });
  const [selectedAudit, setSelectedAudit] = useState<EnergyAuditData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ usage: number | null; score: number | null }>({ usage: null, score: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [userHistory, setUserHistory] = useState<string[]>([]);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const auditsList: EnergyAuditData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          auditsList.push({
            id: businessId,
            name: businessData.name,
            energyUsage: businessId,
            efficiencyScore: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setAudits(auditsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createAudit = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingAudit(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating audit with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const usageValue = parseInt(newAuditData.usage) || 0;
      const businessId = `audit-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, usageValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newAuditData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newAuditData.score) || 0,
        0,
        "Energy Audit Data"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, `Created audit: ${newAuditData.name}`]);
      setTransactionStatus({ visible: true, status: "success", message: "Audit created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewAuditData({ name: "", usage: "", score: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingAudit(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      setUserHistory(prev => [...prev, `Decrypted audit: ${businessId}`]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available and ready!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const analyzeAudit = (audit: EnergyAuditData, decryptedUsage: number | null, decryptedScore: number | null): AuditAnalysis => {
    const usage = audit.isVerified ? (audit.decryptedValue || 0) : (decryptedUsage || audit.publicValue1 || 50);
    const score = audit.publicValue1 || 5;
    
    const baseEnergyScore = Math.min(100, Math.round((usage * 0.2 + score * 8) * 1.2));
    const timeFactor = Math.max(0.7, Math.min(1.3, 1 - (Date.now()/1000 - audit.timestamp) / (60 * 60 * 24 * 30)));
    const energyScore = Math.round(baseEnergyScore * timeFactor);
    
    const efficiencyDiff = Math.round(100 - (usage / 1000) * 10 + score * 5);
    const compliance = Math.round(score * 10 + Math.log(usage + 1) * 2);
    
    const riskLevel = Math.max(10, Math.min(90, (usage * 0.01 + (10 - score) * 8)));
    const potentialSavings = Math.min(95, Math.round((1000 - usage * 0.1) * 0.1 + score * 8));

    return {
      energyScore,
      efficiencyDiff,
      compliance,
      riskLevel,
      potentialSavings
    };
  };

  const renderDashboard = () => {
    const totalAudits = audits.length;
    const verifiedAudits = audits.filter(a => a.isVerified).length;
    const avgEfficiency = audits.length > 0 
      ? audits.reduce((sum, a) => sum + a.publicValue1, 0) / audits.length 
      : 0;
    
    const recentAudits = audits.filter(a => 
      Date.now()/1000 - a.timestamp < 60 * 60 * 24 * 7
    ).length;

    return (
      <div className="dashboard-panels">
        <div className="panel gradient-panel">
          <h3>Total Audits</h3>
          <div className="stat-value">{totalAudits}</div>
          <div className="stat-trend">+{recentAudits} this week</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>Verified Data</h3>
          <div className="stat-value">{verifiedAudits}/{totalAudits}</div>
          <div className="stat-trend">FHE Verified</div>
        </div>
        
        <div className="panel gradient-panel">
          <h3>Avg Efficiency</h3>
          <div className="stat-value">{avgEfficiency.toFixed(1)}/10</div>
          <div className="stat-trend">Encrypted Analysis</div>
        </div>
      </div>
    );
  };

  const renderAnalysisChart = (audit: EnergyAuditData, decryptedUsage: number | null, decryptedScore: number | null) => {
    const analysis = analyzeAudit(audit, decryptedUsage, decryptedScore);
    
    return (
      <div className="analysis-chart">
        <div className="chart-row">
          <div className="chart-label">Energy Score</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.energyScore}%` }}
            >
              <span className="bar-value">{analysis.energyScore}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Efficiency Difference</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${Math.min(100, analysis.efficiencyDiff)}%` }}
            >
              <span className="bar-value">{analysis.efficiencyDiff}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Compliance</div>
          <div className="chart-bar">
            <div 
              className="bar-fill" 
              style={{ width: `${analysis.compliance}%` }}
            >
              <span className="bar-value">{analysis.compliance}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Risk Level</div>
          <div className="chart-bar">
            <div 
              className="bar-fill risk" 
              style={{ width: `${analysis.riskLevel}%` }}
            >
              <span className="bar-value">{analysis.riskLevel}</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Savings Potential</div>
          <div className="chart-bar">
            <div 
              className="bar-fill savings" 
              style={{ width: `${analysis.potentialSavings}%` }}
            >
              <span className="bar-value">{analysis.potentialSavings}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const filteredAudits = audits.filter(audit => 
    audit.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    audit.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔋 Confidential Energy Audit</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">⚡</div>
            <h2>Connect Wallet to Start Energy Audit</h2>
            <p>Secure your energy data with fully homomorphic encryption technology</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Submit encrypted energy usage data</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Get privacy-preserving efficiency analysis</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Secure energy audit system loading</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading confidential energy data...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🔋 Confidential Energy Audit</h1>
          <span className="tagline">FHE-Powered Energy Efficiency Analysis</span>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            Test FHE System
          </button>
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Audit
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Energy Audit Analytics Dashboard</h2>
          {renderDashboard()}
        </div>
        
        <div className="search-section">
          <div className="search-bar">
            <input 
              type="text" 
              placeholder="Search audits by name or ID..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <span className="search-icon">🔍</span>
          </div>
          <div className="search-stats">
            Showing {filteredAudits.length} of {audits.length} audits
          </div>
        </div>
        
        <div className="content-panels">
          <div className="main-panel">
            <div className="section-header">
              <h2>Energy Audit Records</h2>
              <div className="header-actions">
                <button 
                  onClick={loadData} 
                  className="refresh-btn" 
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "🔄 Refresh"}
                </button>
              </div>
            </div>
            
            <div className="audits-list">
              {filteredAudits.length === 0 ? (
                <div className="no-audits">
                  <p>No energy audits found</p>
                  <button 
                    className="create-btn" 
                    onClick={() => setShowCreateModal(true)}
                  >
                    Create First Audit
                  </button>
                </div>
              ) : filteredAudits.map((audit, index) => (
                <div 
                  className={`audit-item ${selectedAudit?.id === audit.id ? "selected" : ""} ${audit.isVerified ? "verified" : ""}`} 
                  key={index}
                  onClick={() => setSelectedAudit(audit)}
                >
                  <div className="audit-header">
                    <div className="audit-title">{audit.name}</div>
                    <div className={`audit-status ${audit.isVerified ? "verified" : "pending"}`}>
                      {audit.isVerified ? "✅ Verified" : "🔓 Pending"}
                    </div>
                  </div>
                  <div className="audit-meta">
                    <span>Efficiency: {audit.publicValue1}/10</span>
                    <span>Date: {new Date(audit.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="audit-creator">By: {audit.creator.substring(0, 6)}...{audit.creator.substring(38)}</div>
                </div>
              ))}
            </div>
          </div>
          
          <div className="side-panel">
            <div className="user-history">
              <h3>Operation History</h3>
              <div className="history-list">
                {userHistory.slice(-5).map((entry, index) => (
                  <div key={index} className="history-item">
                    <span className="history-time">{new Date().toLocaleTimeString()}</span>
                    <span className="history-action">{entry}</span>
                  </div>
                ))}
                {userHistory.length === 0 && (
                  <div className="no-history">No operations yet</div>
                )}
              </div>
            </div>
            
            <div className="data-stats">
              <h3>Data Statistics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <span className="stat-label">Total Encrypted</span>
                  <span className="stat-number">{audits.length}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">FHE Verified</span>
                  <span className="stat-number">{audits.filter(a => a.isVerified).length}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Avg Score</span>
                  <span className="stat-number">
                    {audits.length > 0 ? (audits.reduce((sum, a) => sum + a.publicValue1, 0) / audits.length).toFixed(1) : '0.0'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateAudit 
          onSubmit={createAudit} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingAudit} 
          auditData={newAuditData} 
          setAuditData={setNewAuditData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedAudit && (
        <AuditDetailModal 
          audit={selectedAudit} 
          onClose={() => { 
            setSelectedAudit(null); 
            setDecryptedData({ usage: null, score: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedAudit.id)}
          renderAnalysisChart={renderAnalysisChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateAudit: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  auditData: any;
  setAuditData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, auditData, setAuditData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'usage') {
      const intValue = value.replace(/[^\d]/g, '');
      setAuditData({ ...auditData, [name]: intValue });
    } else {
      setAuditData({ ...auditData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-audit-modal">
        <div className="modal-header">
          <h2>New Energy Audit</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Energy Data Protection</strong>
            <p>Energy usage will be encrypted with homomorphic encryption</p>
          </div>
          
          <div className="form-group">
            <label>Facility Name *</label>
            <input 
              type="text" 
              name="name" 
              value={auditData.name} 
              onChange={handleChange} 
              placeholder="Enter facility name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Energy Usage (kWh, Integer only) *</label>
            <input 
              type="number" 
              name="usage" 
              value={auditData.usage} 
              onChange={handleChange} 
              placeholder="Enter energy usage..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Efficiency Score (1-10) *</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="score" 
              value={auditData.score} 
              onChange={handleChange} 
              placeholder="Enter efficiency score..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !auditData.name || !auditData.usage || !auditData.score} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Audit"}
          </button>
        </div>
      </div>
    </div>
  );
};

const AuditDetailModal: React.FC<{
  audit: EnergyAuditData;
  onClose: () => void;
  decryptedData: { usage: number | null; score: number | null };
  setDecryptedData: (value: { usage: number | null; score: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderAnalysisChart: (audit: EnergyAuditData, decryptedUsage: number | null, decryptedScore: number | null) => JSX.Element;
}> = ({ audit, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, renderAnalysisChart }) => {
  const handleDecrypt = async () => {
    if (decryptedData.usage !== null) { 
      setDecryptedData({ usage: null, score: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ usage: decrypted, score: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="audit-detail-modal">
        <div className="modal-header">
          <h2>Energy Audit Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="audit-info">
            <div className="info-item">
              <span>Facility:</span>
              <strong>{audit.name}</strong>
            </div>
            <div className="info-item">
              <span>Submitted by:</span>
              <strong>{audit.creator.substring(0, 6)}...{audit.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Audit Date:</span>
              <strong>{new Date(audit.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Efficiency Score:</span>
              <strong>{audit.publicValue1}/10</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Energy Data</h3>
            
            <div className="data-row">
              <div className="data-label">Energy Usage (kWh):</div>
              <div className="data-value">
                {audit.isVerified && audit.decryptedValue ? 
                  `${audit.decryptedValue} kWh (Verified)` : 
                  decryptedData.usage !== null ? 
                  `${decryptedData.usage} kWh (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(audit.isVerified || decryptedData.usage !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : audit.isVerified ? (
                  "✅ Verified"
                ) : decryptedData.usage !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Data"
                )}
              </button>
            </div>
          </div>
          
          {(audit.isVerified || decryptedData.usage !== null) && (
            <div className="analysis-section">
              <h3>Energy Efficiency Analysis</h3>
              {renderAnalysisChart(
                audit, 
                audit.isVerified ? audit.decryptedValue || null : decryptedData.usage, 
                null
              )}
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!audit.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;

