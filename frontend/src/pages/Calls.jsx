import React, { useEffect, useMemo, useState } from "react";
import "./Calls.css";
import { useAppContext } from "../contexts/AppContext";
import { useLicenseGuard } from "../hooks/useLicenseGuard";
import LicenseBanner from "../components/LicenseBanner";

const ACTIVE_STATUSES = ["dialing", "ringing", "answered", "initiated"];

function getCallType(call) {
  if (!call) return "single";
  if (call.callType === "bulk") return "bulk";
  if (call.callType === "single") return "single";

  const source = call.source || call.metadata?.source;
  if (
    source &&
    (source.includes(".csv") ||
      source.includes("CSV") ||
      source.toLowerCase().includes("upload"))
  ) {
    return "bulk";
  }

  if (call.csvRowId !== undefined || call.batchId) {
    return "bulk";
  }

  return "single";
}

function formatContactInfo(call) {
  if (!call) return { name: null, address: "", hasName: false };

  const metadata = call.metadata || {};
  const rawName = metadata.name || metadata.firstName || metadata.contactName;
  const hasName = Boolean(rawName && rawName !== "Unknown" && rawName.trim());
  const address = [metadata.address, metadata.city, metadata.state, metadata.zip]
    .filter((part) => part && part.trim() !== "")
    .join(", ");

  return {
    name: hasName ? rawName : null,
    address,
    hasName,
  };
}

function formatPhone(phone) {
  if (!phone) return "--";

  const clean = phone.toString().replace(/\D/g, "");
  if (clean.length === 11 && clean.startsWith("1")) {
    return `+1 (${clean.slice(1, 4)}) ${clean.slice(4, 7)}-${clean.slice(7)}`;
  }
  if (clean.length === 10) {
    return `(${clean.slice(0, 3)}) ${clean.slice(3, 6)}-${clean.slice(6)}`;
  }

  return phone;
}

function formatTime(date) {
  if (!date) return "--";
  return new Date(date).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDate(date) {
  if (!date) return "--";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDuration(call, currentTime) {
  if (call.duration && call.duration.includes(":")) return call.duration;

  if (ACTIVE_STATUSES.includes(call.status) && call.createdAt) {
    const diff = Math.floor(
      (currentTime - new Date(call.createdAt).getTime()) / 1000
    );
    return `${Math.floor(diff / 60)}:${String(diff % 60).padStart(2, "0")}`;
  }

  return call.duration || "0:00";
}

function getStatusBadge(status) {
  const statusStyles = {
    initiated: { bg: "#dbeafe", color: "#1d4ed8", icon: "Connecting", label: "Initiated" },
    dialing: { bg: "#fef3c7", color: "#92400e", icon: "Dialing", label: "Dialing" },
    ringing: { bg: "#e0e7ff", color: "#4338ca", icon: "Ringing", label: "Ringing" },
    answered: { bg: "#d1fae5", color: "#065f46", icon: "Live", label: "Answered" },
    completed: { bg: "#f3f4f6", color: "#374151", icon: "Done", label: "Completed" },
    ended: { bg: "#e5e7eb", color: "#6b7280", icon: "Ended", label: "Ended" },
    failed: { bg: "#fee2e2", color: "#991b1b", icon: "Failed", label: "Failed" },
    busy: { bg: "#fef3c7", color: "#92400e", icon: "Busy", label: "Busy" },
    voicemail: { bg: "#fae8ff", color: "#86198f", icon: "VM", label: "Voicemail" },
    queued: { bg: "#f0fdf4", color: "#166534", icon: "Queued", label: "Queued" },
  };

  const style = statusStyles[status] || statusStyles.ended;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "6px 14px",
        borderRadius: "20px",
        fontSize: "13px",
        fontWeight: "600",
        background: style.bg,
        color: style.color,
      }}
    >
      <span>{style.icon}</span>
      <span>{style.label}</span>
    </span>
  );
}

