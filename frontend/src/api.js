// src/api.js
// Default to same-origin so Vite can proxy `/api` and `/socket.io` in local dev.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";

export default API_BASE_URL;
