import React from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "./AuthContext";
import "./Sidebar.css";
import vynceLogo from "../assets/vynce-logo.png";

export default function Sidebar() {
  const { user, logout } = useAuth();
  const canManageSettings = user?.isSuperAdmin || user?.role === "admin";

  const plan = user?.subscription?.plan
    ? user.subscription.plan.toLowerCase()
    : null;

  const hasAnalyticsAccess =
    plan === "professional" || plan === "team" || plan === "enterprise";

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <img src={vynceLogo} alt="Vynce Logo" className="logo-image" />
          <span className="logo-text" />
        </div>
        <div className="tagline">Voice Dialer</div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section">
          <div className="nav-section-title">Main</div>
          <NavLink to="/dashboard" end className="nav-link">
            <span className="nav-icon">DB</span>
            <span className="nav-text">Dashboard</span>
          </NavLink>
          <NavLink to="/calls" className="nav-link">
            <span className="nav-icon">LC</span>
            <span className="nav-text">Live Calls</span>
          </NavLink>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">Campaign Tools</div>
          <NavLink to="/scripts" className="nav-link">
            <span className="nav-icon">SC</span>
            <span className="nav-text">Scripts</span>
          </NavLink>
          <NavLink to="/voicemail" className="nav-link">
            <span className="nav-icon">VM</span>
            <span className="nav-text">Voicemail</span>
          </NavLink>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">Account</div>

          <NavLink to="/billing" className="nav-link">
            <span className="nav-icon">BL</span>
            <span className="nav-text">Billing</span>
            {user?.subscription?.plan ? (
              <span className="nav-badge">{user.subscription.plan}</span>
            ) : null}
          </NavLink>

          {hasAnalyticsAccess ? (
            <NavLink to="/analytics" className="nav-link">
              <span className="nav-icon">AN</span>
              <span className="nav-text">Analytics</span>
            </NavLink>
          ) : null}

          {canManageSettings ? (
            <NavLink to="/settings" className="nav-link">
              <span className="nav-icon">ST</span>
              <span className="nav-text">Settings</span>
            </NavLink>
          ) : null}

          <NavLink to="/support" className="nav-link">
            <span className="nav-icon">SP</span>
            <span className="nav-text">Support</span>
          </NavLink>

          <NavLink to="/messages" className="nav-link">
            <span className="nav-icon">IN</span>
            <span className="nav-text">Inbox</span>
          </NavLink>
        </div>
      </nav>

      <div className="sidebar-footer">
        <div className="user-card">
          <div className="user-avatar">
            {user?.firstName?.charAt(0) || "D"}
            {user?.lastName?.charAt(0) || "U"}
          </div>
          <div className="user-info">
            <div className="user-name">
              {user?.firstName || "Demo"} {user?.lastName || "User"}
            </div>
            <div className="user-email">{user?.email || "demo@vynce.com"}</div>
          </div>
        </div>
        <button onClick={logout} className="logout-btn">
          <span>OUT</span> Sign Out
        </button>
      </div>
    </aside>
  );
}
