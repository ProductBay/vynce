// src/App.jsx
import "./App.css";
import Layout from "./components/Layout.jsx";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./components/AuthContext.jsx";

import ProtectedRoute from "./components/ProtectedRoute.jsx";

// Pages
import Dashboard from "./pages/Dashboard.jsx";
import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Billing from "./pages/Billing.jsx";
import VoicemailManager from "./pages/VoicemailManager.jsx";
import Calls from "./pages/Calls.jsx";
import ScriptsManager from "./pages/ScriptsManager.jsx";
import Settings from "./pages/Settings.jsx";
import Terms from "./pages/Terms.jsx";
import Privacy from "./pages/Privacy.jsx";
import Disclaimer from "./pages/Disclaimer.jsx";
import Admin from "./pages/Admin.jsx";
// at top with other pages
import Support from "./pages/Support.jsx";
import Analytics from "./pages/Analytics.jsx"; 

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          {/* Public auth routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Redirect root to dashboard */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          {/* Protected app routes (all wrapped in Layout) */}
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
              <ProtectedRoute>
                <Layout>
                  <Settings />
                </Layout>
              </ProtectedRoute>
            }
          />

  {/* NEW: Analytics route */}
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

          {/* Support page route */}
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
          {/* Legal pages (can be public or protected; here we protect them so they stay inside the app shell) */}
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

          {/* Admin "Create Customer" page (also protected) */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <Layout>
                  <Admin />
                </Layout>
              </ProtectedRoute>
            }
          />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}