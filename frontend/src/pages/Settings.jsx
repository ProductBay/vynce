import React, { useEffect, useState } from "react";
import "./Settings.css";
import apiClient from "../apiClient";
import { useAuth } from "../components/AuthContext";

const TIME_ZONES = [
  { value: "America/Jamaica", label: "Jamaica (America/Jamaica)" },
  { value: "America/New_York", label: "US Eastern (America/New_York)" },
  { value: "America/Chicago", label: "US Central (America/Chicago)" },
  { value: "America/Denver", label: "US Mountain (America/Denver)" },
  { value: "America/Los_Angeles", label: "US Pacific (America/Los_Angeles)" },
];

export default function Settings() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const [settings, setSettings] = useState({
    callerId: "",
    vonageApplicationId: "",
    timeZone: "America/Jamaica",
    forwardTo: "",
    publicWebhookUrl: "",
    bulkDelayMs: 1500,
    enableVoicemailDrop: true,
  });

  const [telephonyCredentials, setTelephonyCredentials] = useState({
    apiKey: "",
    apiSecret: "",
    applicationId: "",
    privateKey: "",
    preferredNumber: "",
  });

  const [vonageStatus, setVonageStatus] = useState(null);
  const [vonageAccount, setVonageAccount] = useState(null);
  const [vonageVerification, setVonageVerification] = useState(null);
  const [tenantSeats, setTenantSeats] = useState(null);
  const [addingUser, setAddingUser] = useState(false);
  const [addUserForm, setAddUserForm] = useState({
    tenantId: "",
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    role: "customer",
    grantAdditionalSeat: false,
  });

  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const fetchSettings = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await apiClient.get("/settings");

      if (res.data?.settings) {
        const s = res.data.settings;
        setSettings((prev) => ({
          ...prev,
          ...s,
          enableVoicemailDrop:
            typeof s.enableVoicemailDrop === "boolean"
              ? s.enableVoicemailDrop
              : prev.enableVoicemailDrop,
          timeZone: s.timeZone || prev.timeZone,
        }));
      }

      setVonageStatus(res.data?.vonageStatus || null);
      setVonageAccount(res.data?.vonageAccount || null);
      setVonageVerification(res.data?.vonageVerification || null);

      setTelephonyCredentials((prev) => ({
        ...prev,
        applicationId:
          res.data?.settings?.vonageApplicationId || prev.applicationId || "",
        preferredNumber:
          res.data?.vonageAccount?.outboundNumber || prev.preferredNumber || "",
      }));

      const tenantUsersRes = await apiClient.get("/tenant/users");
      if (tenantUsersRes.data?.data) {
        setTenantSeats(tenantUsersRes.data.data);
        setAddUserForm((prev) => ({
          ...prev,
          tenantId: tenantUsersRes.data.data.tenantId || prev.tenantId,
        }));
      }
    } catch (err) {
      console.error("Error loading settings:", err);
      setError("Could not load settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setSettings((prev) => ({
      ...prev,
      [name]: name === "bulkDelayMs" ? Number(value) : value,
    }));

    if (name === "vonageApplicationId") {
      setTelephonyCredentials((prev) => ({
        ...prev,
        applicationId: value,
      }));
    }
  };

  const handleToggle = (e) => {
    const { name, checked } = e.target;
    setSettings((prev) => ({
      ...prev,
      [name]: checked,
    }));
  };

  const handleTelephonyChange = (e) => {
    const { name, value } = e.target;
    setTelephonyCredentials((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleAddUserChange = (e) => {
    const { name, value, type, checked } = e.target;
    setAddUserForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await apiClient.post("/settings", {
        callerId: settings.callerId,
        vonageApplicationId: settings.vonageApplicationId,
        timeZone: settings.timeZone,
        forwardTo: settings.forwardTo,
        publicWebhookUrl: settings.publicWebhookUrl,
        bulkDelayMs: settings.bulkDelayMs,
        enableVoicemailDrop: settings.enableVoicemailDrop,
      });

      if (res.data?.settings) {
        setSettings((prev) => ({
          ...prev,
          ...res.data.settings,
        }));
      }

      setSuccess("Settings saved successfully.");
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      console.error("Error saving settings:", err);
      setError("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const testVonage = async () => {
    setVerifying(true);
    setVonageStatus({
      ok: false,
      code: "VERIFYING",
      message: "Verifying Vonage credentials...",
    });
    setVonageAccount(null);
    setVonageVerification(null);
    setError(null);

    try {
      const res = await apiClient.post("/telephony/vonage/verify", {
        apiKey: telephonyCredentials.apiKey,
        apiSecret: telephonyCredentials.apiSecret,
        applicationId:
          telephonyCredentials.applicationId || settings.vonageApplicationId,
        privateKey: telephonyCredentials.privateKey,
        preferredNumber: telephonyCredentials.preferredNumber,
      });

      setVonageStatus({
        ok: true,
        code: res.data?.verification?.code || "VERIFIED",
        message: res.data?.verification?.message || "Vonage credentials verified.",
      });
      setVonageAccount(res.data?.account || res.data?.verification?.account || null);
      setVonageVerification(res.data?.verification || null);
      setTelephonyCredentials((prev) => ({
        ...prev,
        apiSecret: "",
        privateKey: "",
      }));
    } catch (err) {
      console.error("Vonage test failed:", err);
      const verification = err.response?.data?.verification || null;

      setVonageStatus({
        ok: false,
        code: verification?.code || "FAILED",
        message:
          verification?.message ||
          err.response?.data?.message ||
          "Vonage test failed",
      });
      setVonageVerification(verification);
      setVonageAccount(verification?.account || null);
    } finally {
      setVerifying(false);
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
      const res = await apiClient.post("/admin/clear-calls");

      if (res.data?.success) {
        alert("Call history cleared for this server session.");
      } else {
        alert(res.data?.message || "Failed to clear history");
      }
    } catch (err) {
      console.error("Failed to clear history:", err);
      alert("Failed to clear call history.");
    }
  };

  const createTenantUser = async (e) => {
    e.preventDefault();
    setAddingUser(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await apiClient.post("/admin/tenant-users", addUserForm);
      if (!res.data?.success) {
        throw new Error(res.data?.message || "Failed to create tenant user.");
      }

      setTenantSeats(res.data?.data || null);
      setAddUserForm((prev) => ({
        ...prev,
        firstName: "",
        lastName: "",
        email: "",
        password: "",
        role: "customer",
        grantAdditionalSeat: false,
      }));
      setSuccess("Tenant user created successfully.");
    } catch (err) {
      console.error("Failed to create tenant user:", err);
      setError(
        err.response?.data?.message || err.message || "Failed to create tenant user."
      );
      if (err.response?.data?.data) {
        setTenantSeats(err.response.data.data);
      }
    } finally {
      setAddingUser(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <div>
          <h1>Settings</h1>
          <p>Configure dialer behavior, telephony validation, and operational defaults.</p>
        </div>
        {user ? (
          <div className="settings-user">
            <div className="settings-user-name">
              {user.firstName} {user.lastName}
            </div>
            <div className="settings-user-email">{user.email}</div>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="settings-loading">Loading settings...</div>
      ) : (
        <div className="settings-grid">
          <section className="settings-card">
            <h2>Call Settings</h2>

            <div className="settings-row">
              <label>Default caller ID</label>
              <input
                name="callerId"
                type="tel"
                value={settings.callerId || ""}
                onChange={handleChange}
              />
            </div>

            <div className="settings-row">
              <label>Time zone</label>
              <select
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
            </div>

            <div className="settings-row">
              <label>Vonage application ID</label>
              <input
                name="vonageApplicationId"
                type="text"
                value={settings.vonageApplicationId || ""}
                onChange={handleChange}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              />
            </div>

            <div className="settings-row">
              <label>Forward to</label>
              <input
                name="forwardTo"
                type="tel"
                value={settings.forwardTo || ""}
                onChange={handleChange}
              />
            </div>

            <div className="settings-row">
              <label>Public webhook URL</label>
              <input
                name="publicWebhookUrl"
                type="url"
                value={settings.publicWebhookUrl || ""}
                onChange={handleChange}
                placeholder="https://your-domain.com"
              />
            </div>
          </section>

          <section className="settings-card">
            <h2>Vonage Verification</h2>
            <p className="settings-subtext">
              A real backend verification must succeed before the onboarding telephony step is
              marked complete.
            </p>

            <div className="settings-row">
              <label>Vonage API key</label>
              <input
                name="apiKey"
                type="text"
                value={telephonyCredentials.apiKey}
                onChange={handleTelephonyChange}
                placeholder="Enter your Vonage API key"
              />
            </div>

            <div className="settings-row">
              <label>Vonage API secret</label>
              <input
                name="apiSecret"
                type="password"
                value={telephonyCredentials.apiSecret}
                onChange={handleTelephonyChange}
                placeholder="Enter your Vonage API secret"
              />
            </div>

            <div className="settings-row">
              <label>Private key</label>
              <textarea
                name="privateKey"
                value={telephonyCredentials.privateKey}
                onChange={handleTelephonyChange}
                placeholder="Paste the Vonage application private key"
                rows={6}
              />
            </div>

            <div className="settings-row">
              <label>Preferred outbound number</label>
              <input
                name="preferredNumber"
                type="tel"
                value={telephonyCredentials.preferredNumber}
                onChange={handleTelephonyChange}
                placeholder="+15551234567"
              />
            </div>

            <div className="settings-inline-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={testVonage}
                disabled={verifying}
              >
                {verifying ? "Verifying..." : "Verify Vonage"}
              </button>
            </div>

            {vonageStatus ? (
              <div className={`vonage-status-card ${vonageStatus.ok ? "ok" : "error"}`}>
                <div className="vonage-status-top">
                  <strong>{vonageStatus.ok ? "Verified" : "Verification failed"}</strong>
                  {vonageStatus.code ? (
                    <span className="verification-code">{vonageStatus.code}</span>
                  ) : null}
                </div>
                <p>{vonageStatus.message}</p>

                {vonageVerification?.checkedAt ? (
                  <div className="verification-meta">
                    Checked: {new Date(vonageVerification.checkedAt).toLocaleString()}
                  </div>
                ) : null}

                {vonageVerification?.aiExplanation ? (
                  <div className="verification-ai">
                    <strong>AI troubleshooting summary</strong>
                    <p>{vonageVerification.aiExplanation}</p>
                  </div>
                ) : null}

                {Array.isArray(vonageVerification?.suggestedActions) &&
                vonageVerification.suggestedActions.length > 0 ? (
                  <div className="verification-actions-list">
                    <strong>Next steps</strong>
                    <ul>
                      {vonageVerification.suggestedActions.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {vonageAccount ? (
              <div className="vonage-account-summary">
                <div className="vonage-plan">
                  <span className="plan-badge">{vonageAccount.label || "Vonage account"}</span>
                </div>
                {vonageAccount.apiKeyMasked ? (
                  <div className="vonage-api-key">
                    API key: <span className="mono">{vonageAccount.apiKeyMasked}</span>
                  </div>
                ) : null}
                {vonageAccount.applicationId ? (
                  <div>Application: {vonageAccount.applicationId}</div>
                ) : null}
                {vonageAccount.outboundNumber ? (
                  <div>Outbound number: {vonageAccount.outboundNumber}</div>
                ) : null}
                {vonageAccount.balance ? (
                  <div>
                    Balance: {vonageAccount.balance} {vonageAccount.currency || ""}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="settings-card">
            <h2>Dialer Configuration</h2>
            <form onSubmit={saveSettings}>
              <div className="settings-row">
                <label>Delay between bulk calls (ms)</label>
                <input
                  name="bulkDelayMs"
                  type="number"
                  value={settings.bulkDelayMs}
                  onChange={handleChange}
                />
              </div>

              <div className="settings-row">
                <label>
                  <input
                    type="checkbox"
                    name="enableVoicemailDrop"
                    checked={!!settings.enableVoicemailDrop}
                    onChange={handleToggle}
                  />
                  &nbsp;Enable voicemail drop
                </label>
              </div>

              {error ? <div className="settings-error">{error}</div> : null}
              {success ? <div className="settings-success">{success}</div> : null}

              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Settings"}
              </button>
            </form>
          </section>

          <section className="settings-card danger-card">
            <h2>Admin Tools</h2>
            <button
              type="button"
              className="btn btn-danger"
              onClick={clearCallHistory}
            >
              Clear Call History (in-memory)
            </button>
          </section>

          <section className="settings-card">
            <h2>Tenant Seats</h2>
            <p className="settings-subtext">
              Professional includes one active user by default. Additional tenant users must be
              provisioned by superadmin.
            </p>

            {tenantSeats ? (
              <>
                <div className="settings-seat-grid">
                  <div className="settings-seat-stat">
                    <span>Plan</span>
                    <strong>{tenantSeats?.commercial?.plan || tenantSeats.plan}</strong>
                  </div>
                  <div className="settings-seat-stat">
                    <span>Included users</span>
                    <strong>
                      {tenantSeats?.commercial?.includedUsers ?? tenantSeats.includedActiveUsers}
                    </strong>
                  </div>
                  <div className="settings-seat-stat">
                    <span>Extra seats</span>
                    <strong>
                      {tenantSeats?.commercial?.extraSeats ?? tenantSeats.additionalAgentSeats}
                    </strong>
                  </div>
                  <div className="settings-seat-stat">
                    <span>Active users</span>
                    <strong>
                      {tenantSeats.activeUserCount}/
                      {Number.isFinite(tenantSeats.totalSeats) ? tenantSeats.totalSeats : "Unlimited"}
                    </strong>
                  </div>
                  <div className="settings-seat-stat">
                    <span>Commercial status</span>
                    <strong>{tenantSeats?.commercial?.commercialStatus || "unknown"}</strong>
                  </div>
                  <div className="settings-seat-stat">
                    <span>User provisioning</span>
                    <strong>{tenantSeats?.canProvisionUser ? "Allowed" : "Blocked"}</strong>
                  </div>
                </div>

                {tenantSeats?.commercial?.degraded ? (
                  <div className="settings-danger-text">
                    {tenantSeats.commercial.degradedReason ||
                      "Control plane is unavailable. Commercial operations are temporarily blocked."}
                  </div>
                ) : null}

                <div className="settings-seat-users">
                  {tenantSeats.users?.map((tenantUser) => (
                    <div key={tenantUser.id} className="settings-seat-user">
                      <div>
                        <strong>
                          {tenantUser.firstName} {tenantUser.lastName}
                        </strong>
                        <div className="settings-seat-email">{tenantUser.email}</div>
                      </div>
                      <span className="plan-badge">{tenantUser.role}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="settings-loading">Loading seat usage...</div>
            )}

            {!user?.isSuperAdmin ? (
              <div className="settings-danger-text">
                Additional tenant users must be added by a superadmin.
              </div>
            ) : null}

            {user?.isSuperAdmin ? (
              <form className="settings-add-user-form" onSubmit={createTenantUser}>
                {tenantSeats && !tenantSeats.canProvisionUser ? (
                  <div className="settings-danger-text">
                    User provisioning is blocked by commercial seat entitlement. Contact Vynce
                    support to increase seats or resolve commercial status.
                  </div>
                ) : null}

                <div className="settings-row">
                  <label>Tenant ID</label>
                  <input
                    name="tenantId"
                    type="text"
                    value={addUserForm.tenantId}
                    onChange={handleAddUserChange}
                  />
                </div>

                <div className="settings-two-column">
                  <div className="settings-row">
                    <label>First name</label>
                    <input
                      name="firstName"
                      type="text"
                      value={addUserForm.firstName}
                      onChange={handleAddUserChange}
                    />
                  </div>

                  <div className="settings-row">
                    <label>Last name</label>
                    <input
                      name="lastName"
                      type="text"
                      value={addUserForm.lastName}
                      onChange={handleAddUserChange}
                    />
                  </div>
                </div>

                <div className="settings-two-column">
                  <div className="settings-row">
                    <label>Email</label>
                    <input
                      name="email"
                      type="email"
                      value={addUserForm.email}
                      onChange={handleAddUserChange}
                    />
                  </div>

                  <div className="settings-row">
                    <label>Password</label>
                    <input
                      name="password"
                      type="password"
                      value={addUserForm.password}
                      onChange={handleAddUserChange}
                    />
                  </div>
                </div>

                <div className="settings-two-column">
                  <div className="settings-row">
                    <label>Role</label>
                    <select
                      name="role"
                      value={addUserForm.role}
                      onChange={handleAddUserChange}
                    >
                      <option value="customer">Customer</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>

                  <div className="settings-row settings-row-checkbox">
                    <label>
                      <input
                        name="grantAdditionalSeat"
                        type="checkbox"
                        checked={addUserForm.grantAdditionalSeat}
                        onChange={handleAddUserChange}
                      />
                      &nbsp;Grant additional paid seat if needed
                    </label>
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={addingUser || (tenantSeats && !tenantSeats.canProvisionUser)}
                >
                  {addingUser ? "Adding User..." : "Add Tenant User"}
                </button>
              </form>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
