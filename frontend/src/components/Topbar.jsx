import React, { useRef, useState } from 'react';
import './Topbar.css';
import { useAuth } from './AuthContext';

export default function Topbar({ onBulkCallStart }) {
  const fileInputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [csvData, setCsvData] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [singleCallModal, setSingleCallModal] = useState(false);
  const [singleCallNumber, setSingleCallNumber] = useState('');
  const [activeCall, setActiveCall] = useState(null);
  const [selectedScript, setSelectedScript] = useState(null);
  const [showScripts, setShowScripts] = useState(false);
  const [callNotes, setCallNotes] = useState('');
  const [callOutcome, setCallOutcome] = useState('');
  const { user, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Base URL for backend API (used by single-call endpoints)
  const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';  // Uses proxy '/api' or env
  
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('Please select a CSV file');
      return;
    }

    setSelectedFile(file);
    setIsLoading(true);

    try {
      const parsedData = await parseCSV(file);
      setCsvData(parsedData);
      setShowModal(true);
    } catch (error) {
      console.error('Error parsing CSV:', error);
      alert(`Error parsing CSV file: ${error.message}`);
    } finally {
      setIsLoading(false);
      event.target.value = '';
    }
  };

  const saveCallNotes = async () => {
  if (!activeCall) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/calls/${activeCall.uuid}/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: callNotes,
        scriptUsed: selectedScript?.name,
        outcome: callOutcome,
        followUpRequired: callOutcome === 'callback'
      }),
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Notes saved:', result.message);
      alert('✅ Call notes saved successfully!');
    } else {
      alert(`❌ Failed to save notes: ${result.message}`);
    }
  } catch (error) {
    console.error('❌ Error saving notes:', error);
    alert(`❌ Error saving notes: ${error.message}`);
  }
};

  const parseCSV = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target.result;
          const lines = text.split('\n').filter(line => line.trim());
          if (lines.length === 0) {
            reject(new Error('CSV file is empty'));
            return;
          }

          const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));

          const data = lines.slice(1).map((line, index) => {
            // Handle quoted values and commas within fields
            const values = [];
            let current = '';
            let inQuotes = false;

            for (let i = 0; i < line.length; i++) {
              const char = line[i];
              if (char === '"') {
                inQuotes = !inQuotes;
              } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
              } else {
                current += char;
              }
            }
            values.push(current.trim());

            const row = {};
            headers.forEach((header, i) => {
              row[header] = (values[i] || '').replace(/"/g, '');
            });

            // Find phone number field
            const phoneField = headers.find(h =>
              h.includes('phone') || h.includes('number') || h.includes('mobile') || h.includes('tel')
            );

            // Find name field
            const nameField = headers.find(h =>
              h.includes('name') || h.includes('fullname') || h.includes('contact')
            );

            return {
              id: index,
              ...row,
              phone: row[phoneField] || values[0] || '',
              name: row[nameField] || `Contact ${index + 1}`,
              rawData: row
            };
          }).filter(row => row.phone && row.phone.replace(/\D/g, '').length >= 10); // Basic phone validation

          if (data.length === 0) {
            reject(new Error('No valid phone numbers found in CSV. Please ensure your CSV has a column with phone numbers.'));
            return;
          }

          resolve(data);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  };

  const handleSchedule = () => {
    alert('Scheduling feature coming soon! The calls will be scheduled for later execution.');
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setSelectedFile(null);
    setCsvData([]);
  };

  const handleRunNow = async () => {
    if (!csvData.length) return;

    setIsLoading(true);
    try {
      const formData = new FormData();
      if (selectedFile) {
        formData.append('file', selectedFile);
      } else {
        // No file available; create a CSV blob from parsed data as a fallback
        const headers = Object.keys(csvData[0].rawData || {});
        const csvRows = [
          headers.join(','),
          ...csvData.map(r => headers.map(h => `"${(r.rawData[h] || '').replace(/"/g, '""')}"`).join(','))
        ];
        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
        formData.append('file', blob, 'contacts.csv');
      }

      const API_URL = `${API_BASE_URL}/api/upload-csv`;
      console.log('📤 Uploading to:', API_URL);

      const response = await fetch(API_URL, {
        method: 'POST',
        body: formData,
      });

      console.log('📨 Response status:', response.status, response.statusText);

      if (!response.ok) {
        let errorMessage = `Server returned ${response.status}: ${response.statusText}`;
        try {
          const errorText = await response.text();
          if (errorText) {
            errorMessage += ` - ${errorText}`;
          }
        } catch (e) {
          // ignore
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      console.log('✅ Bulk calls started:', result);

      if (onBulkCallStart) {
        onBulkCallStart(result);
      }

      alert(`✅ Successfully started bulk calls for ${result.count || csvData.length} numbers`);

      setShowModal(false);
      setSelectedFile(null);
      setCsvData([]);
    } catch (error) {
      console.error('❌ Error starting bulk calls:', error);
      alert(`❌ Error starting bulk calls: ${error.message}\n\nPlease make sure the server is running on port 3000.`);
    } finally {
      setIsLoading(false);
    }
  };

  // Single call functionality
  const handleSingleCallClick = () => {
    const number = prompt('Enter phone number to call:');
    if (number && number.trim()) {
      setSingleCallNumber(number.trim());
      makeSingleCall(number.trim());
    }
  };

  const makeSingleCall = async (number) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/make-call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to: number }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const result = await response.json();
      console.log('✅ Single call initiated:', result);

      setActiveCall(result.data || null);
      setSingleCallModal(true);

    } catch (error) {
      console.error('❌ Error making single call:', error);
      alert(`❌ Error making call: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

const endSingleCall = async () => {
  if (!activeCall) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/end-call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uuid: activeCall.uuid }),
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Call ended:', result.message);
      // Show success message
      alert(`✅ ${result.message}`);
      
      setSingleCallModal(false);
      setActiveCall(null);
      setSingleCallNumber('');
    } else {
      alert(`❌ Failed to end call: ${result.message}`);
    }
  } catch (error) {
    console.error('❌ Error ending call:', error);
    alert(`❌ Error ending call: ${error.message}`);
  }
};
  const testServerConnection = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/health`);
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Server connection successful:', data);
        alert(`✅ Server is running!\n\n${data.message || ''}`);
      } else {
        throw new Error(`Server returned ${response.status}`);
      }
    } catch (error) {
      console.error('❌ Server connection failed:', error);
      alert(`❌ Cannot connect to server: ${error.message}\n\nPlease make sure:\n1. Your backend server is running\n2. It's on port 3000\n3. No other applications are using port 3000`);
    }
  };

  // Helper function to format phone number
  function formatPhoneNumber(phoneNumber) {
    if (!phoneNumber) return '';
    const cleaned = phoneNumber.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      return `${cleaned.slice(0, 1)}${cleaned.slice(1, 4)}-${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    } else if (cleaned.length === 10) {
      return `1${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phoneNumber;
  }

  return (
    <>
          <header className="topbar">
        <h1>Vynce Dashboard</h1>
        <div className="topbar-actions">
          {/* Usage indicator */}
          {user?.subscription && (
            <div className="usage-indicator">
              <span className="usage-text">
                {user.subscription.usedCalls} / {user.subscription.maxCalls} calls
              </span>
              <div className="usage-bar">
                <div 
                  className="usage-progress"
                  style={{ 
                    width: `${(user.subscription.usedCalls / user.subscription.maxCalls) * 100}%` 
                  }}
                ></div>
              </div>
            </div>
          )}

          {/* CSV Upload Button */}
          <button
            className="csv-upload-btn"
            onClick={handleUploadClick}
            disabled={isLoading}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
            {isLoading ? 'Processing...' : 'Upload CSV'}
          </button>

          <button
            className="test-connection-btn"
            onClick={testServerConnection}
            title="Test server connection"
            disabled={isLoading}
            style={{ marginLeft: 8 }}
          >
            Test Connection
          </button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".csv"
            style={{ display: 'none' }}
          />

      <div className="user-menu-container">
        <button 
          className="user-menu-btn"
          onClick={() => setShowUserMenu(!showUserMenu)}
        >
          <div className="user-avatar">
            {user?.firstName?.charAt(0)}{user?.lastName?.charAt(0)}
          </div>
          <span>{user?.firstName} {user?.lastName}</span>
          <span className="dropdown-arrow">▾</span>
        </button>

        {showUserMenu && (
          <div className="user-dropdown">
            <div className="user-info">
              <div className="user-name">{user.firstName} {user.lastName}</div>
              <div className="user-email">{user.email}</div>
              <div className="user-plan">
                Plan: <span className="plan-badge">{user.subscription?.plan}</span>
              </div>
            </div>
            <div className="dropdown-divider"></div>
            <a href="/billing" className="dropdown-item">
              💳 Billing & Plans
            </a>
            <a href="/settings" className="dropdown-item">
              ⚙️ Settings
            </a>
            <div className="dropdown-divider"></div>
            <button className="dropdown-item logout-btn" onClick={logout}>
              🚪 Sign Out
            </button>
          </div>
        )}
      </div>
    </div>
  </header>

      {/* Backdrop for closing dropdown */}
      {showUserMenu && (
        <div 
          className="dropdown-backdrop"
          onClick={() => setShowUserMenu(false)}
        />
      )}

      {/* Single Call Modal */}
      {singleCallModal && (
  <div className="call-modal-overlay">
    <div className="call-modal">
      <div className="call-modal-content">
        <div className="call-status-header">
          <div className="call-status-icon">📞</div>
          <h2>Outgoing Call</h2>
        </div>
        
        <div className="call-number-display">
          {formatPhoneNumber(singleCallNumber)}
        </div>
        
        <div className="call-status-info">
          <div className="status-indicator">
            <span className="pulse-dot"></span>
            <span>Calling...</span>
          </div>
          <div className="call-timer">
            Started at {new Date().toLocaleTimeString()}
          </div>
        </div>

        {/* Script Section */}
        <div className="call-script-section">
          <div className="script-header">
            <h4>Call Script</h4>
            <button 
              className="script-toggle-btn"
              onClick={() => setShowScripts(!showScripts)}
            >
              {showScripts ? 'Hide Scripts' : 'Show Scripts'}
            </button>
          </div>
          
          {showScripts && (
            <div className="scripts-panel">
              <ScriptsPanel 
                onScriptSelect={setSelectedScript}
                selectedScript={selectedScript}
              />
            </div>
          )}
          
          {selectedScript && (
            <div className="selected-script">
              <h5>{selectedScript.name}</h5>
              <div className="script-content">
                {selectedScript.content}
              </div>
            </div>
          )}
        </div>

        {/* Notes Section */}
        <div className="call-notes-section">
          <h4>Call Notes</h4>
          <textarea
            placeholder="Take notes during the call..."
            value={callNotes}
            onChange={(e) => setCallNotes(e.target.value)}
            rows="3"
            className="notes-textarea"
          />
          
          <div className="outcome-selection">
            <label>Outcome:</label>
            <select 
              value={callOutcome} 
              onChange={(e) => setCallOutcome(e.target.value)}
            >
              <option value="">Select outcome...</option>
              <option value="interested">Interested</option>
              <option value="not_interested">Not Interested</option>
              <option value="callback">Callback Requested</option>
              <option value="no_answer">No Answer</option>
              <option value="voicemail">Left Voicemail</option>
              <option value="wrong_number">Wrong Number</option>
            </select>
          </div>
        </div>
        
        <div className="call-modal-actions">
          <button 
            className="save-notes-btn"
            onClick={saveCallNotes}
          >
            💾 Save Notes
          </button>
          <button 
            className="end-call-cta"
            onClick={endSingleCall}
          >
            🛑 End Call
          </button>
        </div>
      </div>
    </div>
  </div>
)}


      {/* CSV Preview Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h2>CSV Preview</h2>
              <button className="close-btn" onClick={handleCloseModal}>×</button>
            </div>

            <div className="modal-body">
              <div className="file-info">
                <strong>File:</strong> {selectedFile?.name}
                <br />
                <strong>Contacts:</strong> {csvData.length} valid numbers found
                <br />
                <small>First call will start immediately after clicking "Run Now"</small>
              </div>

              <div className="preview-table-container">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Name</th>
                      <th>Phone</th>
                      <th>Other Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvData.slice(0, 10).map((row, index) => (
                      <tr key={row.id}>
                        <td>{index + 1}</td>
                        <td>{row.name}</td>
                        <td className="phone-number">{row.phone}</td>
                        <td className="other-data">
                          {Object.entries(row.rawData || {})
                            .filter(([key]) => !['id', 'name', 'phone'].includes(key) && (row.rawData || {})[key])
                            .map(([key, val]) => (
                              <div key={key}><strong>{key}:</strong> {val}</div>
                            ))
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="modal-footer">
                <button
                  className="btn-secondary"
                  onClick={handleCloseModal}
                  disabled={isLoading}
                >
                  Cancel
                </button>
                <button
                  className="btn-schedule"
                  onClick={handleSchedule}
                  disabled={isLoading}
                >
                  Schedule
                </button>
                <button
                  className="btn-primary"
                  onClick={handleRunNow}
                  disabled={isLoading}
                >
                  {isLoading ? 'Starting Calls...' : `Run Now (${csvData.length} calls)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}