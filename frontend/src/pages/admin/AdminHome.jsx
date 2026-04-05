import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../components/AuthContext";

function formatDateTime(value) {
  if (!value) return "No recent activity";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return "No recent activity";
  }
}

function DashboardMetric({ label, value, tone = "neutral", note }) {
  return (
    <div className={`admin-metric-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function SectionHeader({ title, subtitle, action }) {
  return (
    <div className="admin-section-header">
      <div>
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export default function AdminHome() {
  const { authFetch, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [tenants, setTenants] = useState([]);
  const [onboardingQueue, setOnboardingQueue] = useState([]);
  const [supportConversations, setSupportConversations] = useState([]);
  const [licenseAudit, setLicenseAudit] = useState([]);

  const loadDashboard = async (silent = false) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      setError("");

      const [tenantRes, onboardingRes, supportRes, auditRes] = await Promise.all([
        authFetch("/api/admin/tenants"),
        authFetch("/api/admin/onboarding/queue"),
        authFetch("/api/support/conversations"),
        authFetch("/api/admin/license/audit"),
      ]);

      const [tenantJson, onboardingJson, supportJson, auditJson] = await Promise.all([
        tenantRes.json(),
        onboardingRes.json(),
        supportRes.json(),
        auditRes.json(),
      ]);

      if (!tenantRes.ok || !tenantJson.success) {
        throw new Error(tenantJson.message || "Failed to load tenant metrics");
      }

      if (!onboardingRes.ok || !onboardingJson.success) {
        throw new Error(onboardingJson.message || "Failed to load onboarding queue");
      }

      if (!supportRes.ok || !supportJson.success) {
        throw new Error(supportJson.message || "Failed to load support workload");
      }

      if (!auditRes.ok || !auditJson.success) {
        throw new Error(auditJson.message || "Failed to load recent admin actions");
      }

      setTenants(tenantJson.tenants || []);
      setOnboardingQueue(onboardingJson.queue || []);
      setSupportConversations(supportJson.conversations || []);
      setLicenseAudit(auditJson.data || []);
    } catch (err) {
      setError(err.message || "Failed to load admin dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const active = tenants.filter((tenant) => tenant.status === "active").length;
    const suspended = tenants.filter((tenant) => tenant.status === "suspended").length;
    const tempSuspended = tenants.filter(
      (tenant) => tenant.status === "temporarily_suspended"
    ).length;
    const commercialBlocked = tenants.filter((tenant) => tenant.commercialBlocked).length;
    const pendingReviews = onboardingQueue.filter(
      (item) => item.status === "pending_review"
    ).length;
    const changeRequests = onboardingQueue.filter(
      (item) => item.status === "changes_requested"
    ).length;
    const waitingHuman = supportConversations.filter(
      (conversation) => conversation.status === "waiting_human"
    ).length;
    const openSupport = supportConversations.filter(
      (conversation) => conversation.status === "open"
    ).length;

    return {
      active,
      suspended,
      tempSuspended,
      commercialBlocked,
      pendingReviews,
      changeRequests,
      waitingHuman,
      openSupport,
    };
  }, [tenants, onboardingQueue, supportConversations]);

  const planMix = useMemo(() => {
    const counts = tenants.reduce((acc, tenant) => {
      const key = String(tenant.plan || "professional").toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const total = tenants.length || 1;

    return Object.entries(counts)
      .map(([plan, count]) => ({
        plan,
        count,
        percent: Math.round((count / total) * 100),
      }))
      .sort((a, b) => b.count - a.count);
  }, [tenants]);

  const tenantHealth = useMemo(
    () =>
      [...tenants]
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
        .slice(0, 6),
    [tenants]
  );

  const recentSupport = useMemo(
    () =>
      [...supportConversations]
        .sort(
          (a, b) =>
            new Date(b.lastMessageAt || b.updatedAt || 0) -
            new Date(a.lastMessageAt || a.updatedAt || 0)
        )
        .slice(0, 5),
    [supportConversations]
  );

  const recentActions = useMemo(() => licenseAudit.slice(0, 5), [licenseAudit]);

  if (loading) {
    return <div className="admin-home-loading">Loading admin dashboard...</div>;
  }

  return (
    <div className="admin-home">
      <section className="admin-home-hero">
        <div>
          <div className="admin-home-kicker">Executive Overview</div>
          <h1>Admin Operations Dashboard</h1>
          <p>
            Track tenant readiness, support load, enforcement actions, and operational risk from a
            single control surface built for day-to-day moderation.
          </p>
        </div>

        <div className="admin-home-hero-actions">
          <div className="admin-home-identity">
            <span>Signed in as</span>
            <strong>{user?.email || "Admin"}</strong>
          </div>
          <button
            type="button"
            className="admin-home-refresh"
            onClick={() => loadDashboard(true)}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing..." : "Refresh Overview"}
          </button>
        </div>
      </section>

      {error ? <div className="admin-home-alert error">{error}</div> : null}

      <section className="admin-home-metrics">
        <DashboardMetric
          label="Total Tenants"
          value={tenants.length}
          tone="neutral"
          note="All managed customer workspaces"
        />
        <DashboardMetric
          label="Healthy Tenants"
          value={totals.active}
          tone="success"
          note="Active and enabled for operations"
        />
        <DashboardMetric
          label="Suspended"
          value={totals.suspended + totals.tempSuspended}
          tone="danger"
          note={`${totals.commercialBlocked} commercially blocked tenants`}
        />
        <DashboardMetric
          label="Pending Reviews"
          value={totals.pendingReviews}
          tone="info"
          note={`${totals.changeRequests} require change requests`}
        />
        <DashboardMetric
          label="Support Escalations"
          value={totals.waitingHuman}
          tone="warning"
          note={`${totals.openSupport} open support conversations`}
        />
      </section>

      <section className="admin-home-grid">
        <div className="admin-home-panel admin-home-panel-wide">
          <SectionHeader
            title="Tenant Health"
            subtitle="Recently updated tenants, status posture, and operational context."
          />

          <div className="admin-tenant-table">
            {tenantHealth.map((tenant) => (
              <div className="admin-tenant-row" key={tenant.tenantId}>
                <div className="admin-tenant-main">
                  <strong>{tenant.companyName || "Unknown"}</strong>
                  <span>{tenant.contactEmail || tenant.tenantId}</span>
                </div>
                <div className="admin-tenant-pill plan">{tenant.plan || "professional"}</div>
                <div className={`admin-tenant-pill status ${tenant.status || "active"}`}>
                  {(tenant.status || "active").replace(/_/g, " ")}
                </div>
                <div className="admin-tenant-meta">{formatDateTime(tenant.updatedAt)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="admin-home-panel">
          <SectionHeader
            title="Plan Mix"
            subtitle="Current tenant distribution across plans."
          />

          <div className="admin-plan-mix">
            {planMix.length === 0 ? (
              <div className="admin-empty-state">No tenant data available yet.</div>
            ) : (
              planMix.map((item) => (
                <div className="admin-plan-row" key={item.plan}>
                  <div className="admin-plan-top">
                    <strong>{item.plan}</strong>
                    <span>
                      {item.count} tenants • {item.percent}%
                    </span>
                  </div>
                  <div className="admin-plan-bar">
                    <div
                      className="admin-plan-fill"
                      style={{ width: `${Math.max(item.percent, 8)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="admin-home-panel">
          <SectionHeader
            title="Onboarding Queue"
            subtitle="Tenants awaiting moderation or follow-up."
          />

          <div className="admin-compact-list">
            {onboardingQueue.length === 0 ? (
              <div className="admin-empty-state">No onboarding items in queue.</div>
            ) : (
              onboardingQueue.slice(0, 5).map((item) => (
                <div className="admin-compact-item" key={item.tenantId}>
                  <div>
                    <strong>{item.companyName || "Unknown"}</strong>
                    <span>
                      {item.completion?.completed || 0}/{item.completion?.total || 0} complete
                    </span>
                  </div>
                  <div className={`admin-tenant-pill status ${item.status || "draft"}`}>
                    {(item.status || "draft").replace(/_/g, " ")}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="admin-home-panel">
          <SectionHeader
            title="Support Load"
            subtitle="Recent support conversations and escalation status."
          />

          <div className="admin-compact-list">
            {recentSupport.length === 0 ? (
              <div className="admin-empty-state">No support conversations yet.</div>
            ) : (
              recentSupport.map((conversation) => (
                <div className="admin-compact-item" key={conversation.id || conversation._id}>
                  <div>
                    <strong>{conversation.subject || conversation.companyName || "Support thread"}</strong>
                    <span>{conversation.preview || conversation.channel || "Conversation activity"}</span>
                  </div>
                  <div className={`admin-tenant-pill status ${conversation.status || "open"}`}>
                    {(conversation.status || "open").replace(/_/g, " ")}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="admin-home-panel admin-home-panel-wide">
          <SectionHeader
            title="Recent Enforcement & Review Actions"
            subtitle="Latest tenant control actions recorded in the license audit trail."
          />

          <div className="admin-audit-stream">
            {recentActions.length === 0 ? (
              <div className="admin-empty-state">No recent admin actions recorded.</div>
            ) : (
              recentActions.map((entry) => (
                <div className="admin-audit-item" key={entry._id || `${entry.action}-${entry.createdAt}`}>
                  <div className={`admin-audit-badge ${entry.action || "GENERAL"}`}>
                    {String(entry.action || "GENERAL").replace(/_/g, " ")}
                  </div>
                  <div className="admin-audit-copy">
                    <strong>{entry.target?.companyName || entry.target?.tenantId || "Tenant action"}</strong>
                    <span>
                      {entry.performedBy?.email || "Unknown admin"} • {formatDateTime(entry.createdAt)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
