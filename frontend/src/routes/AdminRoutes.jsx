// src/routes/AdminRoutes.jsx
import { Outlet } from "react-router-dom";
import { useAuth } from "../components/AuthContext";

export default function AdminRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: 24 }}>Loading admin…</div>;
  }

  // ❌ DO NOT NAVIGATE HERE
  // ❌ DO NOT REDIRECT TO /dashboard HERE
  // Role enforcement is handled by ProtectedRoute

  return <Outlet />;
}
