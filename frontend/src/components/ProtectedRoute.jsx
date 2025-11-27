// src/components/ProtectedRoute.jsx - NAMED EXPORT FIXED (Matches App.jsx import)
import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function ProtectedRoute({ allowedRoles = [], requireSubscription = false }) {  // 👈 NAMED EXPORT
  const { user, loading } = useAuth();
  const location = useLocation();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    if (!loading) {
      const hasRole = allowedRoles.length === 0 || (user?.roles && allowedRoles.some(role => user.roles.includes(role)));
      const hasSub = !requireSubscription || user?.subscription;
      setIsAuthorized(!!user && hasRole && hasSub);
    }
  }, [user, loading, allowedRoles, requireSubscription]);

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white'
      }}>
        <div>
          <div style={{
            width: 50, height: 50, border: '4px solid rgba(255,255,255,0.3)',
            borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite',
            margin: '0 auto 1rem'
          }} />
          <p>Securing Vynce...</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return <Navigate to={user ? '/billing' : '/login'} state={{ from: location }} replace />;
  }

  return <Outlet />;
}

// Global CSS for spinner (App.css)
const style = document.createElement('style');
style.textContent = `
  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
`;
document.head.appendChild(style);