import { useEffect, useState } from "react"
import axios from "axios"
import io from "socket.io-client"
import "../App.css"
import CallList from '../components/CallList.jsx';


const socket = io("http://localhost:3001")

export default function Dashboard() {
  const [calls, setCalls] = useState([])
  const [dialNumber, setDialNumber] = useState("")
  const [isCalling, setIsCalling] = useState(false)
  const [message, setMessage] = useState("")
  const [bulkCallStatus, setBulkCallStatus] = useState(null);
     const [stats, setStats] = useState({
    totalCalls: 0,
    activeCalls: 0,
    successRate: 0
  }); 
  useEffect(() => {
    axios.get("http://localhost:3000/api/calls").then((res) => setCalls(res.data))
    socket.on("callUpdate", (data) => setCalls((prev) => [data, ...prev]))
    return () => socket.disconnect()
  }, [])

  async function handleCall() {
    if (!dialNumber) return setMessage("Enter a phone number first.")
    setIsCalling(true)
    setMessage("")
    try {
      const res = await axios.post("http://localhost:3000/api/make-call", { to: dialNumber })
      if (res.data.success) {
        setMessage(`Outgoing call to ${dialNumber} started`)
        setDialNumber("")
      } else setMessage("Call failed.")
    } catch (err) {
      console.error(err)
      setMessage("Error contacting backend.")
    } finally {
      setIsCalling(false)
    }
  }

  async function handleEndCall(uuid) {
    try {
      await axios.post("http://localhost:3000/api/end-call", { uuid })
      setMessage(`Call ${uuid.slice(0, 12)}… ended`)
    } catch (err) {
      console.error(err)
      setMessage("Error ending call")
    }
  }
// Optional: Fetch real stats from API
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/calls');
        if (response.ok) {
          const calls = await response.json();
          const activeCalls = calls.filter(call => 
            ['dialing', 'ringing', 'initiated', 'answered'].includes(call.status)
          ).length;
          
          setStats(prev => ({
            ...prev,
            totalCalls: calls.length,
            activeCalls
          }));
        }
      } catch (error) {
        console.error('Error fetching stats:', error);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const active = calls.filter((c) => c.status === "ringing").length
  const answered = calls.filter((c) => c.status === "answered").length
  const completed = calls.filter((c) => c.status === "completed").length
 const handleBulkCallStart = (result) => {
    setBulkCallStatus({
      type: 'success',
      message: `🚀 Started bulk calls for ${result.count} numbers`,
      timestamp: new Date()
    });
    
    setTimeout(() => {
      setBulkCallStatus(null);
    }, 5000);
  };
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [bulkProgress, setBulkProgress] = useState(null);
    const refreshCalls = async () => {
      try {
        const res = await axios.get("http://localhost:3000/api/calls");
        setCalls(res.data);
      } catch (err) {
        console.error("Failed to refresh calls", err);
        setMessage("Error refreshing calls");
      }
    };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Live Calls Dashboard</h1>
        <p className="dashboard-subtitle">Real-time call monitoring and management</p>
      </div>

      {bulkCallStatus && (
        <div className={`status-banner ${bulkCallStatus.type}`}>
          {bulkCallStatus.message}
        </div>
      )}

      <div className="dashboard-grid">
        <div className="stat-card">
          <h3>Total Calls</h3>
          <p>{stats.totalCalls}</p>
          <div className="stat-trend trend-up">↑ 12% this week</div>
        </div>
        <div className="stat-card">
          <h3>Active Calls</h3>
          <p>{stats.activeCalls}</p>
          <div className="stat-trend">
            <span className="live-indicator">LIVE</span>
          </div>
        </div>
        <div className="stat-card">
          <h3>Success Rate</h3>
          <p>{stats.successRate}%</p>
          <div className="stat-trend trend-up">↑ 5% from last month</div>
        </div>
      </div>

      {calls.length === 0 && (
        <div style={{ textAlign: 'center', padding: '4rem', color: '#666' }}>
          No active calls. Upload CSV or dial single number!
        </div>
      )}

      {/* Dialer */}
      <section className="dialer-section">
        <input
          type="tel"
          placeholder="Enter number to call (e.g. +15038030780)"
          value={dialNumber}
          onChange={(e) => setDialNumber(e.target.value)}
        />
        <button onClick={handleCall} disabled={isCalling}>
          {isCalling ? "Calling..." : "Call"}
        </button>
      </section>

      {message && <p className="info-text">{message}</p>}

      <section className="stats-section">
        <div className="stat-box"><h2>Active</h2><span>{active}</span></div>
        <div className="stat-box"><h2>Answered</h2><span>{answered}</span></div>
        <div className="stat-box"><h2>Completed</h2><span>{completed}</span></div>
      </section>

      <section className="table-section">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Number</th>
              <th>Status</th>
              <th>UUID</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.uuid}>
                <td>{new Date(c.createdAt || Date.now()).toLocaleTimeString()}</td>
                <td>{c.number}</td>
                <td className={`status-${c.status}`}>{c.status}</td>
                <td>{c.uuid.slice(0, 12)}…</td>
                <td>
                  {c.status !== "completed" && (
                    <button onClick={() => handleEndCall(c.uuid)} className="end-btn">
                      End Call
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}