import React, { useMemo, useState } from "react";
import { useAuth } from "../components/AuthContext";
import "./Billing.css";

const planCatalog = {
  professional: {
    key: "professional",
    name: "Professional",
    displayPrice: "$199",
    interval: "/month",
    includedActiveUsers: 1,
    additionalAgentPrice: 250,
    unlimitedCalls: true,
    features: [
      "1 included active user",
      "$250/month for each additional active user",
      "Unlimited calls across the workspace",
      "Single workspace with scripts, notes, and CSV campaigns",
      "Priority onboarding and operational support",
    ],
  },
  team: {
    key: "team",
    name: "Team",
    displayPrice: "$599",
    interval: "/month",
    includedActiveUsers: 5,
    additionalAgentPrice: 0,
    unlimitedCalls: true,
    features: [
      "5 included active users",
      "Unlimited calls across the workspace",
      "Shared scripts, call reviews, and live operations",
      "Best fit for growing sales or support teams",
    ],
  },
  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    displayPrice: "Custom",
    interval: "",
    includedActiveUsers: Infinity,
    additionalAgentPrice: 0,
    unlimitedCalls: true,
    features: [
      "Unlimited active users",
      "Unlimited calls",
      "Custom workflows, admin controls, and rollout support",
      "Best for multi-team or white-glove deployments",
    ],
  },
};

export default function Billing() {
  const { user } = useAuth();
  const [copied, setCopied] = useState("");

  const currentPlanKey = (user?.subscription?.plan || "professional").toLowerCase();
  const planData = planCatalog[currentPlanKey] || planCatalog.professional;
  const additionalAgentSeats = Number(user?.subscription?.additionalAgentSeats || 0);
  const includedUsers = Number(
    user?.subscription?.includedActiveUsers || planData.includedActiveUsers || 1
  );
  const effectiveActiveUsers =
    Number.isFinite(includedUsers) ? includedUsers + additionalAgentSeats : "Unlimited";
  const monthlyPrice = Number(user?.subscription?.monthlyPrice || 0);
  const monthlyTotal =
    currentPlanKey === "professional"
      ? monthlyPrice + additionalAgentSeats * Number(user?.subscription?.additionalAgentPrice || 250)
      : monthlyPrice;

  const btcAddress =
    import.meta.env.VITE_BTC_WALLET_ADDRESS ||
    "1CSm92V7AKU2Kbb5JjENLhZTreo3LQDx62";

  const paymentReference = useMemo(() => {
    const id = user?._id || user?.id || "unknown-user";
    const tenant = user?.tenantId || "default";
    return `VYNCE|tenant:${tenant}|user:${id}|plan:${currentPlanKey}`;
  }, [user, currentPlanKey]);

  const btcUri = useMemo(() => {
    return `bitcoin:${btcAddress}?message=${encodeURIComponent(paymentReference)}`;
  }, [btcAddress, paymentReference]);

  const qrUrl = useMemo(() => {
    const data = encodeURIComponent(btcUri);
    return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${data}`;
  }, [btcUri]);

  async function copyToClipboard(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(""), 1200);
    } catch {
      alert("Copy failed. Please copy manually.");
    }
  }

  return (
    <div className="billing-container">
      <h1>Billing</h1>
      <p>Manage your current plan structure and pay your subscription via Bitcoin (BTC).</p>

      <div className="current-plan-card">
        <h2>Current: {planData.name}</h2>
        <div className="plan-price-display">
          {planData.displayPrice}
          {planData.interval && <span>{planData.interval}</span>}
        </div>

        <div className="current-features">
          {planData.features.map((feature, i) => (
            <div key={i} className="feature-badge">
              {feature}
            </div>
          ))}
        </div>

        <div className="usage-section">
          <div className="usage-text">
            Calls: Unlimited
          </div>
          <div className="usage-text">
            Active users included: {Number.isFinite(includedUsers) ? includedUsers : "Unlimited"}
          </div>
          {currentPlanKey === "professional" && (
            <div className="usage-text">
              Additional active users: {additionalAgentSeats} x $250/month
            </div>
          )}
          <div className="usage-text">
            Effective active users available: {effectiveActiveUsers}
          </div>
          {monthlyTotal > 0 && (
            <div className="usage-text">
              Estimated monthly total: ${monthlyTotal}
            </div>
          )}
        </div>
      </div>

      <div className="plans-section">
        <h2>Current Plan Structure</h2>

        <div className="plan-card current-plan">
          <h3>Professional</h3>
          <p>Base plan for one active user with unlimited calls.</p>
          <p>Each additional active user is billed at $250/month.</p>
        </div>

        <div className="plan-card current-plan">
          <h3>Team</h3>
          <p>$599/month for 5 active users with unlimited calls.</p>
        </div>

        <div className="plan-card current-plan">
          <h3>Enterprise</h3>
          <p>Custom pricing for larger operational teams and advanced rollout support.</p>
        </div>
      </div>

      <div className="plans-section">
        <h2>Pay with Bitcoin</h2>

        <div className="plan-card current-plan">
          <h3>Bitcoin (BTC) Wallet</h3>
          <p style={{ marginTop: 8, color: "rgba(255,255,255,0.75)" }}>
            Send BTC to the address below. Include the reference so we can match your payment.
          </p>

          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap", marginTop: 14 }}>
            <div style={{ minWidth: 220 }}>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>BTC Address</div>
              <div
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 14,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  wordBreak: "break-all",
                }}
              >
                {btcAddress}
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  className="plan-select-btn"
                  onClick={() => copyToClipboard(btcAddress, "address")}
                >
                  {copied === "address" ? "Copied" : "Copy Address"}
                </button>

                <button
                  className="plan-select-btn"
                  onClick={() => copyToClipboard(paymentReference, "reference")}
                >
                  {copied === "reference" ? "Copied" : "Copy Reference"}
                </button>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Payment Reference</div>
                <div
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 12.5,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.06)",
                    wordBreak: "break-word",
                  }}
                >
                  {paymentReference}
                </div>
              </div>
            </div>

            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Scan to Pay</div>
              <img
                src={qrUrl}
                alt="Bitcoin payment QR"
                width={180}
                height={180}
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  padding: 10,
                }}
              />
              <div style={{ marginTop: 10 }}>
                <button className="plan-select-btn" onClick={() => copyToClipboard(btcUri, "uri")}>
                  {copied === "uri" ? "Copied" : "Copy Payment URI"}
                </button>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, fontSize: 13, opacity: 0.8 }}>
            After sending payment, contact support with your transaction ID (TXID) to activate or renew.
          </div>
        </div>
      </div>
    </div>
  );
}
