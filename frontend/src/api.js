// src/api.js
// Default to same-origin so Vite can proxy `/api` and `/socket.io` in local dev.
const rawApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
const rawApiUrl = String(import.meta.env.VITE_API_URL || "").trim().replace(/\/$/, "");

export const API_BASE_URL =
  rawApiBaseUrl ||
  (rawApiUrl.endsWith("/api") ? rawApiUrl.slice(0, -4) : "");

export const API_URL =
  rawApiUrl ||
  (API_BASE_URL ? `${API_BASE_URL}/api` : "/api");

export function resolveApiUrl(url = "") {
  const input = String(url || "").trim();
  if (!input) return API_URL;
  if (/^https?:\/\//i.test(input)) return input;

  if (API_BASE_URL) {
    if (input.startsWith("/")) {
      return `${API_BASE_URL}${input}`;
    }

    return `${API_BASE_URL}/${input}`;
  }

  return input;
}

export default API_BASE_URL;
