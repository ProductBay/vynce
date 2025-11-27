import { useState, useEffect } from 'react';
import { useAuth } from '../components/AuthContext';
import './Billing.css';

export default function Billing() {
  const { user } = useAuth();
  const [plans] = useState({
    starter: { 
      name: 'Starter', 
      price: 29, 
      features: ['1,000 calls/month', 'Basic voicemail', 'Email support', 'CSV upload'] 
    },
    professional: { 
      name: 'Professional', 
      price: 49, 
      features: ['5,000 calls/month', 'Custom voicemail', 'Priority support', 'Advanced analytics', 'API access'] 
    },
    enterprise: { 
      name: 'Enterprise', 
      price: 99, 
      features: ['Unlimited calls', 'White-label voicemail', '24/7 phone support', 'Custom integrations', 'Dedicated account manager'] 
    }
  });

  const currentPlan = user?.subscription?.plan || 'professional';
  const planData = plans[currentPlan] || plans.professional;
  const usedCalls = user?.subscription?.usedCalls || 0;
  const maxCalls = user?.subscription?.maxCalls || 5000;
  const usagePercent = Math.min((usedCalls / maxCalls) * 100, 100);
  const API_BASE_URL = import.meta.env.VITE_API_URL || '/api'; 
  return (
    <div className="billing-container">
      <h1>Billing & Subscription</h1>
      <p>Manage your Vynce plan and usage</p>

      {/* Current Plan */}
      <div className="current-plan-card">
        <h2>Current: {planData.name}</h2>
        <div className="plan-price-display">
          ${planData.price}<span>/mo</span>
        </div>
        
        <div className="current-features">
          {planData.features.map((feature, i) => (
            <div key={i} className="feature-badge">
              ✓ {feature}
            </div>
          ))}
        </div>

        <div className="usage-section">
          <div className="usage-text">
            Used: {usedCalls.toLocaleString()} / {maxCalls.toLocaleString()} calls
          </div>
          <div className="usage-progress-bar">
            <div className="usage-progress-fill" style={{ width: `${usagePercent}%` }} />
          </div>
        </div>
      </div>

      {/* Upgrade Options */}
      <div className="plans-section">
        <h2>Upgrade Plans</h2>
        <div className="plans-grid">
          {Object.entries(plans).map(([id, plan]) => (
            <div key={id} className={`plan-card ${currentPlan === id ? 'current-plan' : ''}`}>
              <h3>{plan.name}</h3>
              <div className="plan-card-price">
                ${plan.price}<span>/mo</span>
              </div>
              <ul className="plan-features-list">
                {plan.features.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
              <button 
                className="plan-select-btn"
                disabled={currentPlan === id}
                onClick={() => alert(`Upgrading to ${plan.name} - Stripe integration coming!`)}
              >
                {currentPlan === id ? 'Current Plan' : `Choose ${plan.name}`}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}