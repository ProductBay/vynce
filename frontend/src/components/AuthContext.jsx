// src/components/AuthContext.jsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import API_BASE_URL from '../api';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);      // { firstName, lastName, email, company, isSuperAdmin, subscription, ... }
  const [loading, setLoading] = useState(true); // true while we check token / load user

  // Load current user on initial mount, if a token is stored
  useEffect(() => {
    const token = localStorage.getItem('vynce_token');
    if (!token) {
      setLoading(false);
      return;
    }

    const fetchMe = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok || !data.success) {
          // token invalid or user not found
          localStorage.removeItem('vynce_token');
          setUser(null);
        } else {
          setUser(data.user);
        }
      } catch (err) {
        console.error('Failed to load current user:', err);
        localStorage.removeItem('vynce_token');
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    fetchMe();
  }, []);

  // Login with email/password
  const login = async (email, password) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        return { success: false, message: data.message || 'Login failed' };
      }

      localStorage.setItem('vynce_token', data.token);
      setUser(data.user);
      navigate('/dashboard');
      return { success: true };
    } catch (err) {
      console.error('Login error:', err);
      return { success: false, message: err.message };
    }
  };

  // Register new account (self‑service or for initial admin)
  const register = async ({ firstName, lastName, email, password, plan }) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, email, password, plan }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        return { success: false, message: data.message || 'Registration failed' };
      }

      localStorage.setItem('vynce_token', data.token);
      setUser(data.user);
      navigate('/dashboard');
      return { success: true };
    } catch (err) {
      console.error('Register error:', err);
      return { success: false, message: err.message };
    }
  };

  const logout = () => {
    localStorage.removeItem('vynce_token');
    setUser(null);
    navigate('/login');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);