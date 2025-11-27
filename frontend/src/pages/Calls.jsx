import { useEffect, useState } from "react";
import axios from "axios";

export default function Calls() {
  const [calls, setCalls] = useState([]);

  useEffect(() => {
    axios.get("http://localhost:3000/api/calls").then((res) => setCalls(res.data));
  }, []);

  return (
    <div className="page-card">
      <h2>Call History</h2>
      {calls.length === 0 ? <p>No calls yet.</p> : (
        <table>
          <thead>
            <tr><th>Time</th><th>Number</th><th>Status</th><th>UUID</th></tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.uuid}>
                <td>{new Date(c.createdAt||Date.now()).toLocaleTimeString()}</td>
                <td>{c.number}</td>
                <td className={`status-${c.status}`}>{c.status}</td>
                <td>{c.uuid.slice(0,12)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}