function getTypeBadge(type) {
  if (type === "bulk" || type === "csv") {
    return (
      <span
        style={{
          padding: "4px 10px",
          borderRadius: "12px",
          fontSize: "12px",
          fontWeight: "500",
          background: "#dbeafe",
          color: "#1d4ed8",
        }}
      >
        Bulk/CSV
      </span>
    );
  }

  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: "12px",
        fontSize: "12px",
        fontWeight: "500",
        background: "#f0fdf4",
        color: "#166534",
      }}
    >
      Single
    </span>
  );
}

export default function Calls() {
  const { calls, loadingCalls, endCall, saveCallNotes } = useAppContext();
  const { loading: licenseLoading, canCall, reason } = useLicenseGuard();
  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState("newest");
  const [selectedCalls, setSelectedCalls] = useState([]);
  const [showCallModal, setShowCallModal] = useState(false);
  const [activeCallId, setActiveCallId] = useState(null);
  const [callNotes, setCallNotes] = useState("");
  const [callOutcome, setCallOutcome] = useState("");
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [endingUuid, setEndingUuid] = useState(null);
  const [savingNotes, setSavingNotes] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const activeCall = useMemo(
    () => calls.find((call) => (call._id || call.uuid) === activeCallId) || null,
    [activeCallId, calls]
  );

  useEffect(() => {
    if (!activeCall) return;
    setCallNotes(activeCall.notes || "");
    setCallOutcome(activeCall.outcome || "");
  }, [activeCall]);

  const filteredCalls = useMemo(() => {
    let nextCalls = [...calls];

    if (filter === "active") {
      nextCalls = nextCalls.filter((call) => ACTIVE_STATUSES.includes(call.status));
    } else if (filter === "completed") {
      nextCalls = nextCalls.filter((call) =>
        ["completed", "ended"].includes(call.status)
      );
    } else if (filter === "failed") {
      nextCalls = nextCalls.filter((call) => ["failed", "busy"].includes(call.status));
    } else if (filter === "voicemail") {
      nextCalls = nextCalls.filter(
        (call) => call.status === "voicemail" || call.voicemailDetected
      );
    }

    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      nextCalls = nextCalls.filter(
        (call) =>
          (call.number || call.to || "").toLowerCase().includes(search) ||
          (call.metadata?.name || "").toLowerCase().includes(search) ||
          (call.status || "").toLowerCase().includes(search)
      );
    }

    if (sortBy === "oldest") {
      nextCalls.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else if (sortBy === "status") {
      const statusOrder = [
        "answered",
        "ringing",
        "dialing",
        "initiated",
        "queued",
        "completed",
        "ended",
        "failed",
      ];
      nextCalls.sort(
        (a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
      );
    } else {
      nextCalls.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    return nextCalls;
  }, [calls, filter, searchTerm, sortBy]);

  const stats = useMemo(
    () => ({
      total: calls.length,
      active: calls.filter((call) => ACTIVE_STATUSES.includes(call.status)).length,
      completed: calls.filter((call) => ["completed", "ended"].includes(call.status))
        .length,
      failed: calls.filter((call) => ["failed", "busy"].includes(call.status)).length,
      voicemail: calls.filter(
        (call) => call.status === "voicemail" || call.voicemailDetected
      ).length,
    }),
    [calls]
  );

  const openCallModal = (call) => {
    setActiveCallId(call._id || call.uuid);
    setShowCallModal(true);
  };

  const closeCallModal = () => {
    setShowCallModal(false);
    setActiveCallId(null);
  };

  const handleEndCall = async (uuid) => {
    if (!uuid) {
      alert("Call UUID is missing. Cannot end call.");
      return;
    }

    setEndingUuid(uuid);
    try {
      await endCall(uuid);
    } catch (error) {
      console.error("End call failed:", error);
      alert(`Failed to end call: ${error.message}`);
    } finally {
      setEndingUuid(null);
    }
  };

  const handleEndSelectedCalls = async () => {
    for (const uuid of selectedCalls.filter(Boolean)) {
      await handleEndCall(uuid);
    }
    setSelectedCalls([]);
  };

  const handleSaveCallNotes = async () => {
    if (!activeCall?.uuid) {
      alert("Cannot save notes, call ID is missing.");
      return;
    }

    setSavingNotes(true);
    try {
      await saveCallNotes({
        uuid: activeCall.uuid,
        content: callNotes,
        outcome: callOutcome,
      });
      alert("Notes saved successfully!");
      closeCallModal();
    } catch (error) {
      console.error("Failed to save notes:", error);
      alert(`Failed to save notes: ${error.message}`);
    } finally {
      setSavingNotes(false);
    }
  };

  const toggleCallSelection = (uuid) => {
    if (!uuid) return;
    setSelectedCalls((previous) =>
      previous.includes(uuid)
        ? previous.filter((selectedUuid) => selectedUuid !== uuid)
        : [...previous, uuid]
    );
  };

  const selectAllCalls = () => {
    if (selectedCalls.length === filteredCalls.length) {
      setSelectedCalls([]);
      return;
    }
    setSelectedCalls(filteredCalls.map((call) => call.uuid).filter(Boolean));
  };

  return (
    <div className="calls-page">
      {!licenseLoading && reason && <LicenseBanner message={reason} />}

      {licenseLoading && (
        <div style={{ marginBottom: 12, opacity: 0.7 }}>Checking license...</div>
      )}

      <div className="page-header">
        <div className="header-left">
          <h1>Calls Dashboard</h1>
          <p className="header-subtitle">
            Live view of all calls - Single and Bulk CSV
          </p>
        </div>
        <div className="header-right">
          {selectedCalls.length > 0 && (
            <button
              onClick={handleEndSelectedCalls}
              className="btn btn-danger"
              disabled={!canCall || licenseLoading}
            >
              End {selectedCalls.length} Calls
            </button>
          )}
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card total" onClick={() => setFilter("all")}>
          <div className="stat-icon">Stats</div>
          <div className="stat-content">
            <div className="stat-number">{stats.total}</div>
            <div className="stat-label">Total Calls</div>
          </div>
        </div>
        <div className="stat-card active" onClick={() => setFilter("active")}>
          <div className="stat-icon pulse">Live</div>
          <div className="stat-content">
            <div className="stat-number">{stats.active}</div>
            <div className="stat-label">Active Now</div>
          </div>
        </div>
        <div className="stat-card completed" onClick={() => setFilter("completed")}>
          <div className="stat-icon">Done</div>
          <div className="stat-content">
            <div className="stat-number">{stats.completed}</div>
            <div className="stat-label">Completed</div>
          </div>
        </div>
        <div className="stat-card failed" onClick={() => setFilter("failed")}>
          <div className="stat-icon">Fail</div>
          <div className="stat-content">
            <div className="stat-number">{stats.failed}</div>
            <div className="stat-label">Failed</div>
          </div>
        </div>
        <div className="stat-card voicemail" onClick={() => setFilter("voicemail")}>
          <div className="stat-icon">VM</div>
          <div className="stat-content">
            <div className="stat-number">{stats.voicemail}</div>
            <div className="stat-label">Voicemail</div>
          </div>
        </div>
      </div>

      <div className="controls-bar">
        <div className="filter-tabs">
          {[
            { key: "all", label: "All Calls" },
            { key: "active", label: "Active" },
            { key: "completed", label: "Completed" },
            { key: "failed", label: "Failed" },
            { key: "voicemail", label: "Voicemail" },
          ].map((entry) => (
            <button
              key={entry.key}
              className={`filter-btn ${filter === entry.key ? "active" : ""}`}
              onClick={() => setFilter(entry.key)}
            >
              {entry.label}
              {entry.key !== "all" && (
                <span className="filter-count">
                  {entry.key === "active"
                    ? stats.active
                    : entry.key === "completed"
                    ? stats.completed
                    : entry.key === "failed"
                    ? stats.failed
                    : stats.voicemail}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="controls-right">
          <div className="search-box">
            <span className="search-icon">Search</span>
            <input
              type="text"
              placeholder="Search by number, name, status..."
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            {searchTerm && (
              <button className="clear-search" onClick={() => setSearchTerm("")}>
                x
              </button>
            )}
          </div>

          <select
            className="sort-select"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value)}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="status">By Status</option>
          </select>
        </div>
      </div>

      <div className="calls-table-container">
        {loadingCalls ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading calls...</p>
          </div>
        ) : filteredCalls.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">Empty</div>
            <h3>No calls found</h3>
            <p>
              {filter !== "all"
                ? `No ${filter} calls. Try a different filter.`
                : "Upload a CSV or make a single call from the Topbar to get started."}
            </p>
            <button onClick={() => setFilter("all")} className="btn btn-primary">
              Show All Calls
            </button>
          </div>
        ) : (
          <table className="calls-table">
            <thead>
              <tr>
                <th className="checkbox-col">
                  <input
                    type="checkbox"
                    checked={
                      selectedCalls.length === filteredCalls.length &&
                      filteredCalls.length > 0
                    }
                    onChange={selectAllCalls}
                  />
                </th>
                <th>Contact</th>
                <th>Status</th>
                <th>Type</th>
                <th>Duration</th>
                <th>Started</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCalls.map((call) => {
                const contact = formatContactInfo(call);
                const uuid = call.uuid;

                return (
                  <tr
                    key={call._id || call.uuid}
                    className={selectedCalls.includes(call.uuid) ? "call-row selected" : "call-row"}
                    onClick={() => openCallModal(call)}
                  >
                    <td className="checkbox-col" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedCalls.includes(call.uuid)}
                        onChange={() => toggleCallSelection(call.uuid)}
                        disabled={!call.uuid}
                      />
                    </td>
                    <td className="contact-cell">
                      <div className="contact-info">
                        {contact.hasName ? (
                          <>
                            <div className="contact-name">{contact.name}</div>
                            <div className="contact-phone-sub">
                              {formatPhone(call.number || call.to)}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="contact-name" style={{ color: "#e2e8f0" }}>
                              {formatPhone(call.number || call.to)}
                            </div>
                            <div className="contact-sub-label">
                              {call.callType === "bulk" ? "Unknown Contact" : "Manual Dial"}
                            </div>
                          </>
                        )}
                        {contact.address && (
                          <div className="contact-address">{contact.address}</div>
                        )}
                      </div>
                    </td>
                    <td>{getStatusBadge(call.status)}</td>
                    <td>{getTypeBadge(getCallType(call))}</td>
                    <td
                      className="duration-cell"
                      style={{ fontWeight: "600", fontFamily: "monospace" }}
                    >
                      <span className="live-duration">
                        {formatDuration(call, currentTime)}
                        {ACTIVE_STATUSES.includes(call.status) && " live"}
                      </span>
                    </td>
                    <td className="time-cell">
                      <div className="time-info">
                        <span className="time">{formatTime(call.createdAt)}</span>
                        <span className="date">{formatDate(call.createdAt)}</span>
                      </div>
                    </td>
                    <td
                      className="actions-cell"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {ACTIVE_STATUSES.includes(call.status) ? (
                        <button
                          className="btn btn-end"
                          onClick={() => handleEndCall(uuid)}
                          disabled={!uuid || endingUuid === uuid}
                          title={!uuid ? "Missing call UUID" : "End call"}
                        >
                          {endingUuid === uuid ? "Ending..." : "End"}
                        </button>
                      ) : (
                        <button className="btn btn-view" onClick={() => openCallModal(call)}>
                          View
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="results-footer">
        Showing {filteredCalls.length} of {calls.length} calls
        {searchTerm && ` matching "${searchTerm}"`}
      </div>

      {showCallModal && activeCall && (
        <div className="modal-overlay" onClick={closeCallModal}>
          <div className="modal-content call-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Call Details</h2>
              <button className="close-btn" onClick={closeCallModal}>
                x
              </button>
            </div>

            <div className="modal-body">
              <div className="call-info-section">
                {(() => {
                  const contact = formatContactInfo(activeCall);
                  return contact.hasName ? (
                    <>
                      <div
                        className="call-customer-name"
                        style={{ fontSize: "1.8rem", fontWeight: 700, marginBottom: "0.5rem" }}
                      >
                        {contact.name}
                      </div>
                      <div
                        className="call-number-sub"
                        style={{
                          fontSize: "1.2rem",
                          fontFamily: "monospace",
                          color: "#94a3b8",
                        }}
                      >
                        {formatPhone(activeCall.number || activeCall.to)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        className="call-number-large"
                        style={{ fontSize: "2rem", fontWeight: 700, fontFamily: "monospace" }}
                      >
                        {formatPhone(activeCall.number || activeCall.to)}
                      </div>
                      <div
                        className="call-sub-label"
                        style={{ color: "#64748b", marginTop: "4px", fontStyle: "italic" }}
                      >
                        {getCallType(activeCall) === "bulk"
                          ? "Unknown Contact"
                          : "Manual Dial"}
                      </div>
                    </>
                  );
                })()}

                {activeCall.outcome && (
                  <div style={{ marginTop: "1rem", marginBottom: "0.5rem" }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "6px 12px",
                        borderRadius: "20px",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                        background:
                          activeCall.outcome === "interested"
                            ? "rgba(16, 185, 129, 0.2)"
                            : activeCall.outcome === "callback"
                            ? "rgba(245, 158, 11, 0.2)"
                            : "rgba(100, 116, 139, 0.2)",
                        color:
                          activeCall.outcome === "interested"
                            ? "#6ee7b7"
                            : activeCall.outcome === "callback"
                            ? "#fcd34d"
                            : "#94a3b8",
                        border:
                          activeCall.outcome === "interested"
                            ? "1px solid rgba(16, 185, 129, 0.4)"
                            : activeCall.outcome === "callback"
                            ? "1px solid rgba(245, 158, 11, 0.4)"
                            : "1px solid rgba(100, 116, 139, 0.4)",
                      }}
                    >
                      Outcome: {activeCall.outcome.replace(/_/g, " ").toUpperCase()}
                    </span>
                  </div>
                )}

                <div style={{ marginTop: "1.5rem" }}>{getStatusBadge(activeCall.status)}</div>

                <div className="call-meta-grid" style={{ marginTop: "2rem" }}>
                  {formatContactInfo(activeCall).address && (
                    <div className="meta-item">
                      <span className="meta-label">Address</span>
                      <span className="meta-value">
                        {formatContactInfo(activeCall).address}
                      </span>
                    </div>
                  )}
                  <div className="meta-item">
                    <span className="meta-label">Duration</span>
                    <span className="meta-value">
                      {formatDuration(activeCall, currentTime)}
                    </span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Type</span>
                    <span className="meta-value">{getTypeBadge(getCallType(activeCall))}</span>
                  </div>
                  <div className="meta-item">
                    <span className="meta-label">Started</span>
                    <span className="meta-value">{formatTime(activeCall.createdAt)}</span>
                  </div>
                </div>
              </div>

              <div className="notes-section">
                <h3>Call Notes</h3>
                <textarea
                  placeholder="Add notes about this call..."
                  value={callNotes}
                  onChange={(event) => setCallNotes(event.target.value)}
                  rows={4}
                />
                <div className="outcome-row">
                  <label>Outcome:</label>
                  <select
                    value={callOutcome}
                    onChange={(event) => setCallOutcome(event.target.value)}
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
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={closeCallModal}
                disabled={savingNotes || endingUuid === activeCall.uuid}
              >
                Close
              </button>

              <button
                className="btn btn-primary"
                onClick={handleSaveCallNotes}
                disabled={!activeCall.uuid || savingNotes}
              >
                {savingNotes ? "Saving..." : "Save Notes"}
              </button>

              {ACTIVE_STATUSES.includes(activeCall.status) && (
                <button
                  className="btn btn-danger"
                  onClick={() => handleEndCall(activeCall.uuid)}
                  disabled={!activeCall.uuid || endingUuid === activeCall.uuid}
                >
                  {endingUuid === activeCall.uuid ? "Ending..." : "End Call"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
