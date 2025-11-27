import React, { createContext, useState, useContext, useEffect } from 'react';

const AuthContext = createContext();

// Custom hook to use the auth context
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

// AuthProvider component - THIS MUST BE A NAMED EXPORT
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(localStorage.getItem('vynce_token'));

  const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';  // 👈 FIXED

  useEffect(() => {
    if (token) {
      fetchUserProfile();
    } else {
      setLoading(false);
    }
  }, [token]);

  const fetchUserProfile = async () => {
    try {
      console.log('🔍 Fetching user profile...');
      const response = await fetch('/api/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
        console.log('✅ User profile loaded:', data.user.email);
      } else {
        console.log('❌ Token invalid, logging out');
        logout();
      }
    } catch (error) {
      console.error('❌ Network error fetching profile:', error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, password) => {
    try {
      console.log('🔐 Attempting login...');
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      // Check if we got any response
      if (!response) {
        throw new Error('No response from server - check if backend is running');
      }

      const data = await response.json();
      console.log('Login response:', data);

      if (data.success) {
        setUser(data.user);
        setToken(data.token);
        localStorage.setItem('vynce_token', data.token);
        return { success: true };
      } else {
        return { success: false, message: data.message };
      }
    } catch (error) {
      console.error('❌ Login network error:', error);
      return { 
        success: false, 
        message: `Cannot connect to server: ${error.message}. Please make sure the backend is running on ${API_BASE_URL}` 
      };
    }
  };

  const register = async (userData) => {
    try {
      console.log('📝 Attempting registration...');
      console.log('Registration data:', userData);
      
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(userData),
      });

      // Check if we got any response
      if (!response) {
        throw new Error('No response from server - check if backend is running');
      }

      const data = await response.json();
      console.log('Registration response:', data);

      if (data.success) {
        setUser(data.user);
        setToken(data.token);
        localStorage.setItem('vynce_token', data.token);
        return { success: true };
      } else {
        return { success: false, message: data.message };
      }
    } catch (error) {
      console.error('❌ Registration network error:', error);
      return { 
        success: false, 
        message: `Cannot connect to server: ${error.message}. Please check:\n\n1. Backend server is running\n2. Backend URL: ${API_BASE_URL}\n3. No CORS issues\n4. Network connectivity` 
      };
    }
  };

  const logout = () => {
    console.log('🚪 Logging out...');
    setUser(null);
    setToken(null);
    localStorage.removeItem('vynce_token');
  };

  const testConnection = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/health`);
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Backend connection successful:', data);
        return { success: true, data };
      } else {
        return { success: false, message: `Backend returned ${response.status}` };
      }
    } catch (error) {
      console.error('❌ Backend connection failed:', error);
      return { success: false, message: error.message };
    }
  };

  const value = {
    user,
    login,
    register,
    logout,
    loading,
    token,
    testConnection,
    apiBaseUrl: API_BASE_URL
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// Default export (optional - you can remove this if you only want named exports)
export default AuthContext;