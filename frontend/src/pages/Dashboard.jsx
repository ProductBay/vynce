import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../components/AuthContext";
import { useAppContext } from "../contexts/AppContext";
import { useLicenseGuard } from "../hooks/useLicenseGuard";
import LicenseBanner from "../components/LicenseBanner";
import OnboardingChecklist from "../components/OnboardingChecklist";
import "./Dashboard.css";

const ACTIVE_STATUSES = ["dialing", "ringing", "answered", "initiated"];
const COMPLETED_STATUSES = ["completed", "ended"];

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

function formatContactInfo(call) {
  const metadata = call.metadata || {};
  const rawName = metadata.name || metadata.firstName || metadata.contactName;
  const hasName = Boolean(rawName && rawName !== "Unknown" && rawName.trim());
  const address = [metadata.address, metadata.city, metadata.state, metadata.zip]
    .filter(Boolean)
    .join(", ");

  return {
    hasName,
    name: hasName ? rawName : null,
    address,
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

function getCallType(call) {
  if (call.callType === "bulk" || call.type === "bulk" || call.source === "csv") {
    return "bulk";
  }
  return "single";
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
        padding: "4px 10px",
        borderRadius: "12px",
        fontSize: "12px",
        fontWeight: "500",
        background: style.bg,
        color: style.color,
      }}
    >
      <span>{style.icon}</span>
      <span>{style.label}</span>
    </span>
  );
}

export default function Dashboard() {
  const { user, authFetch } = useAuth();
  const { calls, loadingCalls, endCall, makeCall } = useAppContext();
  const {
    loading: licenseLoading,
    canSingleCall,
    reason,
  } = useLicenseGuard();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [endingUuid, setEndingUuid] = useState(null);
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const stats = useMemo(() => {
    const total = calls.length;
    const active = calls.filter((call) => ACTIVE_STATUSES.includes(call.status)).length;
    const completed = calls.filter((call) =>
      COMPLETED_STATUSES.includes(call.status)
    ).length;

    return { total, active, completed };
  }, [calls]);

  const handleCall = async (event) => {
    event.preventDefault();

    if (!phoneNumber.trim()) {
      alert("Please enter a phone number");
      return;
    }

    setSubmitting(true);
    try {
      await makeCall({
        to: phoneNumber,
        agent: `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
      });
      setPhoneNumber("");
    } catch (error) {
      console.error("Call error:", error);
      alert(`Failed to make call: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEndCall = async (uuid) => {
    if (!uuid) return;

    setEndingUuid(uuid);
    try {
      await endCall(uuid);
    } catch (error) {
      console.error("End call error:", error);
      alert(`Failed to end call: ${error.message}`);
    } finally {
      setEndingUuid(null);
    }
  };

  return (
    <div className="dashboard">
      <h1></h1>

      {!licenseLoading && reason ? <LicenseBanner message={reason} /> : null}

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

      <OnboardingChecklist authFetch={authFetch} />

      <div className="call-form-section">
        <h2>Make a Call</h2>
        <form onSubmit={handleCall} className="call-form">
          <input
            type="tel"
            placeholder="Enter phone number (e.g., +15551234567)"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
            disabled={submitting || !canSingleCall}
            className="phone-input"
          />
          <button
            type="submit"
            disabled={submitting || !canSingleCall || licenseLoading}
            className="call-btn"
            title={!canSingleCall ? reason || "Single calling is unavailable" : ""}
          >
            {submitting ? "Calling..." : "Call Now"}
          </button>
        </form>
      </div>

      <div className="calls-section">
        <h2>Live Calls ({calls.length})</h2>

        {loadingCalls ? (
          <p className="no-calls">Loading calls...</p>
        ) : calls.length === 0 ? (
          <p className="no-calls">
            No calls yet. Upload CSV or make a single call above.
          </p>
        ) : (
          <div className="table-container">
            <table className="calls-table">
              <thead>
                <tr>
                  <th>Contact</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Started</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => {
                  const contact = formatContactInfo(call);
                  const callType = getCallType(call);
                  const isActive = ACTIVE_STATUSES.includes(call.status);

                  return (
                    <tr key={call._id || call.uuid}>
                      <td className="contact-cell">
                        <div className="contact-info">
                          {contact.hasName ? (
                            <>
                              <div className="contact-name">{contact.name}</div>
                              <div className="contact-phone-sub">
                                {formatPhone(call.number || call.to)}
                              </div>
                              {contact.address && (
                                <div className="contact-address">{contact.address}</div>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="contact-name" style={{ color: "#22d3ee" }}>
                                {formatPhone(call.number || call.to)}
                              </div>
                              <div className="contact-sub-label">
                                {callType === "bulk" ? "Unknown Contact" : "Manual Dial"}
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="type-badge">
                          {callType === "bulk" ? "Bulk" : "Single"}
                        </span>
                      </td>
                      <td>{getStatusBadge(call.status)}</td>
                      <td className="duration-cell">
                        {formatDuration(call, currentTime)}
                      </td>
                      <td className="date-time-col">
                        <span className="time">
                          {new Date(call.createdAt).toLocaleTimeString()}
                        </span>
                        <span className="date">
                          {new Date(call.createdAt).toLocaleDateString()}
                        </span>
                      </td>
                      <td>
                        {isActive ? (
                          <button
                            onClick={() => handleEndCall(call.uuid)}
                            className="end-btn"
                            disabled={endingUuid === call.uuid}
                          >
                            {endingUuid === call.uuid ? "Ending..." : "End"}
                          </button>
                        ) : (
                          <span style={{ color: "rgba(255,255,255,0.55)" }}>Closed</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
