import React, { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import './Auth.css';

export default function Register() {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    company: '',
    plan: 'starter'
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('checking');

  const { register, testConnection, apiBaseUrl } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    // Test backend connection on component mount
    checkBackendConnection();
  }, []);

  const checkBackendConnection = async () => {
    setConnectionStatus('checking');
    const result = await testConnection();
    if (result.success) {
      setConnectionStatus('connected');
    } else {
      setConnectionStatus('failed');
      setError(`Backend connection failed: ${result.message}\n\nPlease make sure the backend server is running on ${apiBaseUrl}`);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (connectionStatus !== 'connected') {
      setError('Cannot register: Backend server is not connected. Please check if the server is running.');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsLoading(true);

    const { confirmPassword, ...registrationData } = formData;
    const result = await register(registrationData);
    
    if (result.success) {
      navigate('/dashboard');
    } else {
      setError(result.message);
    }
    
    setIsLoading(false);
  };

  const getConnectionStatusText = () => {
    switch (connectionStatus) {
      case 'checking':
        return '🔍 Checking backend connection...';
      case 'connected':
        return '✅ Backend connected';
      case 'failed':
        return '❌ Backend connection failed';
      default:
        return '';
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1>Join Vynce</h1>
          <p>Create your account and start calling</p>
        </div>

        {/* Connection Status */}
        <div className={`connection-status ${connectionStatus}`}>
          {getConnectionStatusText()}
          {connectionStatus === 'failed' && (
            <button 
              type="button" 
              className="retry-btn"
              onClick={checkBackendConnection}
            >
              Retry Connection
            </button>
          )}
        </div>

        {error && (
          <div className="auth-error">
            {error.split('\n').map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="firstName">First Name</label>
              <input
                type="text"
                id="firstName"
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                required
                placeholder="John"
                disabled={connectionStatus !== 'connected'}
              />
            </div>

            <div className="form-group">
              <label htmlFor="lastName">Last Name</label>
              <input
                type="text"
                id="lastName"
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                required
                placeholder="Doe"
                disabled={connectionStatus !== 'connected'}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="company">Company Name</label>
            <input
              type="text"
              id="company"
              name="company"
              value={formData.company}
              onChange={handleChange}
              placeholder="Your Company Inc"
              disabled={connectionStatus !== 'connected'}
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              placeholder="john@company.com"
              disabled={connectionStatus !== 'connected'}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="password">Password</label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
                placeholder="••••••••"
                disabled={connectionStatus !== 'connected'}
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                required
                placeholder="••••••••"
                disabled={connectionStatus !== 'connected'}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="plan">Choose Plan</label>
            <select
              id="plan"
              name="plan"
              value={formData.plan}
              onChange={handleChange}
              disabled={connectionStatus !== 'connected'}
            >
              <option value="starter">Starter - $49/month</option>
              <option value="professional">Professional - $99/month</option>
              <option value="enterprise">Enterprise - $199/month</option>
            </select>
          </div>

          <button 
            type="submit" 
            className="auth-button"
            disabled={isLoading || connectionStatus !== 'connected'}
          >
            {isLoading ? 'Creating Account...' : 'Start 14-Day Free Trial'}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            Already have an account?{' '}
            <Link to="/login" className="auth-link">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}