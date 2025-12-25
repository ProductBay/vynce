// frontend/src/components/Footer.jsx
import React from 'react';
import './Footer.css';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="app-footer">
      <div className="app-footer-left">
        <div className="app-footer-brand">
          Built by <strong>Ashandie Powell</strong> · A&apos;Dash Technologies
        </div>
        <div className="app-footer-meta">
          © {year} All rights reserved. Vynce is proprietary software fully
          developed by Ashandie Powell. Unauthorized copying, distribution,
          or resale is strictly prohibited.
        </div>
        <div className="app-footer-warning">
          Use of this system is subject to applicable telemarketing, TCPA and
          privacy regulations. Ensure you have the proper consent before placing
          automated or bulk calls.
        </div>
      </div>

      <div className="app-footer-links">
        {/* These can be routed pages or external links in the future */}
        <a href="/terms" target="_blank" rel="noopener noreferrer">
          Terms of Use
        </a>
        <span>•</span>
        <a href="/privacy" target="_blank" rel="noopener noreferrer">
          Privacy
        </a>
        <span>•</span>
        <a href="/disclaimer" target="_blank" rel="noopener noreferrer">
          Disclaimer
        </a>
      </div>
    </footer>
  );
}