import React, { useRef, useState, useEffect } from "react";
import "./Topbar.css";

import API_BASE_URL from "../api";
import ScriptsPanel from "./ScriptPanel";
import DialPad from "./DialPad";
import { useAuth } from "../components/AuthContext"; // keep if this path is correct for your project
import { useAppContext } from "../contexts/AppContext";

import { useLicenseGuard } from "../hooks/useLicenseGuard";
import LicenseBanner from "../components/LicenseBanner";





export default function Topbar({ onBulkCallStart }) {
   const users = [];
  const fileInputRef = useRef(null);

  // ✅ ONE auth hook call ONLY
 const { user, logout, loading, authFetch } = useAuth();
 const {
  calls: sharedCalls,
  refreshCalls,
  bulkStatus: sharedBulkStatus,
  makeCall,
  endCall,
  saveCallNotes: saveSharedCallNotes,
 } = useAppContext();

 // ✅ SAFELY derive agents list (no crash if empty)
const agents = [];


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

  const isTestMode = false;
  const [modeUpdating, setModeUpdating] = useState(false);
  const [showLiveModeConfirm, setShowLiveModeConfirm] = useState(false);

  const {
    loading: licenseLoading,
    canCall,
    canSingleCall,
    canBulkCall,
    mode: systemMode,
    reason,
  } = useLicenseGuard();

const [isBulkCampaignActive, setIsBulkCampaignActive] = useState(false);


// CSV bulk confirmation modal
const [showCsvModal, setShowCsvModal] = useState(false);
const [pendingCsvFile, setPendingCsvFile] = useState(null);

const [csvRowCount, setCsvRowCount] = useState(null);
const [csvPreviewRows, setCsvPreviewRows] = useState([]);
const [scheduleLater, setScheduleLater] = useState(false);
const [scheduledAt, setScheduledAt] = useState("");

const [campaignName, setCampaignName] = useState("");
const [assignedAgentId, setAssignedAgentId] = useState("");

const [onboarding, setOnboarding] = useState(null);
const effectiveCanCall = canCall;
const effectiveCanSingleCall = canSingleCall;
const effectiveCanBulkCall = canBulkCall;
// Add these state hooks
// ✅ Consolidated State: One object to rule them all
const [bulkStatus, setBulkStatus] = useState({ 
  running: false, 
  paused: false, 
  campaignName: "" 
});
useEffect(() => {
  if (!sharedBulkStatus) return;

  const running = !!sharedBulkStatus.running;
  const paused = !!sharedBulkStatus.paused;

  setBulkStatus((prev) => ({
    ...prev,
    ...sharedBulkStatus,
    running,
    paused,
  }));
  setIsBulkCampaignActive(running || paused);
}, [sharedBulkStatus]);
useEffect(() => {
  let mounted = true;

  const loadOnboarding = async () => {
    try {
      const res = await authFetch("/api/onboarding/status");
      if (!res.ok) return;
      const data = await res.json();
      if (mounted) setOnboarding(data);
    } catch {}
  };

  loadOnboarding();
  return () => (mounted = false);
}, [authFetch]);

// 📦 OFFLINE MODE — no onboarding / test mode



  // ------------------------------------
  // Helpers
  // ------------------------------------
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

const handleCloseModal = () => {
  setShowModal(false);
  setCsvData([]);        // optional but recommended
  setSelectedFile(null); // optional cleanup
};

const handleToggleMode = async () => {
  if (modeUpdating) return;

  const nextMode = systemMode?.requested === "live" ? "offline" : "live";

  if (nextMode === "live") {
    setShowLiveModeConfirm(true);
    return;
  }

  await performModeSwitch(nextMode);
};

const performModeSwitch = async (nextMode) => {
  if (modeUpdating) return;

  setModeUpdating(true);
  try {
    const res = await authFetch("/api/system/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: nextMode }),
    });

    if (!res.ok) {
      throw new Error("Failed to update mode");
    }

    window.location.reload();
  } catch {
    // keep quiet for now
  } finally {
    setModeUpdating(false);
  }
};

 // ------------------------------------
