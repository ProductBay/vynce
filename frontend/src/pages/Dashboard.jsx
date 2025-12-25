import { useState, useEffect } from 'react';
import axios from 'axios';
import './Dashboard.css';

const API_URL = 'http://localhost:3001'; // Backend port

export default function Dashboard() {
  const [calls, setCalls] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, completed: 0 });
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);

  // Fetch calls on mount
  useEffect(() => {
    fetchCalls();
    const interval = setInterval(fetchCalls, 5000); // Refresh every 5s
    return () => clearInterval(interval);
  }, []);

  const fetchCalls = async () => {
    try {
      const response = await axios.get(`${API_URL}/api/calls`);
      setCalls(response.data || []);
      
      // Calculate stats
      const total = response.data.length;
      const active = response.data.filter(c => ['initiated', 'ringing', 'answered', 'dialing'].includes(c.status)).length;
      const completed = response.data.filter(c => c.status === 'completed').length;
      setStats({ total, active, completed });
    } catch (error) {
      console.error('Error fetching calls:', error);
    }
  };

  const handleCall = async (e) => {
    e.preventDefault();
    if (!phoneNumber.trim()) {
      alert('Please enter a phone number');
      return;
    }

    setLoading(true);
    try {
      const response = await axios.post(`${API_URL}/api/make-call`, {
        to: phoneNumber
      });
      
      console.log('Call initiated:', response.data);
      alert(`✅ Call started to ${phoneNumber}`);
      setPhoneNumber('');
      fetchCalls(); // Refresh list
    } catch (error) {
      console.error('Error making call:', error);
      alert('❌ Failed to make call: ' + (error.response?.data?.message || error.message));
    } finally {
      setLoading(false);
    }
  };

  const endCall = async (uuid) => {
    try {
      await axios.post(`${API_URL}/api/end-call`, { uuid });
      alert('Call ended');
      fetchCalls();
    } catch (error) {
      console.error('Error ending call:', error);
      alert('Failed to end call');
    }
  };

  return (
    <div className="dashboard">
      <h1>📞 Vynce Dashboard</h1>

      {/* Stats */}
      <div className="stats-grid">
        <div className="stat-card">
          <h3>Total Calls</h3>
          <p className="stat-value">{stats.total}</p>
        </div>
        <div className="stat-card active">
          <h3>Active Calls</h3>
          <p className="stat-value">{stats.active}</p>
        </div>
        <div className="stat-card">
          <h3>Completed</h3>
          <p className="stat-value">{stats.completed}</p>
        </div>
      </div>

      {/* Single Call Form */}
      <div className="call-form-section">
        <h2>Make a Call</h2>
        <form onSubmit={handleCall} className="call-form">
          <input
            type="tel"
            placeholder="Enter phone number (e.g., +15551234567)"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            disabled={loading}
            className="phone-input"
          />
          <button type="submit" disabled={loading} className="call-btn">
            {loading ? '📞 Calling...' : '📞 Call Now'}
          </button>
        </form>
      </div>

      {/* Calls Table */}
      <div className="calls-section">
        <h2>Live Calls ({calls.length})</h2>
        {calls.length === 0 ? (
          <p className="no-calls">No calls yet. Upload CSV or make a single call above.</p>
        ) : (
          <div className="table-container">
            <table className="calls-table">
              <thead>
                <tr>
                  <th>Number</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>UUID</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => (
                  <tr key={call.uuid || call.id}>
                    <td className="phone-col">{call.number}</td>
                    <td>
                      <span className={`status-badge ${call.status}`}>
                        {call.status}
                      </span>
                    </td>
                    <td>{new Date(call.createdAt).toLocaleTimeString()}</td>
                    <td className="uuid-col">{call.uuid?.substring(0, 8)}...</td>
                    <td>
                      {['initiated', 'ringing', 'answered', 'dialing'].includes(call.status) && (
                        <button 
                          onClick={() => endCall(call.uuid)}
                          className="end-btn"
                        >
                          End
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}