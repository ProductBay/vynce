// src/pages/Login.jsx
import React, { useState, useRef } from "react";
import "./Auth.css";
import { useAuth } from "../components/AuthContext";
import { useLocation, useNavigate, Link } from "react-router-dom";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const redirectTo = location.state?.from || "/dashboard";
  const submittingRef = useRef(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // 3D tilt state
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const rotateX = (0.5 - y) * 12;
    const rotateY = (x - 0.5) * 18;
    setTilt({ x: rotateX, y: rotateY });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // 🔒 HARD BLOCK — sync, race-proof
    if (submittingRef.current) return;
    submittingRef.current = true;

    setError(null);
    setSubmitting(true);

    try {
      const result = await login(email.trim().toLowerCase(), password);

      // 🚨 DEBUG: Check if result exists but failed
      if (!result?.success) {
        // LOG THE FULL RESPONSE TO CONSOLE
        console.error("❌ LOGIN FAILED RESPONSE:", result);
        
        // Set specific error message
        setError(result?.message || "Unable to sign in. Check console for details.");
        
        // 🛑 STOP NAVIGATION
        return;
      }

      // If we get here, login worked
      navigate(redirectTo, { replace: true });

    } catch (err) {
      // 🚨 DEBUG: Catch network errors or interceptor crashes
      console.error("💥 LOGIN CRASH:", err);
      
      // Try to get the message from the backend
      const backendMsg = err?.response?.data?.message || err?.message || "Network error";
      
      setError(backendMsg);
      
      // 🛑 DO NOT NAVIGATE ON ERROR
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
        <div
          className="auth-card auth-card-3d"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{
            transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) translateZ(0)`,
          }}
        >
          <div className="auth-card-glow" />

          <header className="auth-header">
            <div className="auth-logo-row">
              <div className="auth-logo-pulse">
                <span className="auth-logo-icon">📞</span>
              </div>
              <div className="auth-logo-text">
                <span className="auth-logo-title">RDS</span>
                <span className="auth-logo-subtitle">
                  Advanced Voice Dialer                 </span>
              </div>
            </div>

            <h1>Sign in to RDS</h1>
            <p>
              Secure access to your AI-powered voice campaigns. Designed for
              modern call centers and sales teams.
            </p>
          </header>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-label">
              <span>Email address</span>
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

            {/* 🚨 DEBUG DISPLAY */}
            {error && (
              <div className="auth-error" style={{ whiteSpace: 'pre-wrap', fontSize: '0.8rem' }}>
                <strong>Error:</strong> {error}
                <br/>
                <small>Check Browser Console (F12) for full object dump.</small>
              </div>
            )}

            <div className="auth-form-footer">
              <button
                type="submit"
                className="auth-button"
                disabled={submitting}
              >
                {submitting ? "Signing in…" : "Sign In"}
              </button>
            </div>
          </form>

          <footer className="auth-footer-small">
            <span>New here?</span>{" "}
            <Link to="/register" className="auth-link">
              Create a RDS account
            </Link>
          </footer>
        </div>
      </div>

      <div className="auth-bottom-brand">
        <span className="auth-bottom-dot" />
        <span>
          Built by <strong></strong> ·{" "}
          <a
            href=""
            target="_blank"
            rel="noopener noreferrer"
            className="auth-brand-link"
          >
           CrimeStein Inc
          </a>
        </span>
      </div>
    </div>
  );
}