// ✅ ENHANCED: Fetch calls + subscription limits
// ------------------------------------
useEffect(() => {
  setUsedCalls(sharedCalls.length);
}, [sharedCalls]);



  useEffect(() => {
  if (!user || loading) return;

  let alive = true;

  const sync = async () => {
    try {
      const res = await authFetch("/api/bulk/status");
      if (!res.ok) return;
      const data = await res.json();

      if (!alive) return;

      const running = !!data?.running;
      const paused = !!data?.paused;

      setBulkStatus((prev) => ({ ...prev, running, paused }));
      setIsBulkCampaignActive(running || paused);
    } catch {
      // silent
    }
  };

  sync();
  const t = setInterval(sync, 10000);

  return () => {
    alive = false;
    clearInterval(t);
  };
}, [user, loading, authFetch]);




useEffect(() => {
  if (!activeCall) return;

  const activeCallKey = activeCall.uuid || activeCall._id;
  if (!activeCallKey) return;

  const nextActiveCall = sharedCalls.find((call) => {
    const callKey = call?.uuid || call?._id;
    return callKey === activeCallKey;
  });

  if (nextActiveCall) {
    setActiveCall((prev) => ({ ...prev, ...nextActiveCall }));
  }
}, [activeCall, sharedCalls]);

// ------------------------------------
// REMOVED: All other socket useEffects (consolidated above)
// REMOVED: The duplicate "LIVE CALL UPDATES" block entirely
// REMOVED: The broken useEffect after the loading check

// ------------------------------------
// CSV Handling (FIXED)
// ------------------------------------
const handleUploadClick = () => {
  fileInputRef.current?.click();
};

const normalizeHeader = (h = "") =>
  h
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/#/g, "number");

const normalizePhone = (value) => {
  if (!value) return "";
  let num = value.toString().replace(/\D/g, "").replace(/^0+/, "");
  if (num.length === 10) num = "1" + num;
  if (num.length === 11 && num.startsWith("1")) return `+${num}`;
  return "";
};

const parseCSV = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = String(e.target.result || "");
        const lines = text
          .split(/\r?\n|\r/)
          .map(line => line.trim())
          .filter(Boolean);

        if (lines.length < 2) {
          reject(new Error("CSV must have at least one data row"));
          return;
        }

        // Parse headers
        const headerLine = lines[0];
        const headers = [];
        let current = "";
        let inQuotes = false;

        for (let i = 0; i < headerLine.length; i++) {
          const char = headerLine[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            headers.push(current.trim());
            current = "";
          } else {
            current += char;
          }
        }
        headers.push(current.trim());

        // Find phone column
        const phoneIndex = headers.findIndex(h => 
          normalizeHeader(h).includes('phone') || 
          normalizeHeader(h).includes('number') ||
          h.toLowerCase() === 'to'
        );

        if (phoneIndex === -1) {
          reject(new Error("No phone column found. Please include 'Phone' or 'Number' column."));
          return;
        }

        const data = [];
        const processedNumbers = new Set(); // Prevent duplicates

        for (let i = 1; i < lines.length; i++) {
          if (!lines[i].trim()) continue;

          const values = [];
          current = "";
          inQuotes = false;

          for (let j = 0; j < lines[i].length; j++) {
            const char = lines[i][j];
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              values.push(current);
              current = "";
            } else {
              current += char;
            }
          }
          values.push(current);

          // Extract phone number
          const rawPhone = values[phoneIndex]?.trim().replace(/["']/g, '') || '';
          const normalizedPhone = normalizePhone(rawPhone);
          
          if (!normalizedPhone) continue;
          if (processedNumbers.has(normalizedPhone)) continue;
          
          processedNumbers.add(normalizedPhone);

          // Build rowData object
          const rowData = {
            id: data.length,
            phone: normalizedPhone,
            rawData: {}
          };

          // Populate all columns
          headers.forEach((header, idx) => {
            if (idx < values.length) {
              rowData.rawData[normalizeHeader(header)] = values[idx].replace(/["']/g, '').trim();
            }
          });

          data.push(rowData);
        }

        if (data.length === 0) {
          reject(new Error("No valid phone numbers found in CSV"));
          return;
        }

        resolve(data);

      } catch (err) {
        reject(new Error(`Invalid CSV format: ${err.message}`));
      }
    };

    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
};

