import React, { useCallback, useEffect, useMemo, useState } from "react";
import LicenseStatusCard from "../../components/LicenseStatusCard";
import LicenseAuditTable from "../../components/LicenseAuditTable";
import { useAuth } from "../../components/AuthContext";
import "../../styles/admin-license.css";

const ISSUE_PROFILE_PRESETS = {
  starter: {
    plan: "development",
    maxActivations: 1,
    includedUsers: 1,
    extraSeats: 0,
    reason: "Starter tier onboarding",
    expiresInDays: 30,
  },
  professional: {
    plan: "professional",
    maxActivations: 3,
    includedUsers: 5,
    extraSeats: 0,
    reason: "Professional tier onboarding",
    expiresInDays: 365,
  },
  enterprise: {
    plan: "enterprise",
    maxActivations: 10,
    includedUsers: 25,
    extraSeats: 0,
    reason: "Enterprise tier onboarding",
    expiresInDays: 0,
  },
};

function toDateTimeLocalValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export default function AdminLicense() {
  const { authFetch, user } = useAuth();

  const [tenants, setTenants] = useState([]);
  const [tenantId, setTenantId] = useState("");
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [error, setError] = useState("");
  const [showCreateTenant, setShowCreateTenant] = useState(false);
  const [createTenantSaving, setCreateTenantSaving] = useState(false);
  const [createTenantError, setCreateTenantError] = useState("");
  const [createTenantSuccess, setCreateTenantSuccess] = useState("");
  const [combinedIssuedKey, setCombinedIssuedKey] = useState("");
  const [combinedCopyState, setCombinedCopyState] = useState("idle");
  const [issueProfile, setIssueProfile] = useState("professional");
  const [createTenantForm, setCreateTenantForm] = useState({
    tenantId: "",
    companyName: "",
    contactEmail: "",
    plan: "professional",
    maxActivations: 1,
    includedUsers: 1,
    extraSeats: 0,
    expiresAt: "",
    performedBy: user?.email || "",
    reason: "Tenant commercial onboarding",
  });

  useEffect(() => {
    setCreateTenantForm((prev) => ({
      ...prev,
      performedBy: user?.email || prev.performedBy,
    }));
  }, [user?.email]);

  if (!user || (!user.isSuperAdmin && user.role !== "admin")) {
    return (
      <div className="license-page">
        <h2>Access Denied</h2>
        <p style={{ opacity: 0.75 }}>
          You do not have permission to manage licenses.
        </p>
      </div>
    );
  }

  const loadTenants = useCallback(
    async (preferredTenantId = "") => {
      try {
        setError("");
        setLoadingTenants(true);

        const res = await authFetch("/api/admin/tenants");
        const text = await res.text();

        let json;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error("Authentication expired. Please log in again.");
        }

        if (!json.success) {
          throw new Error(json.message || "Failed to load tenants");
        }

        const list = json.tenants || [];
        setTenants(list);

        if (list.length === 0) {
          setTenantId("");
          return;
        }

        if (preferredTenantId && list.find((t) => t.tenantId === preferredTenantId)) {
          setTenantId(preferredTenantId);
          return;
        }

        setTenantId((prev) => {
          if (prev && list.find((t) => t.tenantId === prev)) {
            return prev;
          }
          return list[0].tenantId;
        });
      } catch (err) {
        setError(err.message || "Failed to load tenants");
      } finally {
        setLoadingTenants(false);
      }
    },
    [authFetch]
  );

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  async function submitCreateTenant(e) {
    e.preventDefault();
    setCreateTenantError("");
    setCreateTenantSuccess("");
    setCombinedIssuedKey("");
    setCombinedCopyState("idle");

    const payload = {
      tenantId: String(createTenantForm.tenantId || "").trim().toLowerCase(),
      companyName: String(createTenantForm.companyName || "").trim(),
      contactEmail: String(createTenantForm.contactEmail || "").trim(),
      plan: String(createTenantForm.plan || "professional").trim().toLowerCase(),
    };

    try {
      setCreateTenantSaving(true);

      const res = await authFetch("/api/admin/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        const status = Number(res.status || 500);
        const message =
          json?.message ||
          (status === 409
            ? "A tenant with this ID already exists."
            : status === 401 || status === 403
              ? "You do not have permission to create tenants."
              : "Failed to create tenant.");
        throw new Error(message);
      }

      const createdTenantId = json?.data?.tenant?.tenantId || payload.tenantId;
      const issuePayload = {
        plan: String(createTenantForm.plan || "professional").trim().toLowerCase(),
        maxActivations: Number(createTenantForm.maxActivations),
        includedUsers: Number(createTenantForm.includedUsers),
        extraSeats: Number(createTenantForm.extraSeats),
        expiresAt: createTenantForm.expiresAt
          ? new Date(createTenantForm.expiresAt).toISOString()
          : null,
        performedBy:
          String(createTenantForm.performedBy || "").trim() ||
          user?.email ||
          "admin@vynce.local",
        reason:
          String(createTenantForm.reason || "").trim() ||
          "Tenant commercial onboarding",
      };

      const issueRes = await authFetch(
        `/api/admin/license/issue?tenantId=${encodeURIComponent(createdTenantId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(issuePayload),
        }
      );

      const issueJson = await issueRes.json();
      if (!issueRes.ok || !issueJson.success) {
        const status = Number(issueRes.status || 500);
        const message =
          issueJson?.message ||
          (status === 409
            ? "Tenant created, but license issuance conflicted with existing control-plane state."
            : status === 401 || status === 403
              ? "Tenant created, but you do not have permission to issue license keys."
              : status === 429
                ? "Tenant created, but issuance was rate-limited."
                : "Tenant created, but failed to issue license key.");

        await loadTenants(createdTenantId);
        setCreateTenantForm((prev) => ({ ...prev, tenantId: "", companyName: "", contactEmail: "" }));
        setCreateTenantError(message);
        return;
      }

      const issuedKey = String(issueJson?.data?.licenseKey || "").trim();
      if (!issuedKey) {
        await loadTenants(createdTenantId);
        setCreateTenantError(
          "Tenant created, but control plane did not return a raw license key."
        );
        return;
      }

      setCombinedIssuedKey(issuedKey);
      setCreateTenantSuccess(
        `Tenant ${createdTenantId} created and license key issued.`
      );
      setCreateTenantForm({
        tenantId: "",
        companyName: "",
        contactEmail: "",
        plan: payload.plan || "professional",
        maxActivations: Number(createTenantForm.maxActivations) || 1,
        includedUsers: Number(createTenantForm.includedUsers) || 1,
        extraSeats: Number(createTenantForm.extraSeats) || 0,
        expiresAt: "",
        performedBy:
          String(createTenantForm.performedBy || "").trim() ||
          user?.email ||
          "",
        reason:
          String(createTenantForm.reason || "").trim() ||
          "Tenant commercial onboarding",
      });
      await loadTenants(createdTenantId);
    } catch (err) {
      setCreateTenantError(err.message || "Failed to create tenant.");
    } finally {
      setCreateTenantSaving(false);
    }
  }

  const selectedTenant = useMemo(
    () => tenants.find((t) => t.tenantId === tenantId),
    [tenants, tenantId]
  );

  function applyIssueProfile(profileKey) {
    const preset = ISSUE_PROFILE_PRESETS[profileKey];
    if (!preset) return;

    const expiresAt =
      Number(preset.expiresInDays) > 0
        ? toDateTimeLocalValue(new Date(Date.now() + preset.expiresInDays * 24 * 60 * 60 * 1000))
        : "";

    setIssueProfile(profileKey);
    setCreateTenantForm((prev) => ({
      ...prev,
      plan: preset.plan,
      maxActivations: preset.maxActivations,
      includedUsers: preset.includedUsers,
      extraSeats: preset.extraSeats,
      reason: preset.reason,
      expiresAt,
    }));
  }

  async function copyCombinedIssuedKey() {
    if (!combinedIssuedKey) return;
    try {
      await navigator.clipboard.writeText(combinedIssuedKey);
      setCombinedCopyState("copied");
    } catch {
      setCombinedCopyState("failed");
    }
  }

  const tenantSummary = useMemo(() => {
    if (!selectedTenant) return null;

    return [
      {
        label: "Company",
        value: selectedTenant.companyName || "Unknown",
      },
      {
        label: "Tenant ID",
        value: selectedTenant.tenantId || "—",
      },
      {
        label: "Plan",
        value: selectedTenant.plan || "standard",
      },
      {
        label: "State",
        value: (selectedTenant.status || "unknown").replace(/_/g, " "),
      },
    ];
  }, [selectedTenant]);

  return (
    <div className="license-page enterprise-license-page">
      <div className="license-hero">
        <div>
          <div className="license-section-kicker">Tenant Governance</div>
          <h2>License Management</h2>
          <p className="license-hero-copy">
            Control tenant access, enforce commercial policy, and review the full
            operational audit trail from one place.
          </p>
        </div>

        <div className="license-hero-chip">
          <span className="license-live-dot" />
          Administrative controls are live
        </div>
      </div>

      <div className="license-toolbar">
        <div className="tenant-picker enterprise">
          <label htmlFor="tenant-picker-select">Client / Tenant</label>

          {loadingTenants ? (
            <div className="license-toolbar-loading">Loading clients…</div>
          ) : tenants.length === 0 ? (
            <div className="license-toolbar-loading">No tenants found</div>
          ) : (
            <select
              id="tenant-picker-select"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
            >
              {tenants.map((tenant, idx) => (
                <option key={`${tenant.tenantId}-${idx}`} value={tenant.tenantId}>
                  {tenant.companyName || "Unknown"} ({tenant.tenantId})
                </option>
              ))}
            </select>
          )}

          <div className="tenant-create-cta-row">
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setShowCreateTenant((prev) => !prev);
                setCreateTenantError("");
                setCreateTenantSuccess("");
              }}
            >
              {showCreateTenant ? "Close New Tenant" : "Add New Tenant"}
            </button>
          </div>

          {showCreateTenant ? (
            <form className="tenant-create-form" onSubmit={submitCreateTenant}>
              <label className="license-field">
                <span>Tenant ID</span>
                <input
                  type="text"
                  value={createTenantForm.tenantId}
                  onChange={(e) =>
                    setCreateTenantForm((prev) => ({ ...prev, tenantId: e.target.value }))
                  }
                  placeholder="Leave blank to auto-generate (e.g. tenant_acme_20260401_xxxxxx)"
                  autoComplete="off"
                />
              </label>

              <label className="license-field">
                <span>Company Name</span>
                <input
                  type="text"
                  value={createTenantForm.companyName}
                  onChange={(e) =>
                    setCreateTenantForm((prev) => ({ ...prev, companyName: e.target.value }))
                  }
                  placeholder="Acme Inc"
                />
              </label>

              <label className="license-field">
                <span>Contact Email</span>
                <input
                  type="email"
                  value={createTenantForm.contactEmail}
                  onChange={(e) =>
                    setCreateTenantForm((prev) => ({ ...prev, contactEmail: e.target.value }))
                  }
                  placeholder="owner@acme.com"
                />
              </label>

              <label className="license-field">
                <span>Issue Profile</span>
                <select
                  value={issueProfile}
                  onChange={(e) => applyIssueProfile(e.target.value)}
                >
                  <option value="starter">Starter</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </label>

              <label className="license-field">
                <span>Plan</span>
                <select
                  value={createTenantForm.plan}
                  onChange={(e) =>
                    setCreateTenantForm((prev) => ({ ...prev, plan: e.target.value }))
                  }
                >
                  <option value="development">Development</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </label>

              <label className="license-field">
                <span>Max Activations</span>
                <input
                  type="number"
                  min="1"
                  value={createTenantForm.maxActivations}
                  onChange={(e) =>
                    setCreateTenantForm((prev) => ({
                      ...prev,
                      maxActivations: e.target.value,
                    }))
                  }
                />
              </label>

              <label className="license-field">
                <span>Included Users</span>
                <input
                  type="number"
                  min="1"
                  value={createTenantForm.includedUsers}
                  onChange={(e) =>
                    setCreateTenantForm((prev) => ({
                      ...prev,
                      includedUsers: e.target.value,
                    }))
                  }
                />
              </label>

              <label className="license-field">
                <span>Extra Seats</span>
                <input
                  type="number"
                  min="0"
                  value={createTenantForm.extraSeats}
                  onChange={(e) =>
                    setCreateTenantForm((prev) => ({
                      ...prev,
                      extraSeats: e.target.value,
                    }))
                  }
                />
              </label>

              <label className="license-field">
                <span>Expires At (optional)</span>
                <input
                  type="datetime-local"
                  value={createTenantForm.expiresAt}
                  onChange={(e) =>
                    setCreateTenantForm((prev) => ({
                      ...prev,
                      expiresAt: e.target.value,
                    }))
                  }
                />
              </label>

              <label className="license-field">
                <span>Performed By</span>
                <input
                  type="email"
                  value={createTenantForm.performedBy}
                  onChange={(e) =>
                    setCreateTenantForm((prev) => ({
                      ...prev,
                      performedBy: e.target.value,
                    }))
                  }
                  placeholder="release@yourcompany.com"
                />
              </label>

              <label className="license-field full">
                <span>Reason</span>
                <input
                  type="text"
                  value={createTenantForm.reason}
                  onChange={(e) =>
                    setCreateTenantForm((prev) => ({
                      ...prev,
                      reason: e.target.value,
                    }))
                  }
                  placeholder="Tenant commercial onboarding"
                />
              </label>

              {createTenantError ? <p className="error-text">{createTenantError}</p> : null}
              {createTenantSuccess ? <p className="success-text">{createTenantSuccess}</p> : null}

              <div className="tenant-create-actions">
                <button type="submit" className="primary" disabled={createTenantSaving}>
                  {createTenantSaving
                    ? "Creating Tenant + Issuing Key..."
                    : "Create Tenant + Issue Key"}
                </button>
              </div>

              {combinedIssuedKey ? (
                <div className="issued-key-box">
                  <div className="issued-key-header">
                    <strong>New License Key</strong>
                    <button type="button" className="secondary" onClick={copyCombinedIssuedKey}>
                      {combinedCopyState === "copied"
                        ? "Copied"
                        : combinedCopyState === "failed"
                          ? "Copy Failed"
                          : "Copy Key"}
                    </button>
                  </div>
                  <code>{combinedIssuedKey}</code>
                  <p>
                    Copy and deliver this key securely to the tenant. This raw key is shown once in this admin session.
                  </p>
                </div>
              ) : null}
            </form>
          ) : null}
        </div>

        {tenantSummary ? (
          <div className="license-summary-strip">
            {tenantSummary.map((item) => (
              <div key={item.label} className="license-summary-pill">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="audit-card error">
          Failed to load tenant directory: {error}
        </div>
      ) : null}

      {tenantId ? (
        <div className="license-context-banner">
          <strong>High-impact action zone:</strong> changes here affect tenant login,
          single calling, bulk calling, and protected tenant APIs.
        </div>
      ) : null}

      {tenantId && selectedTenant ? (
        <LicenseStatusCard
          tenantId={tenantId}
          companyName={selectedTenant.companyName}
        />
      ) : null}

      <LicenseAuditTable tenantId={tenantId} />
    </div>
  );
}
