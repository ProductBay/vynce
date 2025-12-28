// src/pages/Dashboard.jsx
import { useState, useEffect } from "react";
import "./Dashboard.css";
import API_BASE_URL from "../api";
import { useAuth } from "../components/AuthContext";

export default function Dashboard() {
  const { authFetch } = useAuth();

  const [calls, setCalls] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, completed: 0 });
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loading, setLoading] = useState(false);

  // -----------------------------
  // FETCH CALLS (AUTHED)
  // -----------------------------
  const fetchCalls = async () => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/calls`);
      if (!res.ok) return;

      const data = await res.json().catch(() => ({}));
      const callsArray = Array.isArray(data)
        ? data
        : Array.isArray(data?.calls)
        ? data.calls
        : [];

      setCalls(callsArray);

      // Stats
      const total = callsArray.length;
      const active = callsArray.filter((c) =>
        ["initiated", "ringing", "answered", "dialing"].includes(c.status)
      ).length;
      const completed = callsArray.filter(
        (c) => c.status === "completed" || c.status === "ended"
      ).length;

      setStats({ total, active, completed });
    } catch (err) {
      console.error("Error fetching calls:", err);
    }
  };

  // -----------------------------
  // LOAD ON MOUNT
  // -----------------------------
  useEffect(() => {
    fetchCalls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------
  // MAKE SINGLE CALL
  // -----------------------------
  const handleCall = async (e) => {
    e.preventDefault();

    if (!phoneNumber.trim()) {
      alert("Please enter a phone number");
      return;
    }

    setLoading(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/api/make-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phoneNumber }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to make call");
      }

      setPhoneNumber("");
      fetchCalls();
    } catch (err) {
      console.error("Error making call:", err);
      alert(`❌ Failed to make call: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // -----------------------------
  // END CALL
  // -----------------------------
  const endCall = async (uuid) => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/end-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid }),
      });

      if (!res.ok) throw new Error("Failed to end call");
      fetchCalls();
    } catch (err) {
      console.error("Error ending call:", err);
      alert("Failed to end call");
    }
  };

  // -----------------------------
  // UI
  // -----------------------------
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

      {/* Single Call */}
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
            {loading ? "📞 Calling..." : "📞 Call Now"}
          </button>
        </form>
      </div>

      {/* Calls Table */}
      <div className="calls-section">
        <h2>Live Calls ({calls.length})</h2>

        {calls.length === 0 ? (
          <p className="no-calls">
            No calls yet. Upload CSV or make a single call above.
          </p>
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
                  <tr key={call.uuid}>
                    <td className="phone-col">{call.number}</td>
                    <td>
                      <span className={`status-badge ${call.status}`}>
                        {call.status}
                      </span>
                    </td>
                    <td>
                      {call.createdAt
                        ? new Date(call.createdAt).toLocaleTimeString()
                        : "-"}
                    </td>
                    <td className="uuid-col">
                      {call.uuid?.slice(0, 8)}…
                    </td>
                    <td>
                      {["initiated", "ringing", "answered", "dialing"].includes(
                        call.status
                      ) && (
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
