import React, { useState, useEffect } from 'react';
import './CallList.css';
import API_BASE_URL from '../api';

export default function CallList() {
  const [calls, setCalls] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch calls from API
  const fetchCalls = async () => {
    try {
     const response = await fetch(`${API_BASE_URL}/api/calls`);
      if (response.ok) {
        const data = await response.json();
        setCalls(data);
      } else {
        console.error('Failed to fetch calls, status:', response.status);
      }
    } catch (error) {
      console.error('Error fetching calls:', error);
    }
  };


  
  // End a specific call
  const endCall = async (callUuid, phoneNumber) => {
    if (!window.confirm(`Are you sure you want to end the call to ${phoneNumber}?`)) {
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/end-call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uuid: callUuid }),
      });

      const result = await response.json();

      if (result.success) {
        console.log('✅ Call ended:', result.message);
        // Refresh the calls list
        fetchCalls();
      } else {
        alert(`❌ Failed to end call: ${result.message}`);
      }
    } catch (error) {
      console.error('❌ Error ending call:', error);
      alert(`❌ Error ending call: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Set up polling to refresh calls
  useEffect(() => {
    fetchCalls();
    const interval = setInterval(fetchCalls, 2000); // Refresh every 2 seconds
    return () => clearInterval(interval);
  }, []);

  // Status badges with colors and voicemail handling
  const getStatusBadge = (call) => {
    const statusConfig = {
      dialing: { class: 'status-dialing', text: 'Dialing...' },
      ringing: { class: 'status-ringing', text: 'Ringing' },
      initiated: { class: 'status-initiated', text: 'Initiated' },
      answered: { class: 'status-answered', text: 'Answered' },
      completed: { class: 'status-completed', text: 'Completed' },
      ended: { class: 'status-ended', text: 'Ended' },
      failed: { class: 'status-failed', text: 'Failed' },
      busy: { class: 'status-busy', text: 'Busy' },
      timeout: { class: 'status-timeout', text: 'Timeout' },
      voicemail: { class: 'status-voicemail', text: 'Voicemail' },
      unknown: { class: 'status-unknown', text: 'Unknown' }
    };

    let status = call?.status || 'unknown';
    let text = statusConfig[status]?.text || status;

    // Override for voicemail
    if (call?.voicemailDetected) {
      status = 'voicemail';
      text = call.voicemailLeft ? 'Voicemail Left' : 'Voicemail Detected';
    }

    const config = statusConfig[status] || statusConfig.unknown;
    return (
      <span className={`status-badge ${config.class}`}>
        {text}
        {call?.voicemailLeft ? ' 📝' : ''}
      </span>
    );
  };

  // Check if call can be ended
  const canEndCall = (status) => {
    const endableStatuses = ['dialing', 'ringing', 'initiated', 'answered'];
    return endableStatuses.includes(status);
  };

  // Format phone number for display
  const formatPhoneNumber = (phone) => {
    if (!phone) return 'Unknown';
    // Simple formatting for US numbers
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
  };

  return (
    <div className="call-list">
      <div className="call-list-header">
        <h2>Active Calls</h2>
        <button onClick={fetchCalls} disabled={isLoading} className="refresh-btn">
          🔄 Refresh
        </button>
      </div>

      {calls.length === 0 ? (
        <div className="no-calls">No active calls.</div>
      ) : (
        <div className="calls-container">
          {calls.map((call) => (
            <div className="call-card" key={call.uuid || call.id}>
              <div className="call-left">
                <div className="call-number">{formatPhoneNumber(call.number)}</div>
                <div className="call-details">
                  <div className="call-status">{getStatusBadge(call)}</div>
                  {call.name && <div className="call-name">{call.name}</div>}
                  {call.voicemailDetected && (
                    <div className="voicemail-info">
                      {call.voicemailLeft ? (
                        <span className="voicemail-left">✅ Voicemail left</span>
                      ) : (
                        <span className="voicemail-detected">🎯 Voicemail detected</span>
                      )}
                      {call.voicemailLeftAt && (
                        <span className="voicemail-time">
                          at {new Date(call.voicemailLeftAt).toLocaleTimeString()}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="call-actions">
                {canEndCall(call.status) && (
                  <button
                    onClick={() => endCall(call.uuid, call.number)}
                    disabled={isLoading}
                    className="end-call-btn"
                    title={`End call to ${call.number}`}
                  >
                    🛑 End Call
                  </button>
                )}

                {call.error && <div className="call-error">Error: {call.error}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
