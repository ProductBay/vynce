import React, { useEffect, useState } from "react";
import { useAuth } from "../components/AuthContext";

export default function LicenseAuditTable({ tenantId = "" }) {
  const { authFetch } = useAuth();

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadLogs() {
    try {
      setLoading(true);
      setError("");

      const query = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : "";
      const res = await authFetch(`/api/admin/license/audit${query}`);
      const json = await res.json();

      if (!json.success) {
        throw new Error(json.message || "Failed to load audit logs");
      }

      setLogs(json.data || []);
    } catch (err) {
      console.error("Audit log load error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadLogs();
  }, [tenantId]);

  if (loading) {
    return <div className="audit-card">Loading audit history…</div>;
  }

  if (error) {
    return <div className="audit-card error">Failed to load audit logs: {error}</div>;
  }

  if (logs.length === 0) {
    return <div className="audit-card">No audit history found.</div>;
  }

  return (
    <section className="audit-card enterprise">
      <div className="audit-card-header">
        <div>
          <div className="license-section-kicker">Change History</div>
          <h3>License Audit History</h3>
          <p className="audit-subtitle">
            Full administrative trail for tenant access and commercial control changes.
          </p>
        </div>

        <div className="audit-count-pill">
          {logs.length} {logs.length === 1 ? "entry" : "entries"}
        </div>
      </div>

      <div className="audit-table-wrap">
        <table className="audit-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Company</th>
              <th>License</th>
              <th>Reason</th>
              <th>Performed By</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log._id}>
                <td>
                  <div className="audit-time">
                    <strong>{new Date(log.createdAt).toLocaleTimeString()}</strong>
                    <span>{new Date(log.createdAt).toLocaleDateString()}</span>
                  </div>
                </td>
                <td>
                  <span className={`audit-action ${log.action}`}>
                    {log.action.replace(/_/g, " ")}
                  </span>
                </td>
                <td>{log.target?.companyName || "Unknown"}</td>
                <td>{log.target?.licenseId || "—"}</td>
                <td>
                  {log.after?.reason ||
                    log.before?.reason ||
                    log.after?.reasonText ||
                    log.before?.reasonText ||
                    log.after?.suspendReasonCode ||
                    log.after?.suspendReasonText ||
                    log.after?.suspendReason ||
                    "—"}
                </td>
                <td>{log.performedBy?.email || "System"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
