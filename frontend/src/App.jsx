// src/App.jsx
import "./App.css";
import { Routes, Route, Navigate } from "react-router-dom";

import Layout from "./components/Layout.jsx";
import ProtectedRoute from "./components/ProtectedRoute.jsx";

// Pages (Agent / Public)
import Dashboard from "./pages/Dashboard.jsx";
import Login from "./pages/Login.jsx";
import AdminLogin from "./pages/admin/AdminLogin.jsx";
import Register from "./pages/Register.jsx";
import Billing from "./pages/Billing.jsx";
import VoicemailManager from "./pages/VoicemailManager.jsx";
import Calls from "./pages/Calls.jsx";
import ScriptsManager from "./pages/ScriptsManager.jsx";
import Settings from "./pages/Settings.jsx";
import Terms from "./pages/Terms.jsx";
import Privacy from "./pages/Privacy.jsx";
import Disclaimer from "./pages/Disclaimer.jsx";
import Support from "./pages/Support.jsx";
import Messages from "./pages/Messages.jsx";
import Analytics from "./pages/Analytics.jsx";

// Admin system (NEW)
import AdminRoutes from "./routes/AdminRoutes";
import AdminLayout from "./layouts/AdminLayout";
import AdminHome from "./pages/admin/AdminHome";
import AdminLicense from "./pages/admin/AdminLicense";
import AdminUsers from "./pages/admin/AdminUsers";
import AdminOnboarding from "./pages/admin/AdminOnboarding.jsx";
import AdminWebhookAudit from "./pages/admin/AdminWebhookAudit.jsx";
export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/register" element={<Register />} />

      {/* Redirect root */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Agent / User Routes */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Layout>
              <Dashboard />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/calls"
        element={
          <ProtectedRoute>
            <Layout>
              <Calls />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/scripts"
        element={
          <ProtectedRoute>
            <Layout>
              <ScriptsManager />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/voicemail"
        element={
          <ProtectedRoute>
            <Layout>
              <VoicemailManager />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/billing"
        element={
          <ProtectedRoute>
            <Layout>
              <Billing />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/settings"
        element={
          <ProtectedRoute requireAdmin>
            <Layout>
              <Settings />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/analytics"
        element={
          <ProtectedRoute>
            <Layout>
              <Analytics />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/messages"
        element={
          <ProtectedRoute>
            <Layout>
              <Messages />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/support"
        element={
          <ProtectedRoute>
            <Layout>
              <Support />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/terms"
        element={
          <ProtectedRoute>
            <Layout>
              <Terms />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/privacy"
        element={
          <ProtectedRoute>
            <Layout>
              <Privacy />
            </Layout>
          </ProtectedRoute>
        }
      />

      <Route
        path="/disclaimer"
        element={
          <ProtectedRoute>
            <Layout>
              <Disclaimer />
            </Layout>
          </ProtectedRoute>
        }
      />

      {/* 🔒 ADMIN ROUTES (PROTECTED) */}
<Route
  path="/admin"
  element={
    <ProtectedRoute requireAdmin loginPath="/admin/login">
      <AdminRoutes />
    </ProtectedRoute>
  }
>
  <Route element={<AdminLayout />}>
    <Route index element={<AdminHome />} />
    <Route path="onboarding" element={<AdminOnboarding />} />
    <Route path="license" element={<AdminLicense />} />
    <Route path="users" element={<AdminUsers />} />
    <Route path="webhooks" element={<AdminWebhookAudit />} />
  </Route>
</Route>


      {/* Fallback */}
      <Route
  path="/"
  element={
    <ProtectedRoute>
      <Navigate to="/dashboard" replace />
    </ProtectedRoute>
  }
/>
    </Routes>
  );
}
