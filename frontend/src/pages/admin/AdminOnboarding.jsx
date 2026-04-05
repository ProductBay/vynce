import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../components/AuthContext";
import "../../styles/admin-license.css";

const DEFAULT_FORM = {
  action: "approve",
  adminNotes: "",
  requiredChanges: "",
};

const STEP_META = {
  companyInfo: {
    label: "Company profile",
    description: "Business identity and default caller settings are configured.",
    category: "Business",
  },
  settingsConfigured: {
    label: "Call settings saved",
    description: "Caller ID, webhook URL, timezone, and dialer settings are configured.",
    category: "Platform",
  },
  vonageConnected: {
    label: "Vonage connected",
    description: "Telephony credentials and application verification are complete.",
    category: "Telephony",
  },
  scriptUploaded: {
    label: "Script library ready",
    description: "At least one usable tenant script exists for production calling.",
    category: "Operations",
  },
  agentAdded: {
    label: "Users prepared",
    description: "The tenant has at least one active user ready to operate the workspace.",
    category: "Users",
  },
  testCallCompleted: {
    label: "Test call completed",
    description: "A safe test call has already been completed.",
    category: "Readiness",
  },
  billingSetup: {
    label: "Billing setup",
    description: "Commercial setup is captured for the tenant account.",
    category: "Billing",
  },
  complianceAccepted: {
    label: "Compliance accepted",
    description: "Required operational and compliance confirmations are on file.",
    category: "Compliance",
  },
};

function ReviewBadge({ status }) {
  return (
    <span className={`webhook-chip onboarding-chip onboarding-chip-${status || "draft"}`}>
      {(status || "draft").replace(/_/g, " ")}
    </span>
  );
}

function formatDateTime(value) {
  if (!value) return "Not available";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Not available";
  }
}

function buildActionGuidance(action) {
  switch (action) {
    case "request_changes":
      return {
        title: "Send back with required changes",
        body: "Use this when the tenant is viable but still needs more setup, evidence, or operational corrections before launch review can continue.",
      };
    case "reject":
      return {
        title: "Reject onboarding",
        body: "Use this for invalid, abusive, or non-viable onboarding cases that should not continue without manual escalation.",
      };
    default:
      return {
        title: "Approve tenant review",
        body: "Approving marks the tenant as operationally accepted. If Vonage is still pending, go-live stays limited until telephony verification is completed.",
      };
  }
}

