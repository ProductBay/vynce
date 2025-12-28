// src/pages/Login.jsx
import React, { useState } from 'react';
import './Auth.css';
import { useAuth } from '../components/AuthContext';

export default function Login() {
  const { login } = useAuth();

  const [email, setEmail] = useState('demo@vynce.com');
  const [password, setPassword] = useState('password');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // 3D tilt state
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;  // 0 → 1
    const y = (e.clientY - rect.top) / rect.height; // 0 → 1
    const rotateX = (0.5 - y) * 12; // max tilt up/down
    const rotateY = (x - 0.5) * 18; // max tilt left/right
    setTilt({ x: rotateX, y: rotateY });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  const handleSubmit = async (e) => {
  e.preventDefault();

  if (submitting) return; // prevent double‑clicks

  setError(null);
  setSubmitting(true);

  try {
    const result = await login(email.trim(), password);

    if (!result?.success) {
      setError(result?.message || "Unable to sign in.");
    }
  } catch (err) {
    console.error("Login error:", err);
    setError(err.message || "Unable to sign in.");
  } finally {
    setSubmitting(false);
  }
};

 return (
  <div className="auth-page">
    {/* Animated background elements */}
    <div className="auth-orbit auth-orbit-1" />
    <div className="auth-orbit auth-orbit-2" />
    <div className="auth-grid-overlay" />

    {/* 3D card wrapper */}
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

        {/* Header */}
        <header className="auth-header">
          <div className="auth-logo-row">
            <div className="auth-logo-pulse">
              <span className="auth-logo-icon">📞</span>
            </div>
            <div className="auth-logo-text">
              <span className="auth-logo-title">Vynce</span>
              <span className="auth-logo-subtitle">
                Advanced Voice Dialer · A&apos;Dash Technologies
              </span>
            </div>
          </div>

          <h1>Sign in to Vynce</h1>
          <p>
            Secure access to your AI‑powered voice campaigns. Designed for
            modern call centers and sales teams.
          </p>
        </header>

        {/* Form */}
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

          <div className="auth-form-footer">
            <button
              type="submit"
              className="auth-button"
              disabled={submitting}
            >
              {submitting ? 'Signing in…' : 'Sign In'}
            </button>
          </div>
        </form>

        {/* Small footer in the card */}
        <footer className="auth-footer-small">
          <span>New here?</span>
          <a href="/register" className="auth-link">
            Create a Vynce account
          </a>
        </footer>
      </div>
    </div>

    {/* NEW: bottom-of-page animated branding (outside the card!) */}
    <div className="auth-bottom-brand">
  <span className="auth-bottom-dot" />
  <span>
    Built by <strong>Ashandie Powell</strong> ·{' '}
    <a
      href="https://a-dash-technology.vercel.app/"
      target="_blank"
      rel="noopener noreferrer"
      className="auth-brand-link"
    >
      A&apos;Dash Technologies
    </a>
  </span>
</div>
  </div>
);
}