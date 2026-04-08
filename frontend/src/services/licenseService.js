import axios from "axios";
import { resolveApiUrl } from "../api";

export async function fetchLicenseStatus(token) {
  const res = await axios.get(resolveApiUrl("/api/license/status"), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  return res.data;
}

export async function listTenants(authFetch) {
  const res = await authFetch("/api/admin/tenants");
  const json = await res.json();
  if (!json.success) throw new Error(json.message || "Failed to load tenants");
  return json.tenants || [];
}

export async function getTenantLicense(authFetch, tenantId) {
  const url = `/api/admin/license?tenantId=${encodeURIComponent(tenantId)}`;
  const res = await authFetch(url);
  const json = await res.json();
  if (!json.success) throw new Error(json.message || "Failed to load license");
  return json.data || {};
}

export async function updateTenantLicense(authFetch, tenantId, body) {
  const url = `/api/admin/license?tenantId=${encodeURIComponent(tenantId)}`;
  const res = await authFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.message || "Failed to update license");
  return json.data || {};
}
