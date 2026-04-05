import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export default function ProtectedRoute({
  children,
  requireAdmin = false,
  loginPath = "/login",
}) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div style={{ padding: 24 }}>Loading auth...</div>;
  }

  if (!user) {
    return (
      <Navigate
        to={loginPath}
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  if (
    requireAdmin &&
    user.role !== "admin" &&
    user.isSuperAdmin !== true
  ) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
