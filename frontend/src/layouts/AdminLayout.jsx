import { Outlet, NavLink } from "react-router-dom";
import "../styles/admin.css";
import "../styles/admin-license.css";

const NAV_ITEMS = [
  {
    to: "/admin",
    label: "Dashboard",
    hint: "Overview and health",
    icon: "DG",
    end: true,
  },
  {
    to: "/admin/onboarding",
    label: "Onboarding",
    hint: "Review and approve",
    icon: "ON",
  },
  {
    to: "/admin/license",
    label: "Licensing",
    hint: "Tenant access control",
    icon: "LC",
  },
  {
    to: "/admin/webhooks",
    label: "Webhooks",
    hint: "Vonage audit trail",
    icon: "WH",
  },
  {
    to: "/admin/users",
    label: "Tenants",
    hint: "Monitor each tenant",
    icon: "TN",
  },
];

export default function AdminLayout() {
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-shell">
          <div className="admin-brand-block">
            <div className="admin-brand-mark">V</div>
            <div>
              <div className="admin-brand-eyebrow">Vynce Control</div>
              <div className="admin-brand">Admin Console</div>
            </div>
          </div>

          <div className="admin-sidebar-intro">
            Production operations for tenants, onboarding, telephony, and compliance.
          </div>

          <nav className="admin-nav">
            {NAV_ITEMS.map((item, index) => (
              <NavLink key={item.to} to={item.to} end={item.end}>
                {({ isActive }) => (
                  <div
                    className={`admin-nav-link ${isActive ? "active" : ""}`}
                    style={{ animationDelay: `${index * 60}ms` }}
                  >
                    <span className="admin-nav-icon">{item.icon}</span>
                    <span className="admin-nav-copy">
                      <span className="admin-nav-label">{item.label}</span>
                      <span className="admin-nav-hint">{item.hint}</span>
                    </span>
                    <span className="admin-nav-arrow">›</span>
                  </div>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="admin-sidebar-footer">
            <div className="admin-sidebar-status">
              <span className="admin-status-dot" />
              <span>Operations mode</span>
            </div>
            <p>Use this surface for high-impact account decisions and production review flows.</p>
          </div>
        </div>
      </aside>

      <main className="admin-main">
        <div className="admin-main-shell">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
