import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../components/AuthContext";

function formatDateTime(value) {
  if (!value) return "Not available";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Not available";
  }
}

function StatusChip({ value }) {
  const normalized = String(value || "unknown").trim().toLowerCase();
  return (
    <span className={`admin-tenant-pill status ${normalized}`}>
      {normalized.replace(/_/g, " ")}
    </span>
  );
}

function MonitoringMetric({ label, value, note, tone = "neutral" }) {
  return (
    <div className={`admin-metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

export default function AdminUsers() {
  const { authFetch, user } = useAuth();
  const [tenants, setTenants] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [detail, setDetail] = useState(null);
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const loadTenants = async () => {
    setLoadingTenants(true);
    try {
      setError("");
      const res = await authFetch("/api/admin/tenants");
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to load tenants");
      }

      const nextTenants = json.tenants || [];
      setTenants(nextTenants);

      if (!selectedTenantId && nextTenants[0]?.tenantId) {
        setSelectedTenantId(nextTenants[0].tenantId);
      } else if (
        selectedTenantId &&
        !nextTenants.find((tenant) => tenant.tenantId === selectedTenantId)
      ) {
        setSelectedTenantId(nextTenants[0]?.tenantId || "");
      }
    } catch (err) {
      setError(err.message || "Failed to load tenants");
    } finally {
      setLoadingTenants(false);
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
        `/api/admin/tenant-monitoring?tenantId=${encodeURIComponent(tenantId)}`
      );
      const json = await res.json();

      if (!res.ok || !json.success) {
        throw new Error(json.message || "Failed to load tenant monitoring");
      }

      setDetail(json.data || null);
    } catch (err) {
      setError(err.message || "Failed to load tenant monitoring");
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    loadTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadDetail(selectedTenantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId]);

  const filteredTenants = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return tenants;
    return tenants.filter((tenant) =>
      [tenant.companyName, tenant.contactEmail, tenant.tenantId, tenant.plan, tenant.status]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized))
    );
  }, [tenants, query]);

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.tenantId === selectedTenantId) || null,
    [tenants, selectedTenantId]
  );

  const seatUsageNote = detail?.seats
    ? `${detail.seats.activeUserCount}/${Number.isFinite(detail.seats.totalSeats) ? detail.seats.totalSeats : "Unlimited"} active users`
    : "";

  if (!user || (!user.isSuperAdmin && user.role !== "admin")) {
    return (
      <div className="license-page">
        <h2>Access Denied</h2>
        <p style={{ opacity: 0.75 }}>
          You do not have permission to monitor tenant operations.
        </p>
      </div>
    );
  }

  return (
    <div className="license-page enterprise-license-page tenant-monitoring-page">
      <section className="license-hero">
        <div>
          <div className="license-section-kicker">Tenant Monitoring</div>
          <h2>Tenant Operations Console</h2>
          <p className="license-hero-copy">
            Review each tenant after onboarding, inspect operational health, monitor user seats,
            telephony readiness, support load, and recent calling activity from one admin surface.
          </p>
        </div>
        <div className="license-hero-chip">
          <span className="license-live-dot" />
          Tenant watch
        </div>
      </section>

      <section className="license-summary-strip">
        <div className="license-summary-pill">
          <span>Managed Tenants</span>
          <strong>{tenants.length}</strong>
        </div>
        <div className="license-summary-pill">
          <span>Filtered View</span>
          <strong>{filteredTenants.length}</strong>
        </div>
        <div className="license-summary-pill">
          <span>Selected Status</span>
          <strong>{selectedTenant?.status?.replace(/_/g, " ") || "—"}</strong>
        </div>
        <div className="license-summary-pill">
          <span>Seat Usage</span>
          <strong>{seatUsageNote || "—"}</strong>
        </div>
      </section>

      {error ? <div className="audit-card error">{error}</div> : null}

      <div className="tenant-monitoring-grid">
        <section className="audit-card tenant-directory-panel">
          <div className="audit-card-header">
            <div>
              <h3>Tenant Directory</h3>
              <p className="audit-subtitle">
                Search and select a tenant to review live operational posture.
              </p>
            </div>
            <button type="button" className="webhook-refresh-btn" onClick={loadTenants}>
              Refresh
            </button>
          </div>

          <div className="tenant-monitoring-toolbar">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by company, tenant, email, plan, or status"
            />
          </div>

          {loadingTenants ? <p>Loading tenants...</p> : null}

          <div className="onboarding-queue-list tenant-monitoring-list">
            {filteredTenants.map((tenant) => (
              <button
                key={tenant.tenantId}
                type="button"
                className={`onboarding-queue-item ${
                  selectedTenantId === tenant.tenantId ? "selected" : ""
                }`}
                onClick={() => setSelectedTenantId(tenant.tenantId)}
              >
                <div className="onboarding-queue-title">
                  <strong>{tenant.companyName || "Unknown"}</strong>
                  <StatusChip value={tenant.status} />
                </div>
                <div className="onboarding-queue-meta">
                  {tenant.contactEmail || tenant.tenantId}
                </div>
                <div className="onboarding-queue-footer">
                  <div className="onboarding-queue-stat">
                    <span>Plan</span>
                    <strong>{tenant.plan || "professional"}</strong>
                  </div>
                  <div className="onboarding-queue-stat">
                    <span>Tenant</span>
                    <strong>{tenant.tenantId}</strong>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="audit-card tenant-monitoring-panel">
          {!selectedTenantId ? <p>Select a tenant to review.</p> : null}
          {loadingDetail ? <p>Loading tenant monitoring...</p> : null}

          {selectedTenantId && !loadingDetail && detail ? (
            <>
              <div className="onboarding-detail-header">
                <div>
                  <div className="license-section-kicker">Operational Record</div>
                  <h3>{detail.tenant?.companyName || "Unknown tenant"}</h3>
                  <p>{detail.tenant?.contactEmail || "No contact email on record"}</p>
                  <p>Tenant ID: {detail.tenant?.tenantId}</p>
                </div>
                <StatusChip value={detail.tenant?.status} />
              </div>

              <div className="tenant-monitoring-actions">
                <Link
                  className="webhook-refresh-btn tenant-monitoring-link"
                  to={`/admin/onboarding`}
                >
                  Review Onboarding
                </Link>
                <Link
                  className="webhook-refresh-btn tenant-monitoring-link"
                  to={`/admin/license`}
                >
                  Manage Access
                </Link>
              </div>

              <div className="admin-home-metrics tenant-monitoring-metrics">
                <MonitoringMetric
                  label="Go-Live State"
                  value={detail.onboarding?.canGoLive ? "Approved" : "Pending"}
                  tone={detail.onboarding?.canGoLive ? "success" : "warning"}
                  note={`Review status: ${detail.onboarding?.review?.status?.replace(/_/g, " ") || "draft"}`}
                />
                <MonitoringMetric
                  label="Telephony"
                  value={detail.telephony?.connected ? "Verified" : "Pending"}
                  tone={detail.telephony?.connected ? "success" : "info"}
                  note={detail.telephony?.checkedAt ? `Checked ${formatDateTime(detail.telephony.checkedAt)}` : "No verification recorded"}
                />
                <MonitoringMetric
                  label="Users"
                  value={detail.seats?.activeUserCount ?? 0}
                  note={seatUsageNote}
                />
                <MonitoringMetric
                  label="Commercial"
                  value={detail.commercial?.commercialStatus || "unknown"}
                  note={detail.commercial?.licenseActive ? "License active" : "License inactive"}
                  tone={detail.commercial?.licenseActive ? "success" : "warning"}
                />
                <MonitoringMetric
                  label="Provisioning"
                  value={detail.effectiveAccess?.canProvisionUser ? "Allowed" : "Blocked"}
                  note={detail.commercial?.degraded ? "Control plane degraded" : "Seat entitlement check"}
                  tone={detail.effectiveAccess?.canProvisionUser ? "info" : "warning"}
                />
                <MonitoringMetric
                  label="Live Calls"
                  value={detail.callMetrics?.activeCalls ?? 0}
                  note={`${detail.callMetrics?.totalCalls ?? 0} total tracked calls`}
                  tone={(detail.callMetrics?.activeCalls ?? 0) > 0 ? "info" : "neutral"}
                />
                <MonitoringMetric
                  label="Support"
                  value={detail.supportMetrics?.openThreads ?? 0}
                  note={`${detail.supportMetrics?.waitingHuman ?? 0} waiting for human`}
                  tone={(detail.supportMetrics?.waitingHuman ?? 0) > 0 ? "warning" : "neutral"}
                />
              </div>

              <div className="tenant-monitoring-sections">
                <div className="tenant-monitoring-block">
                  <div className="onboarding-block-header">
                    <h4>Tenant Users</h4>
                    <p>Seat usage and active user roster for this tenant workspace.</p>
                  </div>
                  <div className="settings-seat-grid">
                    <div className="settings-seat-stat">
                      <span>Included Users</span>
                      <strong>{detail.seats?.includedActiveUsers ?? 0}</strong>
                    </div>
                    <div className="settings-seat-stat">
                      <span>Additional Seats</span>
                      <strong>{detail.seats?.additionalAgentSeats ?? 0}</strong>
                    </div>
                    <div className="settings-seat-stat">
                      <span>Total Seats</span>
                      <strong>
                        {Number.isFinite(detail.seats?.totalSeats)
                          ? detail.seats.totalSeats
                          : "Unlimited"}
                      </strong>
                    </div>
                    <div className="settings-seat-stat">
                      <span>Available Seats</span>
                      <strong>
                        {Number.isFinite(detail.seats?.availableSeats)
                          ? detail.seats.availableSeats
                          : "Unlimited"}
                      </strong>
                    </div>
                  </div>
                  <div className="settings-seat-users">
                    {(detail.seats?.users || []).map((tenantUser) => (
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
                </div>

                <div className="tenant-monitoring-block">
                  <div className="onboarding-block-header">
                    <h4>Recent Support & Calls</h4>
                    <p>Quick signal on customer load, support demand, and call outcomes.</p>
                  </div>

                  <div className="tenant-monitoring-subgrid">
                    <div className="tenant-monitoring-subpanel">
                      <div className="tenant-monitoring-subtitle">Support Threads</div>
                      {(detail.supportThreads || []).length === 0 ? (
                        <div className="admin-empty-state">No support activity yet.</div>
                      ) : (
                        <div className="admin-compact-list">
                          {detail.supportThreads.map((thread) => (
                            <div className="admin-compact-item" key={thread.id || thread._id}>
                              <div>
                                <strong>{thread.subject || "Support thread"}</strong>
                                <span>{thread.preview || thread.channel || "Conversation activity"}</span>
                              </div>
                              <StatusChip value={thread.status || "open"} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="tenant-monitoring-subpanel">
                      <div className="tenant-monitoring-subtitle">Recent Calls</div>
                      {(detail.recentCalls || []).length === 0 ? (
                        <div className="admin-empty-state">No call activity yet.</div>
                      ) : (
                        <div className="admin-compact-list">
                          {detail.recentCalls.map((call) => (
                            <div className="admin-compact-item" key={call.id}>
                              <div>
                                <strong>{call.number || "Unknown number"}</strong>
                                <span>
                                  {call.agent || "Unassigned"} • {formatDateTime(call.updatedAt || call.createdAt)}
                                </span>
                              </div>
                              <StatusChip value={call.status || "unknown"} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="tenant-monitoring-block">
                  <div className="onboarding-block-header">
                    <h4>Approval & Monitoring Notes</h4>
                    <p>Readiness and moderation context that helps admins decide whether the tenant is safe to operate.</p>
                  </div>
                  <div className="tenant-monitoring-note-grid">
                    <div className="onboarding-review-note">
                      <span>Onboarding Status</span>
                      <strong>{detail.onboarding?.review?.status?.replace(/_/g, " ") || "draft"}</strong>
                    </div>
                    <div className="onboarding-review-note">
                      <span>Submitted For Review</span>
                      <strong>{formatDateTime(detail.onboarding?.review?.submittedAt)}</strong>
                    </div>
                    <div className="onboarding-review-note">
                      <span>Last Reviewed</span>
                      <strong>{formatDateTime(detail.onboarding?.review?.reviewedAt)}</strong>
                    </div>
                    <div className="onboarding-review-note">
                      <span>Last Call Activity</span>
                      <strong>{formatDateTime(detail.callMetrics?.lastCallAt)}</strong>
                    </div>
                    <div className="onboarding-review-note">
                      <span>Commercial Status</span>
                      <strong>{detail.commercial?.commercialStatus || "unknown"}</strong>
                    </div>
                    <div className="onboarding-review-note">
                      <span>Commercial Gate</span>
                      <strong>{detail.effectiveAccess?.canLogin ? "Open" : "Blocked"}</strong>
                    </div>
                  </div>

                  {detail.commercial?.degraded ? (
                    <div className="onboarding-message warning">
                      <strong>Control plane degraded</strong>
                      <div>
                        {detail.commercial.degradedReason ||
                          "Commercial service is unavailable. Protected commercial operations are blocked until service recovers."}
                      </div>
                    </div>
                  ) : null}

                  {detail.onboarding?.review?.requiredChanges?.length ? (
                    <div className="onboarding-message warning">
                      <strong>Required changes</strong>
                      <ul className="onboarding-change-list">
                        {detail.onboarding.review.requiredChanges.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {detail.onboarding?.review?.adminNotes ? (
                    <div className="license-action-guidance onboarding-action-guidance">
                      <strong>Admin notes</strong>
                      <div>{detail.onboarding.review.adminNotes}</div>
                    </div>
                  ) : (
                    <div className="admin-empty-state">
                      No admin notes have been recorded for this tenant yet.
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
