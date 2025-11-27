import "./App.css"
import Layout from "./components/Layout.jsx"
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom"
import Dashboard from "./pages/Dashboard.jsx"
import Login from "./pages/Login.jsx"
import Register from "./pages/Register.jsx"
import Billing from "./pages/Billing.jsx"  // ✅ REAL COMPONENT
import { AuthProvider } from "./components/AuthContext.jsx"
import { ProtectedRoute } from "./components/ProtectedRoute.jsx"
import ErrorBoundary from './components/ErrorBoundary'

// Placeholder components (NOT Billing - that's real now!)
const CallsPage = () => <div className="page-container"><h1>Calls</h1><p>Coming soon...</p></div>
const ScriptsPage = () => <div className="page-container"><h1>Scripts</h1><p>Coming soon...</p></div>
const VoicemailPage = () => <div className="page-container"><h1>Voicemail</h1><p>Coming soon...</p></div>
const SettingsPage = () => <div className="page-container"><h1>Settings</h1><p>Coming soon...</p></div>

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* PUBLIC ROUTES */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          
          {/* PROTECTED ROUTES */}
          <Route element={<ProtectedRoute />}>  {/* ✅ WRAP ALL PROTECTED */}
            <Route path="/" element={<Layout><Dashboard /></Layout>} />
            <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
            <Route path="/calls" element={<Layout><CallsPage /></Layout>} />
            <Route path="/scripts" element={<Layout><ScriptsPage /></Layout>} />
            <Route path="/voicemail" element={<Layout><VoicemailPage /></Layout>} />
            
            {/* ✅ BILLING - REAL COMPONENT (No duplicate!) */}
            <Route path="/billing" element={
              <Layout>
                <ErrorBoundary>
                  <Billing />
                </ErrorBoundary>
              </Layout>
            } />
            
            <Route path="/settings" element={<Layout><SettingsPage /></Layout>} />
          </Route>

          {/* FALLBACK */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  )
}