export default function AdminOnboarding() {
  const { authFetch, user } = useAuth();
  const [queue, setQueue] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadQueue = async () => {
    setLoadingQueue(true);
    try {
      setError("");
      const res = await authFetch("/api/admin/onboarding/queue");
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to load onboarding queue");
      }

      const nextQueue = json.queue || [];
      setQueue(nextQueue);

      if (!selectedTenantId && nextQueue[0]?.tenantId) {
        setSelectedTenantId(nextQueue[0].tenantId);
      } else if (
        selectedTenantId &&
        !nextQueue.find((item) => item.tenantId === selectedTenantId)
      ) {
        setSelectedTenantId(nextQueue[0]?.tenantId || "");
      }
    } catch (err) {
      setError(err.message || "Failed to load onboarding queue");
    } finally {
      setLoadingQueue(false);
    }
  };

  const loadDetail = async (tenantId) => {
    if (!tenantId) {
      setDetail(null);
      return;
    }

    setLoadingDetail(true);
    try {
      setError("");
      const res = await authFetch(
        `/api/admin/onboarding?tenantId=${encodeURIComponent(tenantId)}`
      );
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to load onboarding detail");
      }

      setDetail(json.data || null);
      setForm((prev) => ({
        ...prev,
        adminNotes: json.data?.review?.adminNotes || "",
        requiredChanges: Array.isArray(json.data?.review?.requiredChanges)
          ? json.data.review.requiredChanges.join("\n")
          : "",
      }));
    } catch (err) {
      setError(err.message || "Failed to load onboarding detail");
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadDetail(selectedTenantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId]);

  const selectedQueueItem = useMemo(
    () => queue.find((item) => item.tenantId === selectedTenantId) || null,
    [queue, selectedTenantId]
  );

  const pendingCount = useMemo(
    () => queue.filter((item) => item.status === "pending_review").length,
    [queue]
  );

  const changesCount = useMemo(
    () => queue.filter((item) => item.status === "changes_requested").length,
    [queue]
  );

  const approvedQueueCount = useMemo(
    () => queue.filter((item) => item.status === "approved").length,
    [queue]
  );

  const stepEntries = useMemo(() => {
    const steps = detail?.steps || {};
    return Object.entries(steps).map(([key, value]) => ({
      key,
      value: Boolean(value),
      ...(STEP_META[key] || {
        label: key,
        description: value ? "Completed by tenant" : "Not completed yet",
        category: "General",
      }),
    }));
  }, [detail]);

  const missingReviewBlockingSteps = detail?.missingReviewBlockingSteps || [];
  const missingRequiredSteps = detail?.missingRequiredSteps || [];
  const canSubmitForReview = Boolean(detail?.canSubmitForReview);
  const telephonyPendingOnly =
    missingRequiredSteps.length === 1 && missingRequiredSteps[0] === "vonageConnected";
  const guidance = buildActionGuidance(form.action);

  const handleReview = async (event) => {
    event.preventDefault();
    if (!selectedTenantId) return;

    try {
      setSubmitting(true);
      setError("");
      setSuccess("");

      const requiredChanges = form.requiredChanges
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);

      const res = await authFetch("/api/admin/onboarding/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenantId: selectedTenantId,
          action: form.action,
          adminNotes: form.adminNotes,
          requiredChanges,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to update onboarding review");
      }

      setDetail(json.data || null);
      setSuccess("Onboarding review updated.");
      await loadQueue();
      await loadDetail(selectedTenantId);
    } catch (err) {
      setError(err.message || "Failed to update onboarding review");
    } finally {
      setSubmitting(false);
    }
  };

  if (!user || (!user.isSuperAdmin && user.role !== "admin")) {
    return (
      <div className="license-page">
        <h2>Access Denied</h2>
        <p style={{ opacity: 0.75 }}>
          You do not have permission to review tenant onboarding.
        </p>
      </div>
    );
  }

  return (
    <div className="license-page enterprise-license-page onboarding-admin-page">
      <section className="license-hero">
        <div>
          <div className="license-section-kicker">Tenant Operations</div>
          <h2>Onboarding Review Console</h2>
          <p className="license-hero-copy">
            Moderate launch readiness, manage onboarding risk, and move tenants from setup into
            controlled production approval with a clearer operator workflow.
          </p>
        </div>
        <div className="license-hero-chip">
          <span className="license-live-dot" />
          Moderation workspace
        </div>
      </section>

      <section className="license-summary-strip">
        <div className="license-summary-pill">
          <span>Queue Size</span>
          <strong>{queue.length}</strong>
        </div>
        <div className="license-summary-pill">
          <span>Pending Review</span>
          <strong>{pendingCount}</strong>
        </div>
        <div className="license-summary-pill">
          <span>Changes Requested</span>
          <strong>{changesCount}</strong>
        </div>
        <div className="license-summary-pill">
          <span>Approved In View</span>
          <strong>{approvedQueueCount}</strong>
        </div>
      </section>

      <div className="license-context-banner">
        Tenant approval controls live inside this workspace. Review decisions affect go-live
        readiness, moderation follow-up, and whether the tenant can move from setup into full
        operational calling.
      </div>

      {error ? <div className="audit-card error">{error}</div> : null}
      {success ? <div className="audit-card">{success}</div> : null}

      <div className="onboarding-admin-grid enterprise">
        <section className="audit-card onboarding-queue-panel">
          <div className="audit-card-header">
            <div>
              <h3>Review Queue</h3>
              <p className="audit-subtitle">
                Select a tenant to inspect readiness, telephony status, and launch blockers.
              </p>
            </div>
            <button
              type="button"
              className="webhook-refresh-btn"
              onClick={loadQueue}
              disabled={loadingQueue}
            >
              {loadingQueue ? "Refreshing..." : "Refresh Queue"}
            </button>
          </div>

          {loadingQueue ? <p>Loading queue...</p> : null}
          {!loadingQueue && queue.length === 0 ? (
            <p>No tenants are currently waiting for onboarding review.</p>
          ) : null}

          <div className="onboarding-queue-list">
            {queue.map((item) => (
              <button
                key={item.tenantId}
                type="button"
                className={`onboarding-queue-item ${
                  selectedTenantId === item.tenantId ? "selected" : ""
                }`}
                onClick={() => setSelectedTenantId(item.tenantId)}
              >
                <div className="onboarding-queue-title">
                  <strong>{item.companyName || "Unknown"}</strong>
                  <ReviewBadge status={item.status} />
                </div>

                <div className="onboarding-queue-meta">{item.contactEmail || "No email"}</div>

                <div className="onboarding-queue-footer">
                  <div className="onboarding-queue-stat">
                    <span>Tenant</span>
                    <strong>{item.tenantId}</strong>
                  </div>
                  <div className="onboarding-queue-stat">
                    <span>Completion</span>
                    <strong>
                      {item.completion?.completed || 0}/{item.completion?.total || 0}
                    </strong>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="audit-card onboarding-review-panel">
          {!selectedTenantId ? <p>Select a tenant to review.</p> : null}
          {loadingDetail ? <p>Loading tenant onboarding...</p> : null}

          {selectedTenantId && !loadingDetail && detail ? (
            <>
              <div className="onboarding-detail-header">
                <div>
                  <div className="license-section-kicker">Selected Tenant</div>
                  <h3>{detail.tenant?.companyName || selectedQueueItem?.companyName || "Unknown"}</h3>
                  <p>{detail.tenant?.contactEmail || selectedQueueItem?.contactEmail || "No email"}</p>
                  <p>Tenant ID: {detail.tenantId}</p>
                </div>
                <ReviewBadge status={detail.review?.status} />
              </div>

              <div className="onboarding-ops-grid">
                <div className="license-overview-card critical">
                  <span>Launch Readiness</span>
                  <strong>{detail.canGoLive ? "Ready For Go-Live" : "Operational Review Pending"}</strong>
                  <small>
                    {detail.canGoLive
                      ? "The tenant has approval plus the required tracked readiness steps."
                      : "Approval, telephony readiness, or required setup is still outstanding."}
                  </small>
                </div>
                <div className="license-overview-card">
                  <span>Progress</span>
                  <strong>
                    {detail.completion?.completed || 0}/{detail.completion?.total || 0} tracked steps
                  </strong>
                  <small>{detail.completion?.percent || 0}% completion</small>
                </div>
                <div className="license-overview-card">
                  <span>Submission</span>
                  <strong>{formatDateTime(detail.review?.submittedAt)}</strong>
                  <small>Last tenant review request</small>
                </div>
                <div className="license-overview-card">
                  <span>Last Review</span>
                  <strong>{formatDateTime(detail.review?.reviewedAt)}</strong>
                  <small>Latest admin moderation action</small>
                </div>
              </div>

              {telephonyPendingOnly ? (
                <div className="license-context-banner onboarding-context-banner">
                  This tenant can be approved before telephony is connected. Vonage remains the only
                  missing go-live requirement and can be added after approval.
                </div>
              ) : null}

              {missingReviewBlockingSteps.length > 0 ? (
                <div className="license-impact-banner onboarding-impact-banner">
                  Review-blocking items still open: {missingReviewBlockingSteps.join(", ")}.
                </div>
              ) : null}

              <div className="onboarding-detail-summary enterprise">
                <div>
                  <span>Plan</span>
                  <strong>{detail.tenant?.plan || "standard"}</strong>
                </div>
                <div>
                  <span>License ID</span>
                  <strong>{detail.tenant?.licenseId || "Not available"}</strong>
                </div>
                <div>
                  <span>Submit Ready</span>
                  <strong>{canSubmitForReview ? "Yes" : "No"}</strong>
                </div>
              </div>

              <div className="onboarding-review-columns">
                <div className="onboarding-review-block">
                  <div className="onboarding-block-header">
                    <h4>Readiness Matrix</h4>
                    <p>Track the operational evidence that supports tenant approval decisions.</p>
                  </div>
                  <div className="onboarding-step-list admin enterprise">
                    {stepEntries.map((item) => (
                      <div key={item.key} className={`onboarding-step ${item.value ? "done" : ""}`}>
                        <div className="onboarding-step-main">
                          <div>
                            <div className="onboarding-step-kicker">{item.category}</div>
                            <div className="onboarding-step-title">{item.label}</div>
                            <div className="onboarding-step-description">{item.description}</div>
                          </div>
                        </div>
                        <span className={`onboarding-step-state ${item.value ? "done" : "pending"}`}>
                          {item.value ? "Verified" : "Open"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="onboarding-review-block">
                  <div className="onboarding-block-header">
                    <h4>Moderation Actions</h4>
                    <p>Approve, return for changes, or reject with a clearer operational record.</p>
                  </div>

                  <div className="license-action-guidance onboarding-action-guidance">
                    <strong>{guidance.title}</strong>
                    <div>{guidance.body}</div>
                  </div>

                  <form className="onboarding-review-form enterprise" onSubmit={handleReview}>
                    <label>
                      Decision
                      <select
                        value={form.action}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, action: e.target.value }))
                        }
                      >
                        <option value="approve">Approve Tenant</option>
                        <option value="request_changes">Request Changes</option>
                        <option value="reject">Reject Onboarding</option>
                      </select>
                    </label>

                    <label>
                      Admin Notes
                      <textarea
                        rows="5"
                        value={form.adminNotes}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, adminNotes: e.target.value }))
                        }
                        placeholder="Capture decision context, risk notes, or launch conditions for the support and billing teams."
                      />
                    </label>

                    <label>
                      Required Changes
                      <textarea
                        rows="5"
                        value={form.requiredChanges}
                        onChange={(e) =>
                          setForm((prev) => ({
                            ...prev,
                            requiredChanges: e.target.value,
                          }))
                        }
                        placeholder="One requested change per line"
                        disabled={form.action === "approve"}
                      />
                    </label>

                    <div className="onboarding-review-notes">
                      <div className="onboarding-review-note">
                        <span>Current reviewer</span>
                        <strong>{user.email || "Unknown admin"}</strong>
                      </div>
                      <div className="onboarding-review-note">
                        <span>Moderation posture</span>
                        <strong>{canSubmitForReview ? "Reviewable" : "Blocked by missing setup"}</strong>
                      </div>
                    </div>

                    <div className="onboarding-actions enterprise">
                      <button
                        type="submit"
                        className={`onboarding-submit-btn onboarding-submit-btn-${form.action}`}
                        disabled={submitting}
                      >
                        {submitting ? "Saving..." : "Save Review Decision"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
