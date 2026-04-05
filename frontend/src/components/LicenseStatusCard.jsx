import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext";

const REASON_OPTIONS = [
  { value: "non_payment", label: "Non-payment" },
  { value: "abuse", label: "Abuse" },
  { value: "manual_review", label: "Manual review" },
  { value: "compliance", label: "Compliance" },
  { value: "other", label: "Other" },
];

function formatStatusLabel(status) {
  if (status === "active") return "Active";
  if (status === "temporarily_suspended") return "Temporary Suspension";
  if (status === "suspended") return "Suspended";
  return "Unknown";
}

export default function LicenseStatusCard({ tenantId, companyName }) {
  const { authFetch, user } = useAuth();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [reasonCode, setReasonCode] = useState("non_payment");
  const [reasonText, setReasonText] = useState("");
  const [disabledUntil, setDisabledUntil] = useState("");
  const [issueSaving, setIssueSaving] = useState(false);
  const [issueError, setIssueError] = useState("");
  const [issuedKey, setIssuedKey] = useState("");
  const [copyState, setCopyState] = useState("idle");
  const [issueForm, setIssueForm] = useState({
    plan: "professional",
    maxActivations: 1,
    includedUsers: 1,
    extraSeats: 0,
    expiresAt: "",
    performedBy: user?.email || "",
    reason: "Tenant commercial onboarding",
  });

  useEffect(() => {
    setIssueForm((prev) => ({
      ...prev,
      performedBy: user?.email || prev.performedBy,
    }));
  }, [user?.email]);

  const load = useCallback(
    async (tid) => {
      if (!tid) return;

      try {
        setLoading(true);
        setError("");

        const res = await authFetch(`/api/admin/license?tenantId=${tid}`);
        const json = await res.json();

        if (!json.success) {
          throw new Error(json.message || "Failed to load license");
        }

        setData(json.data);
        setReasonCode(json.data?.reasonCode || "non_payment");
        setReasonText(json.data?.reasonText || "");
        setDisabledUntil(
          json.data?.disabledUntil
            ? new Date(json.data.disabledUntil).toISOString().slice(0, 16)
            : ""
        );
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [authFetch]
  );

  useEffect(() => {
    load(tenantId);
  }, [tenantId, load]);

  useEffect(() => {
    setIssuedKey("");
    setIssueError("");
    setCopyState("idle");
  }, [tenantId]);

  const status = data?.status || "unknown";
  const statusLabel = useMemo(() => formatStatusLabel(status), [status]);
  const identity = data?.licenseIdentity || {};
  const planName = data?.plan || identity.plan || "—";
  const isActive = status === "active";
  const isTempSuspended = status === "temporarily_suspended";
  const isSuspended = status === "suspended";

  async function submitAction(action) {
    if (!tenantId) return;

    if ((action === "suspend" || action === "temporary_suspend") && !reasonCode) {
      setActionError("Choose a suspension reason before submitting.");
      return;
    }

    if (action === "temporary_suspend" && !disabledUntil) {
      setActionError("Choose when the temporary suspension should end.");
      return;
    }

    try {
      setSaving(true);
      setActionError("");

      const res = await authFetch(`/api/admin/license?tenantId=${tenantId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reasonCode,
          reasonText,
          disabledUntil:
            action === "temporary_suspend"
              ? new Date(disabledUntil).toISOString()
              : null,
        }),
      });

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.message || "Failed to update tenant access");
      }

      setData(json.data);
      setReasonCode(json.data?.reasonCode || "non_payment");
      setReasonText(json.data?.reasonText || "");
      setDisabledUntil(
        json.data?.disabledUntil
          ? new Date(json.data.disabledUntil).toISOString().slice(0, 16)
          : ""
      );
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitIssueKey() {
    if (!tenantId) return;

    try {
      setIssueSaving(true);
      setIssueError("");
      setIssuedKey("");
      setCopyState("idle");

      const payload = {
        plan: issueForm.plan,
        maxActivations: Number(issueForm.maxActivations),
        includedUsers: Number(issueForm.includedUsers),
        extraSeats: Number(issueForm.extraSeats),
        expiresAt: issueForm.expiresAt
          ? new Date(issueForm.expiresAt).toISOString()
          : null,
        performedBy: issueForm.performedBy || user?.email || "admin@vynce.local",
        reason: issueForm.reason,
      };

      const res = await authFetch(`/api/admin/license/issue?tenantId=${encodeURIComponent(tenantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        const status = Number(res.status || 500);
        const message =
          json?.message ||
          (status === 401 || status === 403
            ? "You do not have permission to issue license keys."
            : status === 409
              ? "License issuance conflict: tenant already has an active license in control plane."
              : status === 429
                ? "Rate limit reached. Please retry shortly."
                : "Failed to issue license key.");
        throw new Error(message);
      }

      const key = String(json?.data?.licenseKey || "").trim();
      if (!key) {
        throw new Error("Control plane did not return a raw license key.");
      }

      setIssuedKey(key);
      await load(tenantId);
    } catch (err) {
      setIssueError(err.message || "Failed to issue license key.");
    } finally {
      setIssueSaving(false);
    }
  }

  async function copyIssuedKey() {
    if (!issuedKey) return;
    try {
      await navigator.clipboard.writeText(issuedKey);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  if (!tenantId) {
    return (
      <div className="license-card">
        <p style={{ opacity: 0.7 }}>Select a tenant to manage access.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="license-card enterprise">
        <h3>Tenant Access Control</h3>
        <p>Loading tenant state…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="license-card error enterprise">
        <h3>Tenant Access Control</h3>
        <p className="error-text">❌ {error}</p>
      </div>
    );
  }

  return (
    <section className="license-card enterprise">
      <div className="license-card-top">
        <div>
          <div className="license-section-kicker">Access Enforcement</div>
          <h3>Tenant Access Control</h3>
          <p className="license-card-subtitle">
            Use this panel to suspend, temporarily restrict, or restore tenant access.
          </p>
        </div>

        <div className={`license-status-pill ${status}`}>
          <span className="license-status-dot" />
          {statusLabel}
        </div>
      </div>

      <div className="license-overview-grid">
        <div className="license-overview-card critical">
          <span>Company</span>
          <strong>{identity.company || companyName || "Unknown Company"}</strong>
          <small>Primary tenant record</small>
        </div>
        <div className="license-overview-card">
          <span>Tenant ID</span>
          <strong>{identity.tenantId || tenantId}</strong>
          <small>Operations reference</small>
        </div>
        <div className="license-overview-card">
          <span>License ID</span>
          <strong>{identity.licenseId || "—"}</strong>
          <small>Platform entitlement</small>
        </div>
        <div className="license-overview-card">
          <span>Plan</span>
          <strong>{planName}</strong>
          <small>Commercial tier</small>
        </div>
      </div>

      <div className="license-impact-banner">
        These actions affect login, single calling, bulk campaigns, and protected tenant APIs.
      </div>

      <div className="license-detail-grid">
        <div className="license-detail-card">
          <h4>Current State</h4>
          <div className="license-detail-list">
            <div>
              <span>Status</span>
              <strong>{statusLabel}</strong>
            </div>
            <div>
              <span>Updated By</span>
              <strong>{data?.updatedBy?.email || "System"}</strong>
            </div>
            {data?.reasonCode ? (
              <div>
                <span>Reason</span>
                <strong>
                  {data.reasonCode.replace(/_/g, " ")}
                  {data.reasonText ? ` — ${data.reasonText}` : ""}
                </strong>
              </div>
            ) : null}
            {data?.disabledUntil ? (
              <div>
                <span>Disabled Until</span>
                <strong>{new Date(data.disabledUntil).toLocaleString()}</strong>
              </div>
            ) : null}
          </div>
        </div>

        <div className="license-detail-card action-panel">
          <h4>Administrative Action</h4>

          <div className="license-form-grid">
            <label className="license-field">
              <span>Suspension Reason</span>
              <select
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                disabled={saving}
              >
                {REASON_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="license-field">
              <span>Admin Note</span>
              <input
                type="text"
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder="Optional internal note"
                disabled={saving}
              />
            </label>

            <label className="license-field full">
              <span>Temporary Suspension Ends</span>
              <input
                type="datetime-local"
                value={disabledUntil}
                onChange={(e) => setDisabledUntil(e.target.value)}
                disabled={saving}
              />
            </label>
          </div>

          <div className="license-action-guidance">
            <strong>Suspend</strong> blocks the tenant until manually restored.
            <strong> Temporary Suspend</strong> restores access automatically at the selected time.
          </div>

          {actionError ? <p className="error-text">❌ {actionError}</p> : null}

          <div className="license-actions enterprise">
            {isActive ? (
              <>
                <button
                  onClick={() => submitAction("suspend")}
                  disabled={saving}
                  className="danger"
                >
                  {saving ? "Updating…" : "Suspend Tenant"}
                </button>
                <button
                  onClick={() => submitAction("temporary_suspend")}
                  disabled={saving}
                  className="secondary"
                >
                  {saving ? "Updating…" : "Temporary Suspend"}
                </button>
              </>
            ) : (
              <button
                onClick={() => submitAction("reenable")}
                disabled={saving}
                className="primary"
              >
                {saving ? "Updating…" : "Re-enable Tenant"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="license-detail-card issue-panel">
        <h4>Issue Tenant License Key</h4>
        <p className="issue-help-text">
          Generate a raw license key for tenant distribution. This key is shown once in this session.
        </p>

        <div className="license-form-grid">
          <label className="license-field">
            <span>Plan</span>
            <input
              type="text"
              value={issueForm.plan}
              onChange={(e) => setIssueForm((prev) => ({ ...prev, plan: e.target.value }))}
              disabled={issueSaving}
            />
          </label>

          <label className="license-field">
            <span>Max Activations</span>
            <input
              type="number"
              min="1"
              value={issueForm.maxActivations}
              onChange={(e) =>
                setIssueForm((prev) => ({ ...prev, maxActivations: e.target.value }))
              }
              disabled={issueSaving}
            />
          </label>

          <label className="license-field">
            <span>Included Users</span>
            <input
              type="number"
              min="1"
              value={issueForm.includedUsers}
              onChange={(e) =>
                setIssueForm((prev) => ({ ...prev, includedUsers: e.target.value }))
              }
              disabled={issueSaving}
            />
          </label>

          <label className="license-field">
            <span>Extra Seats</span>
            <input
              type="number"
              min="0"
              value={issueForm.extraSeats}
              onChange={(e) => setIssueForm((prev) => ({ ...prev, extraSeats: e.target.value }))}
              disabled={issueSaving}
            />
          </label>

          <label className="license-field">
            <span>Expires At (Optional)</span>
            <input
              type="datetime-local"
              value={issueForm.expiresAt}
              onChange={(e) => setIssueForm((prev) => ({ ...prev, expiresAt: e.target.value }))}
              disabled={issueSaving}
            />
          </label>

          <label className="license-field">
            <span>Performed By</span>
            <input
              type="email"
              value={issueForm.performedBy}
              onChange={(e) => setIssueForm((prev) => ({ ...prev, performedBy: e.target.value }))}
              disabled={issueSaving}
            />
          </label>

          <label className="license-field full">
            <span>Reason</span>
            <input
              type="text"
              value={issueForm.reason}
              onChange={(e) => setIssueForm((prev) => ({ ...prev, reason: e.target.value }))}
              disabled={issueSaving}
            />
          </label>
        </div>

        {issueError ? <p className="error-text">❌ {issueError}</p> : null}

        <div className="license-actions enterprise">
          <button
            onClick={submitIssueKey}
            disabled={issueSaving}
            className="primary"
            type="button"
          >
            {issueSaving ? "Issuing..." : "Issue License Key"}
          </button>
        </div>

        {issuedKey ? (
          <div className="issued-key-box" role="status" aria-live="polite">
            <div className="issued-key-header">
              <strong>One-time license key display</strong>
              <button type="button" className="secondary" onClick={copyIssuedKey}>
                {copyState === "copied" ? "Copied" : "Copy Key"}
              </button>
            </div>
            <code>{issuedKey}</code>
            <p>
              Store and distribute this key securely. It is not persisted in browser storage by this UI.
            </p>
            {copyState === "failed" ? (
              <p className="error-text">❌ Clipboard copy failed. Copy manually from above.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {(isSuspended || isTempSuspended) && (
        <div className="admin-warning strong">
          This tenant is currently blocked from normal platform use until access is restored.
        </div>
      )}
    </section>
  );
}
