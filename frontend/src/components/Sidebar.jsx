// frontend/src/components/Sidebar.jsx
import React from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "./AuthContext";
import "./Sidebar.css";
import vynceLogo from "../assets/vynce-logo.png";


export default function Sidebar() {
  const { user, logout } = useAuth();

  // Plan / analytics access
  const plan = user?.subscription?.plan
    ? user.subscription.plan.toLowerCase()
    : null;

  const hasAnalyticsAccess =
    plan === "growth" || plan === "white_label" || plan === "enterprise";

  return (
    <aside className="sidebar">
      {/* Logo/Brand */}
      <div className="sidebar-header">
  <div className="logo">
    <img
      src={vynceLogo}
      alt="Vynce Logo"
      className="logo-image"
    />
    <span className="logo-text"></span>
  </div>
  <div className="tagline">Voice Dialer</div>
</div>

      {/* Main Navigation */}
      <nav className="sidebar-nav">
        <div className="nav-section">
          <div className="nav-section-title">Main</div>
          <NavLink to="/dashboard" end className="nav-link">
            <span className="nav-icon">📊</span>
            <span className="nav-text">Dashboard</span>
          </NavLink>
          <NavLink to="/calls" className="nav-link">
            <span className="nav-icon">📞</span>
            <span className="nav-text">Live Calls</span>
          </NavLink>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">Campaign Tools</div>
          <NavLink to="/scripts" className="nav-link">
            <span className="nav-icon">📝</span>
            <span className="nav-text">Scripts</span>
          </NavLink>
          <NavLink to="/voicemail" className="nav-link">
            <span className="nav-icon">🎙️</span>
            <span className="nav-text">Voicemail</span>
          </NavLink>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">Account</div>

          <NavLink to="/billing" className="nav-link">
            <span className="nav-icon">💳</span>
            <span className="nav-text">Billing</span>
            {user?.subscription?.plan && (
              <span className="nav-badge">{user.subscription.plan}</span>
            )}
          </NavLink>

          {/* Analytics – only show for eligible plans */}
          {hasAnalyticsAccess && (
            <NavLink to="/analytics" className="nav-link">
              <span className="nav-icon">📊</span>
              <span className="nav-text">Analytics</span>
            </NavLink>
          )}

          <NavLink to="/settings" className="nav-link">
            <span className="nav-icon">⚙️</span>
            <span className="nav-text">Settings</span>
          </NavLink>

          <NavLink to="/support" className="nav-link">
            <span className="nav-icon">🆘</span>
            <span className="nav-text">Support</span>
          </NavLink>
        </div>
      </nav>

      {/* User Info Footer */}
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
          <span>🚪</span> Sign Out
        </button>
      </div>
    </aside>
  );
}