// frontend/src/pages/Billing.jsx
import React from "react";
import { useAuth } from "../components/AuthContext";
import "./Billing.css";

export default function Billing() {
  const { user } = useAuth();

  // Plans aligned with marketing site
  const plans = {
    starter: {
      key: "starter",
      name: "Starter",
      displayPrice: "$199",
      interval: "/month",
      features: [
        "Up to 5 agents • fair usage on calls",
        "Single brand / workspace",
        "Agent dialer + scripts + notes",
        "CSV imports & bulk campaigns",
        "Basic reporting",
        "Email support",
      ],
    },
    growth: {
      key: "growth",
      name: "Growth",
      displayPrice: "$499",
      interval: "/month",
      features: [
        "Up to 25 agents • volume discounts available",
        "Multiple campaigns & scripts",
        "Advanced outcomes & notes",
        "Agent & team performance views",
        "Priority email support",
        "Optional dedicated onboarding",
      ],
    },
    enterprise: {
      key: "enterprise", // used for white‑label/partner tier
      name: "White‑Label Partner",
      displayPrice: "Custom",
      interval: "", // no /month for Custom
      features: [
        "Your branding & custom domain",
        "Multi‑tenant customer workspaces",
        "API access (where available)",
        "Shared roadmap and priority support",
        "Co‑marketing and launch support",
      ],
    },
  };

  // Normalize current plan key from user subscription
  const currentPlanKey =
    (user?.subscription?.plan || "growth").toLowerCase();

  const planData = plans[currentPlanKey] || plans.growth;

  const usedCalls = user?.subscription?.usedCalls || 0;
  const maxCalls = user?.subscription?.maxCalls || 5000;
  const usagePercent = Math.min((usedCalls / maxCalls) * 100, 100);

  return (
    <div className="billing-container">
      <h1>Billing &amp; Subscription</h1>
      <p>Manage your Vynce plan and usage.</p>

      {/* Current Plan */}
      <div className="current-plan-card">
        <h2>Current: {planData.name}</h2>
        <div className="plan-price-display">
          {planData.displayPrice}
          {planData.interval && <span>{planData.interval}</span>}
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
            Used: {usedCalls.toLocaleString()} /{" "}
            {maxCalls.toLocaleString()} calls
          </div>
          <div className="usage-progress-bar">
            <div
              className="usage-progress-fill"
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Upgrade Options */}
      <div className="plans-section">
        <h2>Upgrade Plans</h2>
        <div className="plans-grid">
          {Object.entries(plans).map(([id, plan]) => (
            <div
              key={id}
              className={`plan-card ${
                currentPlanKey === id ? "current-plan" : ""
              }`}
            >
              <h3>{plan.name}</h3>
              <div className="plan-card-price">
                {plan.displayPrice}
                {plan.interval && <span>{plan.interval}</span>}
              </div>
              <ul className="plan-features-list">
                {plan.features.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
              <button
                className="plan-select-btn"
                disabled={currentPlanKey === id}
                onClick={() =>
                  alert(
                    `Upgrading to ${plan.name} – billing integration coming soon.`
                  )
                }
              >
                {currentPlanKey === id
                  ? "Current Plan"
                  : `Choose ${plan.name}`}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}