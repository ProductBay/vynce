import React, { useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../components/AuthContext";
import "../Auth.css";

export default function AdminLogin() {
  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const submittingRef = useRef(false);

  const redirectTo = location.state?.from || "/admin";
  const showSeedHint =
    import.meta.env.DEV || import.meta.env.VITE_OFFLINE_MODE === "true";

  const [email, setEmail] = useState("admin@vynce.com");
  const [password, setPassword] = useState("Password");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const helperText = useMemo(() => {
    if (!showSeedHint) return null;
    return {
      email: "admin@vynce.com",
      password: "Password",
    };
  }, [showSeedHint]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");

    try {
      const result = await login(email.trim().toLowerCase(), password);

      if (!result?.success) {
        setError(result?.message || "Unable to sign in to the admin portal.");
        return;
      }

      const isAdmin =
        result?.user?.role === "admin" || result?.user?.isSuperAdmin === true;

      if (!isAdmin) {
        await logout();
        setError("This account does not have admin access.");
        return;
      }

      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          err?.message ||
          "Unable to sign in to the admin portal."
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-orbit auth-orbit-1" />
      <div className="auth-orbit auth-orbit-2" />
      <div className="auth-grid-overlay" />

      <div className="auth-card-3d-wrapper">
        <div className="auth-card auth-card-3d">
          <div className="auth-card-glow" />

          <header className="auth-header">
            <div className="auth-logo-row">
              <div className="auth-logo-pulse">
                <span className="auth-logo-icon">🛡️</span>
              </div>
              <div className="auth-logo-text">
                <span className="auth-logo-title">Vynce Admin</span>
                <span className="auth-logo-subtitle">Tenant control portal</span>
              </div>
            </div>

            <h1>Admin Sign In</h1>
            <p>Access tenant controls, audit logs, license actions, and Vonage webhook audit tools.</p>
          </header>

          {helperText ? (
            <div className="auth-error" style={{ marginBottom: 14 }}>
              <strong>Local seeded admin</strong>
              <div>Email: {helperText.email}</div>
              <div>Password: {helperText.password}</div>
            </div>
          ) : null}

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-label">
              <span>Admin email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </label>

            <label className="auth-label">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </label>

            {error ? <div className="auth-error">{error}</div> : null}

            <div className="auth-form-footer">
              <button type="submit" className="auth-button" disabled={submitting}>
                {submitting ? "Signing in…" : "Enter Admin Portal"}
              </button>
            </div>
          </form>

          <footer className="auth-footer-small">
            <span>Need the standard workspace?</span>{" "}
            <Link to="/login" className="auth-link">
              Open user sign in
            </Link>
          </footer>
        </div>
      </div>
    </div>
  );
}
