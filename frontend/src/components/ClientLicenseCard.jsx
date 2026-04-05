import { useEffect, useState } from "react";
import { useAuth } from "../components/AuthContext";
import "./ClientLicenseCard.css";

// 🔗 ADMIN LICENSE ACTION → BACKEND ENDPOINT MAP
const ACTION_ENDPOINTS = {
  enable: "/api/admin/license/enable",
  disable: "/api/admin/license/disable",
  "temp-disable": "/api/admin/license/temp-disable",

  // fallback names (only used if backend uses these)
  suspend: "/api/admin/license/suspend",
  unsuspend: "/api/admin/license/unsuspend",
};

export default function ClientLicenseCard({ tenant }) {
  const { authFetch } = useAuth();

  const [license, setLicense] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updating, setUpdating] = useState(false);

  async function fetchLicense() {
    if (!tenant?.tenantId) {
      setError("Invalid tenant identifier");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const res = await authFetch(
        `/api/admin/license?tenantId=${tenant.tenantId}`
      );

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.message || "Failed to load license");
      }

      setLicense(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(action) {
    setUpdating(true);
    try {
      const endpoint = ACTION_ENDPOINTS[action];

      if (!endpoint) {
        throw new Error(`Unknown license action: ${action}`);
      }

      const res = await authFetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tenantId: tenant.tenantId,
        }),
      });

      // 🔐 SAFE response handling (prevents "Unexpected token <")
      const text = await res.text();
      let json;

      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(
          "Server returned a non-JSON response. Check backend route."
        );
      }

      if (!json.success) {
        throw new Error(json.message || "License update failed");
      }

      // 🔄 Refresh card state after update
      await fetchLicense();
    } catch (err) {
      alert(err.message);
    } finally {
      setUpdating(false);
    }
  }

  useEffect(() => {
    fetchLicense();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="license-card loading">
        Loading license…
      </div>
    );
  }

  if (error) {
    return (
      <div className="license-card error">
        <strong>{tenant.companyName}</strong>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="license-card">
      <div className="license-header">
        <h3>{tenant.companyName}</h3>
        <span className={`status ${license.status || "unknown"}`}>
          {(license.status || "unknown").toUpperCase()}
        </span>
      </div>

      <div className="license-meta">
        <div><strong>Tenant ID:</strong> {tenant.tenantId}</div>

        <div><strong>License:</strong> {license.licenseKey}</div>
        <div><strong>Plan:</strong> {license.plan}</div>
      </div>

      <div className="license-actions">
        {license.status !== "active" && (
          <button
            disabled={updating}
            onClick={() => updateStatus("enable")}
          >
            Enable
          </button>
        )}

        {license.status === "active" && (
          <>
            <button
              disabled={updating}
              onClick={() => updateStatus("disable")}
            >
              Disable
            </button>

            <button
              disabled={updating}
              onClick={() => updateStatus("temp-disable")}
            >
              Temp Disable
            </button>
          </>
        )}
      </div>
    </div>
  );
}
