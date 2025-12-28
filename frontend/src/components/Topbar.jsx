import React, { useRef, useState, useEffect, useCallback } from "react";
import "./Topbar.css";

import API_BASE_URL from "../api";
import ScriptsPanel from "./ScriptPanel";
import DialPad from "./DialPad";
import { useAuth } from "../components/AuthContext"; // keep if this path is correct for your project

export default function Topbar({ onBulkCallStart }) {
  const fileInputRef = useRef(null);

  // ✅ ONE auth hook call ONLY
  const { user, logout, loading, authFetch } = useAuth();

  // --- State hooks ---
  const [selectedFile, setSelectedFile] = useState(null);
  const [csvData, setCsvData] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [singleCallModal, setSingleCallModal] = useState(false);
  const [singleCallNumber, setSingleCallNumber] = useState("");
  const [activeCall, setActiveCall] = useState(null);

  const [selectedScript, setSelectedScript] = useState(null);
  const [showScripts, setShowScripts] = useState(false);
  const [callNotes, setCallNotes] = useState("");
  const [callOutcome, setCallOutcome] = useState("");

  const [showUserMenu, setShowUserMenu] = useState(false);
  const [usedCalls, setUsedCalls] = useState(0);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // ------------------------------------
  // Helpers
  // ------------------------------------
  const safeCallsArray = (data) => {
    const callsArray = Array.isArray(data?.calls)
      ? data.calls
      : Array.isArray(data)
      ? data
      : [];
    return callsArray;
  };

  const handleCloseSingleCallModal = () => {
    // Prevent closing while an API request is in-flight (optional but helps UX)
    if (isLoading) return;

    setSingleCallModal(false);
    setActiveCall(null);
    setSingleCallNumber("");
    setCallNotes("");
    setCallOutcome("");
    setSelectedScript(null);
    setShowScripts(false);
  };

  // ------------------------------------
  // ✅ Usage: count calls for usage meter (AUTHED)
  // ------------------------------------
  const fetchUsage = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/calls`);
      if (!res.ok) return;

      const data = await res.json().catch(() => ({}));
      const callsArray = safeCallsArray(data);
      setUsedCalls(callsArray.length);
    } catch (err) {
      console.error("Failed to fetch usage:", err);
    }
  }, [authFetch]);

  useEffect(() => {
    fetchUsage();
    const interval = setInterval(fetchUsage, 5000);
    return () => clearInterval(interval);
  }, [fetchUsage]);

  // ------------------------------------
  // Live timer for active single call
  // ------------------------------------
  useEffect(() => {
    if (!activeCall) return;
    const interval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [activeCall]);

  // ------------------------------------
  // ✅ Poll active call status while modal is open (AUTHED)
  // ------------------------------------
  const pollActiveCall = useCallback(async () => {
    try {
      const res = await authFetch(`${API_BASE_URL}/api/calls`);
      if (!res.ok) return;

      const data = await res.json().catch(() => ({}));
      const callsArray = safeCallsArray(data);
      const updated = callsArray.find((c) => c.uuid === activeCall?.uuid);
      if (updated) setActiveCall(updated);
    } catch (err) {
      console.error("Failed to refresh active call:", err);
    }
  }, [authFetch, activeCall?.uuid]);

  useEffect(() => {
    if (!activeCall || !singleCallModal) return;

    pollActiveCall();
    const interval = setInterval(pollActiveCall, 2000);

    return () => clearInterval(interval);
  }, [activeCall, singleCallModal, pollActiveCall]);

  // --- Early exit for loading (NO hooks after this) ---
  if (loading) {
    return (
      <header className="topbar">
        <h1>Vynce Dashboard</h1>
      </header>
    );
  }

  // ------------------------------------
  // CSV Handling (FIXED)
  // ------------------------------------
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // Normalize headers like:
  // "Phone Number", "phone_number", "MOBILE #" -> "phone number", "phone number", "mobile number"
  const normalizeHeader = (h = "") =>
    h
      .toString()
      .toLowerCase()
      .trim()
      .replace(/[_\-]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/#/g, "number");

  // Normalize NANP numbers to +1XXXXXXXXXX; return "" if invalid
  const normalizePhone = (value) => {
    if (!value) return "";
    let num = value.toString().replace(/\D/g, "").replace(/^0+/, "");
    if (num.length === 10) num = "1" + num;
    if (num.length === 11 && num.startsWith("1")) return `+${num}`;
    return "";
  };

  // Safer CSV parse: detects phone column, normalizes phone, keeps rawData for preview
  const parseCSV = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          const text = String(e.target.result || "");
          const lines = text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean);

          if (lines.length === 0) {
            reject(new Error("CSV file is empty"));
            return;
          }

          // Parse headers (basic CSV split for your current format)
          const rawHeaders = lines[0]
            .split(",")
            .map((h) => h.trim().replace(/"/g, ""));

          const headers = rawHeaders.map(normalizeHeader);

          // Find phone column by normalized header
          const phoneIndex = headers.findIndex(
            (h) =>
              h.includes("phone") ||
              h.includes("mobile") ||
              h.includes("number") ||
              h.includes("tel") ||
              h === "to"
          );

          if (phoneIndex === -1) {
            reject(
              new Error(
                "No phone column detected. Please include a column like Phone, Phone Number, Mobile, Number, or Tel."
              )
            );
            return;
          }

          // Find possible name column
          const nameIndex = headers.findIndex(
            (h) => h.includes("name") || h.includes("full name") || h.includes("fullname") || h.includes("contact")
          );

          const data = [];

          lines.slice(1).forEach((line, index) => {
            // Robust-ish CSV row split (supports commas inside quotes)
            const values = [];
            let current = "";
            let inQuotes = false;

            for (let i = 0; i < line.length; i++) {
              const char = line[i];
              if (char === '"') {
                inQuotes = !inQuotes;
              } else if (char === "," && !inQuotes) {
                values.push(current);
                current = "";
              } else {
                current += char;
              }
            }
            values.push(current);

            // Build normalized-key row map for preview/metadata
            const row = {};
            headers.forEach((h, i) => {
              row[h] = String(values[i] || "").replace(/"/g, "").trim();
            });

            const normalized = normalizePhone(values[phoneIndex]);
            if (!normalized) return;

            // Location fields (optional, safe)
            const city = row.city || row.town || "";
            const state = row.state || row.region || "";
            const zip = row.zip || row.zipcode || row.postalcode || "";

            const name =
              (nameIndex !== -1 ? String(values[nameIndex] || "").replace(/"/g, "").trim() : "") ||
              row.name ||
              row.fullname ||
              `Contact ${index + 1}`;

            data.push({
              id: index,
              phone: normalized,
              name,
              city,
              state,
              zip,
              rawData: {
                ...row,
                phone: normalized,
                name,
                city,
                state,
                zip,
              },
            });
          });

          if (data.length === 0) {
            reject(
              new Error(
                "No valid phone numbers found in CSV. Please ensure your CSV has a column with phone numbers."
              )
            );
            return;
          }

          resolve(data);
        } catch (error) {
          reject(error);
        }
      };

      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      alert("Please select a CSV file");
      event.target.value = "";
      return;
    }

    setSelectedFile(file);
    setIsLoading(true);

    try {
      const parsedData = await parseCSV(file);
      setCsvData(parsedData);
      setShowModal(true);
    } catch (error) {
      console.error("Error parsing CSV:", error);
      alert(`Error parsing CSV file: ${error.message}`);
    } finally {
      setIsLoading(false);
      event.target.value = "";
    }
  };

  const handleSchedule = () => {
    alert("Scheduling feature coming soon! The calls will be scheduled for later execution.");
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setSelectedFile(null);
    setCsvData([]);
  };

  // ✅ Bulk calls: upload CSV to backend (AUTHED) (FIXED)
  // Always sends a clean, backend-friendly CSV with guaranteed headers.
  const handleRunNow = async () => {
    if (!csvData.length || isLoading) return;

    setIsLoading(true);
    try {
      const formData = new FormData();

      // Always build a clean CSV for upload (prevents backend header mismatch)
      const headers = ["phone", "name", "city", "state", "zip"];
      const csvRows = [
        headers.join(","),
        ...csvData.map((r) =>
          headers
            .map((h) => {
              const val = r?.rawData?.[h] ?? r?.[h] ?? "";
              return `"${String(val).replace(/"/g, '""')}"`;
            })
            .join(",")
        ),
      ];

      const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
      formData.append("file", blob, selectedFile?.name || "contacts.csv");

      const res = await authFetch(`${API_BASE_URL}/api/upload-csv`, {
        method: "POST",
        body: formData,
        // IMPORTANT: do NOT set Content-Type for FormData
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        throw new Error(
          `Server returned ${res.status}: ${res.statusText}${errorText ? ` - ${errorText}` : ""}`
        );
      }

      const result = await res.json().catch(() => ({}));

      if (onBulkCallStart) onBulkCallStart(result);

      alert(`✅ Successfully started bulk calls for ${result.count || csvData.length} numbers`);

      setShowModal(false);
      setSelectedFile(null);
      setCsvData([]);
    } catch (error) {
      console.error("❌ Error starting bulk calls:", error);
      alert(`❌ Error starting bulk calls: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ------------------------------------
  // Single call handling (AUTHED)
  // ------------------------------------
  const handleSingleCallClick = () => {
    // Reset call state for a fresh dial
    setSingleCallNumber("");
    setActiveCall(null);
    setCallNotes("");
    setCallOutcome("");
    setSelectedScript(null);
    setShowScripts(false);

    // Open modal
    setSingleCallModal(true);
  };

  const makeSingleCall = async (number) => {
    if (!number || isLoading) return;

    setIsLoading(true);
    try {
      const agentName = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();

      const res = await authFetch(`${API_BASE_URL}/api/make-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: number,
          agent: agentName,
          callerID: user?.callerId || "",
        }),
      });

      const result = await res.json().catch(() => ({}));

      if (!res.ok || !result.success) {
        throw new Error(result.message || `Server returned ${res.status}`);
      }

      setActiveCall(result.data || null);
      setSingleCallModal(true);
    } catch (error) {
      console.error("❌ Error making single call:", error);
      alert(`❌ Error making call: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const endSingleCall = async () => {
    if (!activeCall || isLoading) return;

    setIsLoading(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/api/end-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid: activeCall.uuid }),
      });

      const result = await res.json().catch(() => ({}));

      if (!res.ok || !result.success) {
        throw new Error(result.message || `Server returned ${res.status}`);
      }

      alert(`✅ ${result.message || "Call ended"}`);
      handleCloseSingleCallModal();
    } catch (error) {
      console.error("❌ Error ending call:", error);
      alert(`❌ Error ending call: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const saveCallNotes = async () => {
    if (!activeCall || isLoading) return;

    setIsLoading(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/api/calls/${activeCall.uuid}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: callNotes,
          scriptUsed: selectedScript?.name || "",
          outcome: callOutcome,
          followUpRequired: callOutcome === "callback",
        }),
      });

      const result = await res.json().catch(() => ({}));

      if (!res.ok || !result.success) {
        throw new Error(result.message || `Server returned ${res.status}`);
      }

      alert("✅ Call notes saved successfully!");
    } catch (error) {
      console.error("❌ Error saving notes:", error);
      alert(`❌ Error saving notes: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ------------------------------------
  // Utilities (UI)
  // ------------------------------------
  const testServerConnection = async () => {
    try {
      // health is usually public; if yours is protected, swap to authFetch
      const response = await fetch(`${API_BASE_URL}/api/health`);
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        alert(`✅ Server is running!\n\n${data.message || ""}`);
      } else {
        throw new Error(`Server returned ${response.status}`);
      }
    } catch (error) {
      console.error("❌ Server connection failed:", error);
      alert(
        `❌ Cannot connect to server: ${error.message}\n\nPlease make sure:\n1. Your backend server is running\n2. It's on port 3000\n3. No other applications are using port 3000`
      );
    }
  };

  const formatPhoneNumber = (phoneNumber) => {
    if (!phoneNumber) return "";
    const cleaned = phoneNumber.replace(/\D/g, "");
    if (cleaned.length === 11 && cleaned.startsWith("1")) {
      return `${cleaned.slice(0, 1)}${cleaned.slice(1, 4)}-${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    } else if (cleaned.length === 10) {
      return `1${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return phoneNumber;
  };

  const getStatusLabel = () => {
    const status = activeCall?.status;
    if (!status) return "Calling...";

    const map = {
      dialing: "Dialing",
      initiated: "Dialing",
      ringing: "Ringing",
      answered: "In Call",
      completed: "Completed",
      ended: "Ended",
      failed: "Failed",
      busy: "Busy",
      voicemail: "Voicemail",
      "no-answer": "No Answer",
    };
    return map[status] || status;
  };

  const getLiveDuration = () => {
    if (!activeCall) return "";

    // If backend already returns final duration for completed calls
    if (
      typeof activeCall.duration === "string" &&
      activeCall.duration.includes(":") &&
      ["completed", "ended", "failed", "busy", "voicemail"].includes(activeCall.status)
    ) {
      return activeCall.duration;
    }

    if (!activeCall.createdAt) return "";

    const start = new Date(activeCall.createdAt).getTime();
    const diffSeconds = Math.max(0, Math.floor((currentTime - start) / 1000));
    const mins = Math.floor(diffSeconds / 60);
    const secs = diffSeconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleDialDigit = (d) => setSingleCallNumber((prev) => (prev || "") + d);
  const handleDialBackspace = () => setSingleCallNumber((prev) => (prev ? prev.slice(0, -1) : ""));
  const handleDialClear = () => setSingleCallNumber("");
  const handleDialCall = () => {
    if (!singleCallNumber || isLoading) return;
    makeSingleCall(singleCallNumber);
  };

  // ------------------------------------
  // JSX
  // ------------------------------------
  return (
    <>
      <header className="topbar">
        <h1>Vynce Dashboard</h1>

        <div className="topbar-actions">
          {/* Usage indicator */}
          {user?.subscription && (
            <div className="usage-indicator">
              <span className="usage-text">
                {usedCalls} / {user.subscription.maxCalls} calls
              </span>
              <div className="usage-bar">
                <div
                  className="usage-progress"
                  style={{
                    width: `${
                      user.subscription.maxCalls
                        ? Math.min(100, (usedCalls / user.subscription.maxCalls) * 100)
                        : 0
                    }%`,
                  }}
                ></div>
              </div>
            </div>
          )}

          {/* New Call */}
          <button className="new-call-btn" onClick={handleSingleCallClick} disabled={isLoading}>
            <span className="new-call-icon">📞</span>
            <span>New Call</span>
          </button>

          {/* CSV Upload */}
          <button className="csv-upload-btn" onClick={handleUploadClick} disabled={isLoading}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
            {isLoading ? "Processing..." : "Upload CSV"}
          </button>

          {/* Test Connection */}
          <button className="test-connection-btn" onClick={testServerConnection} disabled={isLoading}>
            Test Connection
          </button>

          {/* Hidden file input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".csv"
            style={{ display: "none" }}
          />

          {/* User menu */}
          <div className="user-menu-container">
            <button className="user-menu-btn" onClick={() => setShowUserMenu(!showUserMenu)}>
              <div className="user-avatar">
                {user?.firstName?.charAt(0)}
                {user?.lastName?.charAt(0)}
              </div>
              <span>
                {user?.firstName} {user?.lastName}
              </span>
              <span className="dropdown-arrow">▾</span>
            </button>

            {showUserMenu && (
              <div className="user-dropdown">
                <div className="user-info">
                  <div className="user-name">
                    {user?.firstName} {user?.lastName}
                  </div>
                  <div className="user-email">{user?.email}</div>
                  <div className="user-plan">
                    Plan: <span className="plan-badge">{user?.subscription?.plan}</span>
                  </div>
                </div>

                <div className="dropdown-divider"></div>
                <a href="/billing" className="dropdown-item">
                  💳 Billing &amp; Plans
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
      {showUserMenu && <div className="dropdown-backdrop" onClick={() => setShowUserMenu(false)} />}

      {/* Single Call Modal */}
      {singleCallModal && (
        <div
          className="call-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseSingleCallModal();
          }}
        >
          <div className="call-modal" onClick={(e) => e.stopPropagation()}>
            <div className="call-modal-content">
              <div className="call-status-header">
                <div className="call-status-icon">📞</div>
                <h2>Outgoing Call</h2>

                <button type="button" className="call-modal-close" onClick={handleCloseSingleCallModal}>
                  ✕
                </button>
              </div>

              <div className="call-number-display">{formatPhoneNumber(singleCallNumber)}</div>

              {/* Layout: left = dial pad, right = status + scripts + notes */}
              <div className="call-modal-body">
                {/* LEFT: Dial Pad */}
                <div className="call-modal-left">
                  <DialPad
                    value={singleCallNumber}
                    onDigit={handleDialDigit}
                    onBackspace={handleDialBackspace}
                    onClear={handleDialClear}
                    onCall={handleDialCall}
                    disabled={isLoading}
                  />
                </div>

                {/* RIGHT: Status, scripts, notes */}
                <div className="call-modal-right">
                  {/* Status */}
                  <div className="call-status-info">
                    <div className="status-indicator">
                      <span className="pulse-dot"></span>
                      <span>{getStatusLabel()}</span>
                    </div>
                    <div className="call-timer">
                      {activeCall?.createdAt && (
                        <>
                          Started at {new Date(activeCall.createdAt).toLocaleTimeString()} ·{" "}
                        </>
                      )}
                      Duration: {getLiveDuration()}
                    </div>
                  </div>

                  {/* Script Section */}
                  <div className="call-script-section">
                    <div className="script-header">
                      <h4>Call Script</h4>
                      <button className="script-toggle-btn" onClick={() => setShowScripts(!showScripts)}>
                        {showScripts ? "Hide Scripts" : "Show Scripts"}
                      </button>
                    </div>

                    {showScripts && (
                      <div className="scripts-panel">
                        <ScriptsPanel onScriptSelect={setSelectedScript} selectedScript={selectedScript} />
                      </div>
                    )}

                    {selectedScript && (
                      <div className="selected-script">
                        <h5>{selectedScript.name}</h5>
                        <div className="script-content">{selectedScript.content}</div>
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
                      <select value={callOutcome} onChange={(e) => setCallOutcome(e.target.value)}>
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

                  {/* Actions */}
                  <div className="call-modal-actions">
                    <button className="save-notes-btn" onClick={saveCallNotes} disabled={isLoading || !activeCall}>
                      💾 Save Notes
                    </button>
                    <button className="end-call-cta" onClick={endSingleCall} disabled={isLoading || !activeCall}>
                      🛑 End Call
                    </button>
                  </div>
                </div>
              </div>
              {/* end modal body */}
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
              <button className="close-btn" onClick={handleCloseModal}>
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="file-info">
                <strong>File:</strong> {selectedFile?.name}
                <br />
                <strong>Contacts:</strong> {csvData.length} valid numbers found
                <br />
                <small>First call will start immediately after clicking &quot;Run Now&quot;</small>
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
                            .filter(([key, val]) => !["id", "name", "phone"].includes(key) && val)
                            .map(([key, val]) => (
                              <div key={key}>
                                <strong>{key}:</strong> {val}
                              </div>
                            ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="modal-footer">
                <button className="btn-secondary" onClick={handleCloseModal} disabled={isLoading}>
                  Cancel
                </button>
                <button className="btn-schedule" onClick={handleSchedule} disabled={isLoading}>
                  Schedule
                </button>
                <button className="btn-primary" onClick={handleRunNow} disabled={isLoading}>
                  {isLoading ? "Starting Calls..." : `Run Now (${csvData.length} calls)`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
