// frontend/src/pages/Settings.jsx
import React, { useEffect, useState } from "react";
import "./Settings.css";
import API_BASE_URL from "../api";
import { useAuth } from "../components/AuthContext";

const TIME_ZONES = [
  { value: "America/Jamaica", label: "Jamaica (America/Jamaica)" },
  { value: "America/New_York", label: "US Eastern (America/New_York)" },
  { value: "America/Chicago", label: "US Central (America/Chicago)" },
  { value: "America/Denver", label: "US Mountain (America/Denver)" },
  { value: "America/Los_Angeles", label: "US Pacific (America/Los_Angeles)" },
  // add more as needed
];

export default function Settings() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Settings state
  const [settings, setSettings] = useState({
    callerId: "",
    timeZone: "America/Jamaica",
    forwardTo: "",
    publicWebhookUrl: "",
    bulkDelayMs: 1500,
    enableVoicemailDrop: true,
  });

  const [vonageStatus, setVonageStatus] = useState(null);
  const [vonageAccount, setVonageAccount] = useState(null);

  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Mask Vonage API key for display
  const maskApiKey = (key) => {
    if (!key) return "";
    if (key.length <= 4) return key;
    return key.slice(0, 4) + "••••" + key.slice(-2);
  };

  // Load settings from backend
  const fetchSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/settings`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      const data = await res.json();

      if (data.settings) {
        const s = data.settings;
        setSettings((prev) => ({
          ...prev,
          ...s,
          enableVoicemailDrop:
            typeof s.enableVoicemailDrop === "boolean"
              ? s.enableVoicemailDrop
              : prev.enableVoicemailDrop,
          timeZone: s.timeZone || prev.timeZone || "America/Jamaica",
        }));
      }

      if (data.vonageStatus) setVonageStatus(data.vonageStatus);
      if (data.vonageAccount) setVonageAccount(data.vonageAccount);
    } catch (err) {
      console.error("Error loading settings:", err);
      setError(err.message || "Could not load settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Numeric / text / select inputs (bulkDelayMs, callerId, timeZone, forwardTo)
  const handleChange = (e) => {
    const { name, value } = e.target;
    setSettings((prev) => ({
      ...prev,
      [name]: name === "bulkDelayMs" ? Number(value) : value,
    }));
  };

  // Checkbox toggle (enableVoicemailDrop)
  const handleToggle = (e) => {
    const { name, checked } = e.target;
    setSettings((prev) => ({
      ...prev,
      [name]: checked,
    }));
  };

  // Save settings to backend
  const saveSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/settings`, {
        method: "POST", // keep POST if your backend expects POST here
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callerId: settings.callerId,
          timeZone: settings.timeZone,
          forwardTo: settings.forwardTo,
          publicWebhookUrl: settings.publicWebhookUrl,
          bulkDelayMs: settings.bulkDelayMs,
          enableVoicemailDrop: settings.enableVoicemailDrop,
        }),
      });

      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      const data = await res.json();

      if (data.settings) {
        setSettings((prev) => ({
          ...prev,
          ...data.settings,
        }));
      }

      setSuccess("Settings saved successfully.");
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      console.error("Error saving settings:", err);
      setError(err.message || "Could not save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // Test Vonage connection + load account info
  const testVonage = async () => {
    setVonageStatus({ loading: true });
    setVonageAccount(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/vonage/test`);
      const data = await res.json();
      if (res.ok && data.success) {
        setVonageStatus({
          ok: true,
          message: `Connected. Balance: ${data.balance} ${data.currency || ""}`,
        });
        setVonageAccount(data.account || null);
      } else {
        setVonageStatus({
          ok: false,
          message: data.message || `Failed with status ${res.status}`,
        });
        setVonageAccount(null);
      }
    } catch (err) {
      console.error("Vonage test failed:", err);
      setVonageStatus({ ok: false, message: err.message });
      setVonageAccount(null);
    }
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(settings.publicWebhookUrl || "");
      alert("Webhook URL copied to clipboard");
    } catch (e) {
      alert("Could not copy to clipboard");
    }
  };

  const clearCallHistory = async () => {
    if (
      !window.confirm(
        "This will clear all in-memory call records for this server session. Continue?"
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/clear-calls`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        alert("Call history cleared for this server session.");
      } else {
        alert(data.message || "Failed to clear history");
      }
    } catch (err) {
      console.error("Failed to clear history:", err);
      alert(err.message);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <div>
          <h1>⚙️ Settings</h1>
          <p>Configure dialer behavior and connection settings.</p>
        </div>
        <div className="settings-user">
          {user && (
            <>
              <div className="settings-user-name">
                {user.firstName} {user.lastName}
              </div>
              <div className="settings-user-email">{user.email}</div>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="settings-loading">Loading settings...</div>
      ) : (
        <div className="settings-grid">
          {/* Call & System Settings */}
          <section className="settings-card">
            <h2>Call Settings</h2>

            <div className="settings-row">
              <label htmlFor="callerId">Default caller ID</label>
              <input
                id="callerId"
                name="callerId"
                type="tel"
                value={settings.callerId || ""}
                onChange={handleChange}
                placeholder="+15551234567"
              />
              <small>
                This should be a number you are authorized to use with your
                telephony provider. Vynce does not verify ownership or legal
                authority to call from this number.
              </small>
            </div>

            <div className="settings-row">
              <label htmlFor="timeZone">Time zone</label>
              <select
                id="timeZone"
                name="timeZone"
                value={settings.timeZone}
                onChange={handleChange}
              >
                {TIME_ZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
              <small>
                Used for displaying timestamps and (later) scheduling logic in
                your dashboard.
              </small>
            </div>

            <div className="settings-row">
              <label htmlFor="forwardTo">Forward to (agent number)</label>
              <input
                id="forwardTo"
                name="forwardTo"
                type="tel"
                value={settings.forwardTo || ""}
                onChange={handleChange}
                placeholder="+15038030780"
              />
              <small>
                Number Vynce forwards live calls to. Use E.164 format, e.g.
                +1XXXXXXXXXX.
              </small>
            </div>

            <div className="settings-row">
              <label>Public Webhook URL</label>
              <div className="settings-webhook">
                <input
                  type="text"
                  value={settings.publicWebhookUrl || ""}
                  readOnly
                />
                <button type="button" onClick={copyWebhook}>
                  Copy
                </button>
              </div>
              <small>
                Vynce can POST call events to this URL for integrations. This
                URL is typically configured server‑side.
              </small>
            </div>
          </section>

          {/* Vonage Account */}
          <section className="settings-card">
            <h2>Vonage Account</h2>
            <p className="settings-subtext">
              View your Vonage Voice account status and open the Vonage
              dashboard.
            </p>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={testVonage}
            >
              Test Vonage Connection
            </button>

            {vonageStatus && (
              <div
                className={`vonage-status ${
                  vonageStatus.ok ? "ok" : "error"
                }`}
              >
                {vonageStatus.loading
                  ? "Testing..."
                  : vonageStatus.message}
              </div>
            )}

            {vonageAccount && (
              <div className="vonage-account-summary">
                <div className="vonage-plan">
                  Plan:{" "}
                  <span className="plan-badge">
                    {vonageAccount.label || "Vonage Voice (pay‑as‑you‑go)"}
                  </span>
                </div>
                <div className="vonage-api-key">
                  API Key:&nbsp;
                  <span className="mono">
                    {maskApiKey(vonageAccount.apiKey)}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-link"
                  onClick={() =>
                    window.open(
                      vonageAccount.dashboardUrl ||
                        "https://dashboard.vonage.com",
                      "_blank"
                    )
                  }
                >
                  Open Vonage Dashboard
                </button>
              </div>
            )}
          </section>

          {/* Dialer Configuration */}
          <section className="settings-card">
            <h2>Dialer Configuration</h2>
            <form onSubmit={saveSettings}>
              <div className="settings-row">
                <label htmlFor="bulkDelayMs">
                  Delay between bulk calls (milliseconds)
                </label>
                <input
                  id="bulkDelayMs"
                  name="bulkDelayMs"
                  type="number"
                  min="0"
                  max="60000"
                  step="100"
                  value={settings.bulkDelayMs}
                  onChange={handleChange}
                />
                <small>
                  How long to wait between each call in a bulk CSV campaign.
                  Higher = slower but safer.
                </small>
              </div>

              <div className="settings-row">
                <label>
                  <input
                    type="checkbox"
                    name="enableVoicemailDrop"
                    checked={!!settings.enableVoicemailDrop}
                    onChange={handleToggle}
                  />
                  &nbsp;Enable voicemail drop on answering machines
                </label>
                <small>
                  When enabled, Vynce will automatically play your active
                  voicemail script when answering machine detection detects
                  voicemail.
                </small>
              </div>

              {error && <div className="settings-error">{error}</div>}
              {success && <div className="settings-success">{success}</div>}

              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving ? "Saving…" : "Save Settings"}
              </button>
            </form>
          </section>

          {/* Admin Tools */}
          <section className="settings-card danger-card">
            <h2>Admin Tools</h2>
            <p className="settings-danger-text">
              These tools affect only this backend instance. Use carefully in
              production.
            </p>
            <button
              type="button"
              className="btn btn-danger"
              onClick={clearCallHistory}
            >
              Clear Call History (in-memory)
            </button>
          </section>
        </div>
      )}
    </div>
  );
}