const handleFileChange = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  setSelectedFile(file);
  setIsLoading(true);

  try {
    const parsedData = await parseCSV(file);
    setCsvData(parsedData);
    setShowModal(true);
  } catch (error) {
    alert(error.message);
  } finally {
    setIsLoading(false);
    event.target.value = "";
  }
};

const handleRunNow = async () => {
  if (licenseLoading) {
    alert("Checking license, please wait…");
    return;
  }

  if (!effectiveCanBulkCall) {
    alert(reason || "You cannot make calls right now");
    return;
  }

  setIsLoading(true);

  try {
    const formData = new FormData();
    
    // Create clean CSV content
    const csvRows = [
      "phone,name,city,state,zip",
      ...csvData.map((r) => {
        const phone = r.phone.replace(/\D/g, '');
        const name = r.rawData.name?.replace(/"/g, '""') || '';
        const city = r.rawData.city?.replace(/"/g, '""') || '';
        const state = r.rawData.state?.replace(/"/g, '""') || '';
        const zip = r.rawData.zip?.replace(/"/g, '""') || '';
        
        return `"${phone}","${name}","${city}","${state}","${zip}"`;
      })
    ];

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    formData.append("file", blob, selectedFile?.name || "contacts.csv");

    // Add metadata
    formData.append("campaignName", campaignName || "Unnamed Campaign");
    formData.append("assignedAgentId", user?._id || "");

    const res = await authFetch("/api/upload-csv", {
      method: "POST",
      body: formData,
      // DO NOT set Content-Type - let browser set it with boundary
    });

    const result = await res.json();

    if (!res.ok) {
      throw new Error(result?.message || `Upload failed (${res.status})`);
    }

    const count = result?.queued ?? result?.count ?? 0;
    await refreshCalls();
    alert(`✅ Started bulk campaign with ${count} calls!`);

    setShowModal(false);
    setCsvData([]);
    setSelectedFile(null);
    setCampaignName("");

  } catch (err) {
    console.error("❌ Bulk upload error:", err);
    alert(`Failed to start bulk campaign: ${err.message}`);
  } finally {
    setIsLoading(false);
  }
};

// 📅 Placeholder – REQUIRED so JSX does not crash
const handleSchedule = () => {
  alert("📅 Scheduling coming soon");
};


/* ===============================
   🔥 BULK CONTROL UI (FINAL)
   =============================== */





// ------------------------------------
// Single call handling (AUTHED)
// ------------------------------------
const makeSingleCall = async (number) => {
  if (!number) {
    console.error("❌ No number provided");
    return;
  }

  setIsLoading(true);

  try {
    const agentName = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
    const result = await makeCall({
      to: number,
      agent: agentName,
    });

    setActiveCall(result?.call || result?.data || null);

  } catch (error) {
    console.error("❌ makeSingleCall ERROR:", error);
    console.error("❌ Error stack:", error.stack);
    alert(`❌ Error making call: ${error.message}`);
    setActiveCall(null); // Don't show fake active call
  } finally {
    setIsLoading(false);
  }
};


// ------------------------------------
// End active single call (AUTHED)
// ------------------------------------
const endSingleCall = async () => {
  if (!activeCall || isLoading) return;

  setIsLoading(true);

  try {
    const data = await endCall(activeCall.uuid);
    alert(data.message || "Call ended");
    handleCloseSingleCallModal();
  } catch (error) {
    console.error("❌ Error ending call:", error);
    alert(`❌ Error ending call: ${error.message}`);
  } finally {
    setIsLoading(false);
  }
};

// ------------------------------------
// Save call notes (AUTHED)
// ------------------------------------
// In Topbar.jsx
const saveCallNotes = async () => {
  if (!activeCall?.uuid || isLoading) return;

  setIsLoading(true);
  try {
    await saveSharedCallNotes({
      uuid: activeCall.uuid,
      content: callNotes,
      outcome: callOutcome,
    });

    alert("✅ Notes saved!");
    // No need to close the modal, agent might want to keep it open
  } catch (error) {
    console.error("❌ Error saving notes:", error);
    alert(`Failed to save notes: ${error.message}`);
  } finally {
    setIsLoading(false);
  }
};

const handleSingleCallClick = () => {
  // Reset call state for a fresh dial
  setSingleCallNumber("");
  setActiveCall(null);
  setCallNotes("");
  setCallOutcome("");
  setSelectedScript(null);
  setShowScripts(false);
  setSingleCallModal(true);
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

  return (
  <>
    <header className="topbar">
      <h1>Ring-D-Skull</h1>

      <div className="topbar-actions">
        {/* ✅ ENHANCED USAGE METER */}
        {user?.subscription && (
          <div
            className="usage-indicator"
            title={
              user.subscription.unlimitedCalls || !user.subscription.maxCalls
                ? `Used ${usedCalls} calls`
                : `Used ${usedCalls} of ${user.subscription.maxCalls} calls`
            }
          >
            <div className="usage-header">
              <span className="usage-label">Call Usage</span>
              <span className="usage-percent">
                {user.subscription.unlimitedCalls || !user.subscription.maxCalls
                  ? "Unlimited"
                  : user.subscription.maxCalls
                  ? Math.min(100, Math.round((usedCalls / user.subscription.maxCalls) * 100))
                  : 0}
                {user.subscription.unlimitedCalls || !user.subscription.maxCalls ? "" : "%"}
              </span>
            </div>
            <div className="usage-bar-container">
              <div
                className="usage-bar"
                style={{
                  width: `${user.subscription.unlimitedCalls || !user.subscription.maxCalls
                    ? 100
                    : user.subscription.maxCalls
                    ? Math.min(100, (usedCalls / user.subscription.maxCalls) * 100)
                    : 0}%`,
                  backgroundColor: `${
                    user.subscription.unlimitedCalls || !user.subscription.maxCalls
                      ? "#10b981"
                      : (usedCalls / (user.subscription.maxCalls || Infinity)) > 0.9
                      ? "#ef4444"  // Red if >90%
                      : (usedCalls / (user.subscription.maxCalls || Infinity)) > 0.7
                      ? "#f97316"  // Orange if >70%
                      : "#10b981"   // Green otherwise
                  }`
                }}
              ></div>
            </div>
            <div className="usage-text">
              <span className="usage-used">{usedCalls}</span>
              <span className="usage-divider">/</span>
              <span className="usage-max">
                {user.subscription.unlimitedCalls || !user.subscription.maxCalls
                  ? "Unlimited"
                  : user.subscription.maxCalls}
              </span>
              <span className="usage-unit">calls</span>
            </div>
          </div>
        )}

        {/* ⚠️ WARNING WHEN NEAR LIMIT */}
        {!user?.subscription?.unlimitedCalls &&
          user?.subscription?.maxCalls &&
          usedCalls > user.subscription.maxCalls * 0.9 && (
          <div className="usage-warning">
            ⚠️ You've used {Math.round((usedCalls / user.subscription.maxCalls) * 100)}% of your call limit.
          </div>
        )}

        {systemMode ? (
          <div className={`mode-indicator ${systemMode.effective === "live" ? "live" : "offline"}`}>
            <div className="mode-copy">
              <span className="mode-pill">
                {systemMode.effective === "live" ? "Live Mode" : "Offline Mode"}
              </span>
              <span className="mode-subtext">
                {systemMode.effective === "live"
                  ? "Real provider traffic is enabled"
                  : "Calls stay simulated in this workspace"}
              </span>
            </div>
            <button
              type="button"
              className="mode-toggle-btn"
              onClick={handleToggleMode}
              disabled={modeUpdating}
              title={
                systemMode.reason ||
                `Switch to ${systemMode.requested === "live" ? "offline" : "live"} mode`
              }
            >
              {modeUpdating
                ? "Switching..."
                : systemMode.requested === "live"
                  ? "Go Offline"
                  : "Go Live"}
            </button>
          </div>
        ) : null}

        {/* New Call */}
        <button
          className="new-call-btn"
          onClick={handleSingleCallClick}
          disabled={isLoading || !effectiveCanSingleCall}
          title={!effectiveCanSingleCall ? reason || "Single calling is unavailable" : ""}
        >
          <span className="new-call-icon">📞</span>
          <span>New Call</span>
        </button>

        

          {/* Test Connection */}
          <button className="test-connection-btn" onClick={testServerConnection} disabled={isLoading || !effectiveCanCall}
>
            Test Connection
          </button>
{/* Hidden file input — SELECT ONLY (NO UPLOAD HERE) */}
<input
  type="file"
  ref={fileInputRef}
  accept=".csv"
  style={{ display: "none" }}
  onChange={(e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPendingCsvFile(file);

    const reader = new FileReader();

    reader.onload = () => {
      const text = reader.result;
      if (!text || typeof text !== "string") {
        setCsvRowCount(0);
        setCsvPreviewRows([]);
        setShowCsvModal(true);
        return;
      }

      // Normalize line endings & remove empty rows
      const rows = text
        .split(/\r?\n/)
        .map((r) => r.trim())
        .filter(Boolean);

      if (rows.length <= 1) {
        setCsvRowCount(0);
        setCsvPreviewRows([]);
        setShowCsvModal(true);
        return;
      }

      // Header + data rows
      const headers = rows[0].split(",").map((h) => h.trim());
      const dataRows = rows.slice(1);

      // Row count (excluding header)
      setCsvRowCount(dataRows.length);

      // Preview first 5 rows (non-destructive)
      const preview = dataRows.slice(0, 5).map((line) => {
        const cols = line.split(",");
        return headers.reduce((acc, h, i) => {
          acc[h] = cols[i] || "";
          return acc;
        }, {});
      });

      setCsvPreviewRows(preview);
      setShowCsvModal(true);
    };

    reader.onerror = () => {
      setCsvRowCount(0);
      setCsvPreviewRows([]);
      setShowCsvModal(true);
    };

    reader.readAsText(file);

    // reset input so same file can be selected again
    e.target.value = "";
  }}
/>


{/* ✅ NEW RELIABLE BULK CONTROLS - This block will not crash */}
{/* It only shows up if a campaign is actually running */}
{bulkStatus.running && (
  <div className="bulk-controls">
    {/* Status Label */}
    <span className="bulk-status">
      Campaign: {bulkStatus.paused ? "Paused" : "Running"}
    </span>

    {/* Pause / Resume Button (Toggles based on state) */}
    {bulkStatus.paused ? (
      // Show RESUME button if paused
      <button
        type="button"
        className="bulk-btn resume"
        onClick={() => authFetch("/api/bulk/resume", { method: "POST" })}
        title="Resume the bulk campaign"
      >
        ▶ Resume
      </button>
    ) : (
      // Show PAUSE button if running
      <button
        type="button"
        className="bulk-btn pause"
        onClick={() => authFetch("/api/bulk/pause", { method: "POST" })}
        title="Pause the bulk campaign"
      >
        ⏸ Pause
      </button>
    )}

    {/* Stop Button (Always visible during a campaign) */}
    <button
      type="button"
      className="bulk-btn stop"
      onClick={() => {
        if (window.confirm("Are you sure you want to stop this campaign? This action cannot be undone.")) {
          authFetch("/api/bulk/stop", { method: "POST" });
        }
      }}
      title="Permanently stop the campaign"
    >
      ⛔ Stop
    </button>
  </div>
)}

{/* The "Upload CSV" button should live outside the bulk-controls div,
    so you can always start a new campaign. */}
<button
  type="button"
  className="csv-upload-btn"
  disabled={isLoading || !effectiveCanBulkCall || bulkStatus.running} // Also disable if a campaign is already running
  aria-disabled={isLoading || !effectiveCanBulkCall || bulkStatus.running}
  title={!effectiveCanBulkCall ? reason || "Bulk calling is unavailable" : bulkStatus.running ? "A campaign is already in progress" : "Upload a new contact list"}
  onClick={() => fileInputRef.current?.click()}
>
  Upload CSV
</button>
{/* CSV CONFIRMATION MODAL */}
{showCsvModal && (
  <div className="csv-confirm-modal">
    <div className="modal-content">
      <h3>Run Bulk Campaign</h3>

      {/* CAMPAIGN NAME */}
      <div style={{ marginBottom: "10px" }}>
        <label style={{ fontSize: "13px", opacity: 0.8 }}>
          Campaign Name
        </label>
        <input
          type="text"
          placeholder="e.g. January Follow-ups"
          value={campaignName}
          onChange={(e) => setCampaignName(e.target.value)}
          style={{
            width: "100%",
            padding: "8px",
            marginTop: "4px",
            borderRadius: "6px",
          }}
        />
      </div>

      {/* AGENT ASSIGNMENT */}
      <div style={{ marginBottom: "10px" }}>
        <label style={{ fontSize: "13px", opacity: 0.8 }}>
          Assign Agent (optional)
        </label>
        <select
  value={assignedAgentId}
  onChange={(e) => setAssignedAgentId(e.target.value)}
>
  <option value="">— Unassigned / Auto —</option>

  {agents.length === 0 && (
    <option value="" disabled>
      No agents available
    </option>
  )}

  {agents.map((agent) => (
    <option key={agent._id} value={agent._id}>
      {agent.firstName} {agent.lastName}
    </option>
  ))}
</select>


      </div>

      {/* FILE INFO */}
      <p>
        File:
        <br />
        <strong>{pendingCsvFile?.name}</strong>
      </p>

      {/* ROW COUNT */}
      {csvRowCount !== null && (
        <p>📊 <strong>{csvRowCount}</strong> numbers detected</p>
      )}

      {/* PREVIEW ROWS */}
      {csvPreviewRows.length > 0 && (
        <div
          style={{
            marginTop: "12px",
            padding: "10px",
            background: "#020617",
            borderRadius: "8px",
            fontSize: "13px",
            maxHeight: "160px",
            overflowY: "auto",
          }}
        >
          <strong style={{ display: "block", marginBottom: "6px" }}>
            Preview (first {csvPreviewRows.length} rows)
          </strong>

          {csvPreviewRows.map((row, idx) => (
            <div
              key={idx}
              style={{
                padding: "6px 0",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {Object.entries(row).map(([key, value]) => (
                <div key={key}>
                  <span style={{ opacity: 0.6 }}>{key}:</span>{" "}
                  <strong>
                    {key.toLowerCase().includes("number")
                      ? value?.replace(/\d(?=\d{4})/g, "•")
                      : value}
                  </strong>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ACTIONS */}
      <div className="modal-actions" style={{ marginTop: "14px" }}>
        <button
          className="btn cancel"
          onClick={() => {
            setCampaignName("");
            setAssignedAgentId("");
            setPendingCsvFile(null);
            setCsvRowCount(null);
            setCsvPreviewRows([]);
            setShowCsvModal(false);
          }}
        >
          Cancel
        </button>

        <button
  className="btn confirm"
  disabled={isLoading || !effectiveCanBulkCall || !campaignName.trim()}
  onClick={async () => {
    if (!pendingCsvFile) {
      alert("No CSV file selected");
      return;
    }

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", pendingCsvFile);
      formData.append("campaignName", campaignName.trim());

      formData.append("campaignName", campaignName.trim());
    if (assignedAgentId) {
      formData.append("assignedAgentId", assignedAgentId);
    }

      const res = await authFetch("/api/upload-csv", {
        method: "POST",
        body: formData,
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        // backend may return empty body
      }

      if (!res.ok) {
        throw new Error(
          data?.message || `Upload failed (${res.status})`
        );
      }

      // ✅ Success
      await refreshCalls();
      setShowCsvModal(false);
    } catch (err) {
      console.error("❌ Bulk upload failed:", err);
      alert(err.message || "Failed to start bulk campaign");
    } finally {
      setIsLoading(false);
      setCampaignName("");
      setAssignedAgentId("");
      setPendingCsvFile(null);
      setCsvRowCount(null);
      setCsvPreviewRows([]);
    }
  }}
>
  ▶ Run Campaign
</button>

      </div>
    </div>
  </div>
)}


{/* User menu */}
<div className="user-menu-container">
  <button
    className="user-menu-btn"
    onClick={() => setShowUserMenu((v) => !v)}
  >
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
          Plan:{" "}
          <span className="plan-badge">
            {user?.subscription?.plan}
          </span>
        </div>
      </div>

      <div className="dropdown-divider" />
      <a href="/billing" className="dropdown-item">
        💳 Billing &amp; Plans
      </a>
      <a href="/settings" className="dropdown-item">
        ⚙️ Settings
      </a>
      <div className="dropdown-divider" />
      <button className="dropdown-item logout-btn" onClick={logout}>
        🚪 Sign Out
      </button>
    </div>
  )}
</div>


        </div>
      </header>

      {!licenseLoading && reason ? <LicenseBanner message={reason} /> : null}

      {/* Backdrop for closing dropdown */}
      {showUserMenu && <div className="dropdown-backdrop" onClick={() => setShowUserMenu(false)} />}

      {showLiveModeConfirm && (
        <div className="mode-confirm-overlay" onClick={() => setShowLiveModeConfirm(false)}>
          <div className="mode-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="mode-confirm-eyebrow">Live Calling Confirmation</div>
            <h3>Switch this workspace to live mode?</h3>
            <p>
              Live mode sends real provider traffic for this tenant. New calls and campaigns will use
              the live calling path instead of the simulated offline path.
            </p>
            {systemMode?.reason ? <div className="mode-confirm-note">{systemMode.reason}</div> : null}
            <div className="mode-confirm-actions">
              <button type="button" onClick={() => setShowLiveModeConfirm(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="mode-confirm-live-btn"
                onClick={async () => {
                  setShowLiveModeConfirm(false);
                  await performModeSwitch("live");
                }}
                disabled={modeUpdating}
              >
                {modeUpdating ? "Switching..." : "Confirm Live Mode"}
              </button>
            </div>
          </div>
        </div>
      )}

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
              {/* Inside your single call modal */}
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

  {/* RIGHT: Scrollable Content */}
  <div className="call-modal-right">
    <div className="call-status-info">
      <div className="status-indicator">
        <span className="pulse-dot"></span>
        <span>{getStatusLabel()}</span>
      </div>
      <div className="call-timer">
        {activeCall?.createdAt && (
          <>Started at {new Date(activeCall.createdAt).toLocaleTimeString()} · </>
        )}
        Duration: {getLiveDuration()}
      </div>
    </div>

    {/* SCROLLABLE CONTENT AREA */}
    <div className="call-content-scrollable">
      {/* Script Section */}
      <div className="call-script-section">
        <div className="script-header">
          <h4>Call Script</h4>
          <button className="script-toggle-btn" onClick={() => setShowScripts(!showScripts)}>
            {showScripts ? "Hide" : "Show"} Scripts
          </button>
        </div>

        {showScripts && (
          <div className="scripts-panel">
            <ScriptsPanel
              onScriptSelect={setSelectedScript}
              selectedScript={selectedScript}
              fetcher={authFetch}
            />
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
          rows="4"
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
    </div>

    {/* FIXED ACTION BUTTONS */}
    <div className="call-modal-actions">
      <button className="save-notes-btn" onClick={saveCallNotes} disabled={isLoading || !activeCall}>
        Save Notes
      </button>
      <button className="end-call-cta" onClick={endSingleCall} disabled={isLoading || !activeCall}>
        End Call
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
