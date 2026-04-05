import React, { useEffect, useState } from "react";
import { useAuth } from "../../components/AuthContext";
import "../../styles/admin-license.css";

const DEFAULT_FILTERS = {
  eventType: "",
  matchedAs: "",
  callUuid: "",
  callId: "",
};

export default function AdminWebhookAudit() {
  const { authFetch, user } = useAuth();
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [disabledMessage, setDisabledMessage] = useState("");

  const parseResponseSafely = async (res) => {
    const raw = await res.text();

    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {
        success: false,
        message: raw || "Unexpected server response.",
      };
    }
  };

  const loadLogs = async (showRefreshState = false) => {
    try {
      setError("");
      setDisabledMessage("");

      if (showRefreshState) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const params = new URLSearchParams({ limit: "75" });
      if (filters.eventType) params.set("eventType", filters.eventType);
      if (filters.matchedAs) params.set("matchedAs", filters.matchedAs);
      if (filters.callUuid.trim()) params.set("callUuid", filters.callUuid.trim());
      if (filters.callId.trim()) params.set("callId", filters.callId.trim());

      const res = await authFetch(`/api/admin/vonage/webhook-audit?${params.toString()}`);
      const json = await parseResponseSafely(res);

      if (!res.ok) {
        if (res.status === 404) {
          setDisabledMessage(
            json.message || "Webhook audit logging is disabled for this environment."
          );
          setLogs([]);
          return;
        }

        throw new Error(json.message || "Failed to load webhook audit logs.");
      }

      if (!json.success) {
        throw new Error(json.message || "Failed to load webhook audit logs.");
      }

      setLogs(json.data || []);
    } catch (err) {
      setError(err.message || "Failed to load webhook audit logs.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadLogs(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFilters = async (event) => {
    event.preventDefault();
    await loadLogs(true);
  };

  const resetFilters = async () => {
    setFilters(DEFAULT_FILTERS);
    try {
      setRefreshing(true);
      setError("");
      setDisabledMessage("");
      const res = await authFetch("/api/admin/vonage/webhook-audit?limit=75");
      const json = await parseResponseSafely(res);

      if (!res.ok) {
        if (res.status === 404) {
          setDisabledMessage(
            json.message || "Webhook audit logging is disabled for this environment."
          );
          setLogs([]);
          return;
        }

        throw new Error(json.message || "Failed to load webhook audit logs.");
      }

      if (!json.success) {
        throw new Error(json.message || "Failed to load webhook audit logs.");
      }

      setLogs(json.data || []);
    } catch (err) {
      setError(err.message || "Failed to load webhook audit logs.");
    } finally {
      setRefreshing(false);
    }
  };

  if (!user || (user.role !== "admin" && !user.isSuperAdmin)) {
    return (
      <div className="license-page">
        <h2>Access Denied</h2>
        <p style={{ opacity: 0.75 }}>
          You do not have permission to review Vonage webhook audits.
        </p>
      </div>
    );
  }

  return (
    <div className="license-page">
      <div className="webhook-audit-header">
        <div>
          <h2>Vonage Webhook Audit</h2>
          <p className="webhook-audit-subtitle">
            Review staging webhook payloads and how the backend classified them.
          </p>
        </div>

        <button
          type="button"
          className="webhook-refresh-btn"
          onClick={() => loadLogs(true)}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <form className="webhook-filter-bar" onSubmit={applyFilters}>
        <select
          value={filters.eventType}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, eventType: e.target.value }))
          }
        >
          <option value="">All events</option>
          <option value="status">Status</option>
          <option value="voice">Voice</option>
        </select>

        <select
          value={filters.matchedAs}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, matchedAs: e.target.value }))
          }
        >
          <option value="">All matches</option>
          <option value="voicemail">Voicemail</option>
          <option value="human">Human</option>
          <option value="machine">Machine</option>
          <option value="unclassified">Unclassified</option>
        </select>

        <input
          type="text"
          placeholder="Call UUID"
          value={filters.callUuid}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, callUuid: e.target.value }))
          }
        />

        <input
          type="text"
          placeholder="Call ID"
          value={filters.callId}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, callId: e.target.value }))
          }
        />

        <button type="submit" className="webhook-apply-btn" disabled={refreshing}>
          Apply
        </button>
        <button type="button" className="webhook-clear-btn" onClick={resetFilters} disabled={refreshing}>
          Clear
        </button>
      </form>

      {loading ? <div className="audit-card">Loading webhook audit history...</div> : null}

      {!loading && disabledMessage ? (
        <div className="audit-card">
          <h3>Audit Logging Disabled</h3>
          <p>{disabledMessage}</p>
          <p className="webhook-audit-hint">
            Enable it in staging with <code>VONAGE_WEBHOOK_AUDIT=true</code>.
          </p>
        </div>
      ) : null}

      {!loading && error ? (
        <div className="audit-card error">
          Failed to load webhook audit logs: {error}
        </div>
      ) : null}

      {!loading && !disabledMessage && !error && logs.length === 0 ? (
        <div className="audit-card">
          No webhook audit entries found for the current filters.
        </div>
      ) : null}

      {!loading && !disabledMessage && !error && logs.length > 0 ? (
        <div className="audit-card webhook-audit-card">
          <h3>Recent Webhook Events</h3>

          <div className="webhook-audit-table-wrap">
            <table className="audit-table webhook-audit-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Match</th>
                  <th>Status</th>
                  <th>Identifiers</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log._id}>
                    <td>{new Date(log.createdAt).toLocaleString()}</td>
                    <td>
                      <span className={`webhook-chip webhook-chip-${log.eventType || "status"}`}>
                        {log.eventType || "status"}
                      </span>
                    </td>
                    <td>
                      <span className={`webhook-chip webhook-match-${log.matchedAs || "unclassified"}`}>
                        {log.matchedAs || "unclassified"}
                      </span>
                    </td>
                    <td>
                      <div>{log.status || "n/a"}</div>
                      <div className="webhook-substate">{log.subState || log.machineDetectionResult || ""}</div>
                    </td>
                    <td>
                      <div className="webhook-identifiers">
                        <strong>UUID</strong> {log.callUuid || "n/a"}
                      </div>
                      <div className="webhook-identifiers">
                        <strong>Call ID</strong> {log.callId || "n/a"}
                      </div>
                    </td>
                    <td>
                      <details className="webhook-details">
                        <summary>View payload</summary>
                        <pre>{JSON.stringify(log.request?.body || {}, null, 2)}</pre>
                        <pre>{JSON.stringify(log.request?.query || {}, null, 2)}</pre>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
