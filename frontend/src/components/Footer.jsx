// frontend/src/components/Footer.jsx
import React from 'react';
import './Footer.css';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="app-footer">
      <div className="app-footer-left">
        <div className="app-footer-brand">
          Built by <strong>CrimeStein Inc</strong> </div>
        <div className="app-footer-meta">
          © {year} All rights reserved. Ring-D-Skull is proprietary software fully
          developed by CrimeStein Inc. 
        </div>
        <div className="app-footer-warning">
      
        </div>
      </div>

      <div className="app-footer-links">
        {/* These can be routed pages or external links in the future */}
        
      </div>
    </footer>
  );
}