// src/components/AuthContext.jsx
// ✅ FINAL WORKING VERSION - Fixes all refresh/unauthorized errors
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { useNavigate } from "react-router-dom";
import apiClient from "../apiClient";
import { io } from "socket.io-client";
import API_BASE_URL from "../api";

const AuthContext = createContext(null);

// -----------------------------
// Constants
// -----------------------------
const TOKEN_KEY = "vynce_token";
const normalizeEmail = (email) => (email || "").trim().toLowerCase();

// -----------------------------
// SOCKET (CONNECTS ONLY AFTER AUTH)
// -----------------------------
let socket = null;

export function AuthProvider({ children }) {
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(null);

  // -----------------------------
  // LOAD SAVED TOKEN FIRST ON PAGE LOAD
  // -----------------------------
  useEffect(() => {
    // 1. ALWAYS load saved token FIRST before doing anything else
    const savedToken = localStorage.getItem(TOKEN_KEY);
    if (savedToken) {
      setToken(savedToken);
      // Sync axios client immediately
      apiClient.defaults.headers.common.Authorization = `Bearer ${savedToken}`;
    } else {
      setLoading(false);
    }
  }, []);

  // -----------------------------
  // VALIDATE TOKEN AND LOAD USER
  // -----------------------------
  useEffect(() => {
    if (!token) return;
    let mounted = true;

    const validateSession = async () => {
      try {
        // Validate token with backend
        const res = await apiClient.get("/auth/me");

        if (mounted && res.data?.success) {
          setUser(res.data.user);
          
          // 🔑 NOW connect socket AFTER auth is confirmed
          if (!socket) {
            socket = io(API_BASE_URL, {
              transports: ["websocket", "polling"],
              credentials: true,
              auth: { token } // Send token for socket authentication
            });
          }
        } else {
          throw new Error("Invalid session");
        }
      } catch (err) {
        // Token is invalid: clean up and log out
        setToken(null);
        localStorage.removeItem(TOKEN_KEY);
        delete apiClient.defaults.headers.common.Authorization;
        setUser(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    validateSession();
    return () => { mounted = false };
  }, [token]);

  // -----------------------------
  // ✅ FIXED AUTH FETCH WITH AUTO-REFRESH
  // -----------------------------
  const authFetch = useCallback(
  async (url, options = {}) => {
    if (!token) throw new Error("No active session");

    try {
      // 1. Prepare base headers
      const headers = {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      };

      // 2. ✅ THE CRITICAL FIX:
      // If the body is FormData, DO NOT set the Content-Type header.
      // Let the browser handle it.
      if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
      }
      
      const res = await fetch(url, {
        ...options,
        headers, // Use the headers we just prepared
        credentials: 'include',
      });

        // Auto-refresh expired token
        if (res.status === 401) {
  const refreshRes = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });

  if (refreshRes.ok) {
    const refreshData = await refreshRes.json();

    setToken(refreshData.token);
    localStorage.setItem(TOKEN_KEY, refreshData.token);
    apiClient.defaults.headers.common.Authorization = `Bearer ${refreshData.token}`;

    // Retry original request (keep credentials + headers)
    const retryHeaders = {
      ...headers,
      Authorization: `Bearer ${refreshData.token}`,
    };

    // If original body is FormData, do NOT force Content-Type
    if (options.body instanceof FormData) {
      delete retryHeaders["Content-Type"];
    }

    return fetch(url, {
      ...options,
      headers: retryHeaders,
      credentials: "include",
    });
  } else {
    logout();
    throw new Error("Session expired. Please log back in.");
  }
}

        return res;
      } catch (err) {
        console.error("Auth fetch error:", err);
        throw err;
      }
    },
    [token]
  );

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

        if (!payload.email || !payload.password) {
          return { success: false, message: "Email and password are required." };
        }

        const res = await apiClient.post("/auth/login", payload);
        const data = res.data;

        if (!data?.success) {
          return { success: false, message: data?.message || "Login failed" };
        }

        // Save token everywhere
        setToken(data.token);
        localStorage.setItem(TOKEN_KEY, data.token);
        apiClient.defaults.headers.common.Authorization = `Bearer ${data.token}`;

        if (data?.user) setUser(data.user);

        // Connect socket after successful login
        if (!socket) {
          socket = io(API_BASE_URL, {
            transports: ["websocket", "polling"],
            credentials: true,
            auth: { token: data.token }
          });
        }

        return { success: true, user: data.user };
      } catch (err) {
        console.error("Login error:", err);
        const message =
          err?.response?.data?.message || err?.message || "Login failed";
        return { success: false, message };
      }
    },
    []
  );

  // -----------------------------
  // REGISTER
  // -----------------------------
  const register = useCallback(
    async ({ firstName, lastName, email, password, plan, company }) => {
      try {
        const payload = {
          firstName: (firstName || "").trim(),
          lastName: (lastName || "").trim(),
          email: normalizeEmail(email),
          password: password ?? "",
          plan: plan ?? "",
          company: (company || "").trim(),
        };

        if (
          !payload.firstName ||
          !payload.lastName ||
          !payload.email ||
          !payload.password
        ) {
          return { success: false, message: "All fields are required." };
        }

        const res = await apiClient.post("/auth/register", payload);
        const data = res.data;

        if (!data?.success) {
          return {
            success: false,
            message: data?.message || "Registration failed",
          };
        }

        // Save token everywhere
        setToken(data.token);
        localStorage.setItem(TOKEN_KEY, data.token);
        apiClient.defaults.headers.common.Authorization = `Bearer ${data.token}`;

        if (data?.user) setUser(data.user);

        navigate("/dashboard");
        return { success: true, user: data.user };
      } catch (err) {
        console.error("Register error:", err);
        const message =
          err?.response?.data?.message || err?.message || "Registration failed";
        return { success: false, message };
      }
    },
    [navigate]
  );

  // -----------------------------
  // LOGOUT
  // -----------------------------
  const logout = useCallback(async () => {
    try {
      await apiClient.post("/auth/logout");
    } catch { /* ignore */ } finally {
      // Full clean up
      setToken(null);
      localStorage.removeItem(TOKEN_KEY);
      delete apiClient.defaults.headers.common.Authorization;
      setUser(null);

      // Disconnect socket
      if (socket) {
        socket.disconnect();
        socket = null;
      }

      navigate("/login");
    }
  }, [navigate]);

  // -----------------------------
  // CONTEXT VALUE
  // -----------------------------
  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      register,
      logout,
      authFetch,
      socket: socket ?? null,
    }),
    [user, loading, login, register, logout, authFetch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// -----------------------------
// Hook
// -----------------------------
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
