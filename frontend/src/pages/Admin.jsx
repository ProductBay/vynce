// src/pages/Admin.jsx
import React, { useState } from 'react';
import './Auth.css';
import API_BASE_URL from '../api';
import { useAuth } from '../components/AuthContext';

export default function Admin() {
  const { user, loading } = useAuth();

  const [form, setForm] = useState({
    company: '',
    firstName: '',
    lastName: '',
    email: '',
    plan: 'starter',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  // Debug log to verify what we see
  console.log('Admin user from useAuth:', user, 'loading:', loading);

  // Loading state
  if (loading) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1>Create Customer Account</h1>
            <p>Loading user information...</p>
          </div>
        </div>
      </div>
    );
  }

  const isSuperAdmin = user?.isSuperAdmin === true; // strict check

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);

    if (!isSuperAdmin) {
      setError('You are not authorized to create customers.');
      return;
    }

    if (!form.company || !form.firstName || !form.lastName || !form.email) {
      setError('All fields are required.');
      return;
    }

    setIsLoading(true);
    try {
      const token = localStorage.getItem('vynce_token');
      const res = await fetch(`${API_BASE_URL}/api/admin/create-customer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.message || `Request failed with status ${res.status}`);
      } else {
        setResult(data);
        setForm({
          company: '',
          firstName: '',
          lastName: '',
          email: '',
          plan: 'starter',
        });
      }
    } catch (err) {
      console.error('Create customer error:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1>Create Customer Account</h1>
          <p>Create a new Vynce customer with a company admin and subscription plan.</p>
        </div>

        {!isSuperAdmin && (
          <div className="auth-error">
            You are not authorized to access this page. Only A&apos;Dash super
            admin accounts can create customers.
          </div>
        )}

        {error && (
          <div className="auth-error">
            {error.split('\n').map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}

        {result && (
          <div className="auth-success">
            <p>✅ Customer created successfully.</p>
            <p>
              <strong>Admin Email:</strong> {result.user.email}
            </p>
            <p>
              <strong>Initial Password:</strong> <code>{result.initialPassword}</code>
            </p>
            <p>
              Share these credentials securely with the customer so they can sign
              in and change their password.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-group">
            <label htmlFor="company">Company Name</label>
            <input
              id="company"
              name="company"
              value={form.company}
              onChange={handleChange}
              placeholder="Client Company Inc"
              required
              disabled={!isSuperAdmin}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="firstName">Admin First Name</label>
              <input
                id="firstName"
                name="firstName"
                value={form.firstName}
                onChange={handleChange}
                placeholder="Jane"
                required
                disabled={!isSuperAdmin}
              />
            </div>
            <div className="form-group">
              <label htmlFor="lastName">Admin Last Name</label>
              <input
                id="lastName"
                name="lastName"
                value={form.lastName}
                onChange={handleChange}
                placeholder="Doe"
                required
                disabled={!isSuperAdmin}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="email">Admin Email</label>
            <input
              id="email"
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="admin@clientcompany.com"
              required
              disabled={!isSuperAdmin}
            />
          </div>

          <div className="form-group">
            <label htmlFor="plan">Vynce Plan</label>
            <select
              id="plan"
              name="plan"
              value={form.plan}
              onChange={handleChange}
              disabled={!isSuperAdmin}
            >
              <option value="starter">Starter – 1,000 calls</option>
              <option value="professional">Professional – 5,000 calls</option>
              <option value="enterprise">Enterprise – 20,000 calls</option>
            </select>
          </div>

          <button
            type="submit"
            className="auth-button"
            disabled={isLoading || !isSuperAdmin}
          >
            {isLoading ? 'Creating Customer...' : 'Create Customer'}
          </button>
        </form>
      </div>
    </div>
  );
}