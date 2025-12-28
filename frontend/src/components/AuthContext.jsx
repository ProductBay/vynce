// src/components/AuthContext.jsx
// ✅ Full rewrite (safe, drop-in replacement)
// ✅ Maintains current public API: { user, loading, login, register, logout, authFetch }
// ✅ Improvements:
//   - Normalizes email (trim + lowercase) for login/register consistency
//   - Robust error parsing (JSON OR text) to avoid silent failures
//   - authFetch only sets Authorization header when a token exists (prevents "Bearer " edge cases)
//   - Single-refresh retry on 401 with guard to avoid loops
//   - Cleaner init bootstrap using /api/auth/me if token exists
//   - Keeps refreshToken logic (cookie-based) but fails safely if endpoint not available

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { useNavigate } from "react-router-dom";
import API_BASE_URL from "../api";

const AuthContext = createContext(null);

// -----------------------------
// Helpers
// -----------------------------
const TOKEN_KEY = "vynce_token";

const normalizeEmail = (email) => (email || "").trim().toLowerCase();

async function safeReadResponse(res) {
  // Tries JSON first, then text fallback
  const contentType = res.headers?.get?.("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      return await res.json();
    }
  } catch {
    // fall through
  }

  // fallback: try text
  try {
    const text = await res.text();
    // try to parse text as JSON if it looks like JSON
    if (text && (text.startsWith("{") || text.startsWith("["))) {
      try {
        return JSON.parse(text);
      } catch {
        // ignore parse error
      }
    }
    return { message: text };
  } catch {
    return {};
  }
}

export function AuthProvider({ children }) {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // -----------------------------
  // TOKEN HELPERS
  // -----------------------------
  const getToken = useCallback(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }, []);

  const setToken = useCallback((token) => {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }, []);

  // -----------------------------
  // REFRESH TOKEN (cookie-based)
  // -----------------------------
  const refreshToken = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: "POST",
        credentials: "include", // requires HttpOnly cookie
      });

      const data = await safeReadResponse(res);

      if (!res.ok || !data?.success || !data?.token) {
        throw new Error(data?.message || "Refresh failed");
      }

      setToken(data.token);
      if (data.user) setUser(data.user);

      return true;
    } catch (err) {
      // If refresh endpoint doesn't exist or cookie expired, we clear session cleanly
      console.warn("Token refresh failed:", err?.message || err);
      setToken(null);
      setUser(null);
      return false;
    }
  }, [setToken]);

  // -----------------------------
  // AUTH FETCH WRAPPER
  // -----------------------------
  const authFetch = useCallback(
    async (url, options = {}) => {
      const token = getToken();

      // Build headers safely
      const headers = {
        ...(options.headers || {}),
      };

      // Only set Authorization if we actually have a token
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const doFetch = async () =>
        fetch(url, {
          ...options,
          headers,
          credentials: "include",
        });

      let res = await doFetch();

      // If token expired, try refresh ONCE then retry
      if (res.status === 401) {
        const refreshed = await refreshToken();
        if (!refreshed) return res; // caller can handle

        const newToken = getToken();

        const retryHeaders = {
          ...(options.headers || {}),
          ...(newToken ? { Authorization: `Bearer ${newToken}` } : {}),
        };

        res = await fetch(url, {
          ...options,
          headers: retryHeaders,
          credentials: "include",
        });
      }

      return res;
    },
    [getToken, refreshToken]
  );

  // -----------------------------
  // LOAD CURRENT USER ON APP START
  // -----------------------------
  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      const token = getToken();

      // No token: app is unauthenticated
      if (!token) {
        if (isMounted) setLoading(false);
        return;
      }

      try {
        const res = await authFetch(`${API_BASE_URL}/api/auth/me`);
        const data = await safeReadResponse(res);

        if (!res.ok || !data?.success || !data?.user) {
          throw new Error(data?.message || "Invalid session");
        }

        if (isMounted) setUser(data.user);
      } catch (err) {
        // Token invalid/expired
        setToken(null);
        if (isMounted) setUser(null);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    init();

    return () => {
      isMounted = false;
    };
  }, [authFetch, getToken, setToken]);

  // -----------------------------
  // LOGIN
  // -----------------------------
  const login = useCallback(
    async (email, password) => {
      try {
        const payload = {
          email: normalizeEmail(email),
          password: password ?? "",
        };

        // Prevent sending empty data (often causes 400)
        if (!payload.email || !payload.password) {
          return { success: false, message: "Email and password are required." };
        }

        const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });

        const data = await safeReadResponse(res);

        if (!res.ok || !data?.success) {
          // Provide the backend message if present; fallback to HTTP status
          return {
            success: false,
            message:
              data?.message ||
              `Login failed (HTTP ${res.status})`,
          };
        }

        // Expect { success:true, token, user }
        if (data?.token) setToken(data.token);
        if (data?.user) setUser(data.user);

        // Only navigate if login succeeded
        navigate("/dashboard");
        return { success: true, user: data.user };
      } catch (err) {
        console.error("Login error:", err);
        return { success: false, message: err?.message || "Login failed" };
      }
    },
    [navigate, setToken]
  );

  // -----------------------------
  // REGISTER
  // -----------------------------
  const register = useCallback(
    async ({ firstName, lastName, email, password, plan }) => {
      try {
        const payload = {
          firstName: (firstName || "").trim(),
          lastName: (lastName || "").trim(),
          email: normalizeEmail(email),
          password: password ?? "",
          plan: plan ?? "",
        };

        if (!payload.firstName || !payload.lastName || !payload.email || !payload.password) {
          return { success: false, message: "All fields are required." };
        }

        const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload),
        });

        const data = await safeReadResponse(res);

        if (!res.ok || !data?.success) {
          return {
            success: false,
            message:
              data?.message ||
              `Registration failed (HTTP ${res.status})`,
          };
        }

        if (data?.token) setToken(data.token);
        if (data?.user) setUser(data.user);

        navigate("/dashboard");
        return { success: true, user: data.user };
      } catch (err) {
        console.error("Register error:", err);
        return { success: false, message: err?.message || "Registration failed" };
      }
    },
    [navigate, setToken]
  );

  // -----------------------------
  // LOGOUT
  // -----------------------------
  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE_URL}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // ignore network errors on logout
    } finally {
      setToken(null);
      setUser(null);
      navigate("/login");
    }
  }, [navigate, setToken]);

  // -----------------------------
  // CONTEXT VALUE (memoized)
  // -----------------------------
  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      register,
      logout,
      authFetch, // 🔥 use this for all protected API calls
    }),
    [user, loading, login, register, logout, authFetch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
