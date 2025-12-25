// frontend/src/pages/Analytics.jsx
import React, { useEffect, useState } from "react";
import "./Analytics.css";
import API_BASE_URL from "../api";
import { useAuth } from "../components/AuthContext";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export default function Analytics() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState(null);
  const [overview, setOverview] = useState(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      setLoading(true);
      setError(null);
      setDenied(false);
      try {
        const res = await fetch(`${API_BASE_URL}/api/analytics/overview`, {
          credentials: "include", // adjust if you use tokens instead of cookies
        });

        if (res.status === 403) {
          setDenied(true);
          setLoading(false);
          return;
        }

        if (!res.ok) {
          throw new Error(`Server returned ${res.status}`);
        }

        const data = await res.json();
        if (data.success) {
          setOverview(data.data);
        } else {
          throw new Error(data.message || "Failed to load analytics.");
        }
      } catch (err) {
        console.error("Analytics error:", err);
        setError(err.message || "Could not load analytics.");
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, []);

  const plan = user?.subscription?.plan;

  const outcomeData = overview
    ? Object.entries(overview.outcomeCounts || {}).map(([key, value]) => ({
        outcome: formatOutcome(key),
        count: value || 0,
      }))
    : [];

  const agentData = overview
    ? Object.entries(overview.agentCounts || {}).map(([key, value]) => ({
        agent: key,
        count: value || 0,
      }))
    : [];

  const callsPerDayData = overview?.callsPerDay || [];

  return (
    <div className="analytics-page">
      <div className="analytics-header">
        <div>
          <h1>Analytics</h1>
          <p>
            Understand how your team is using Vynce and how calls are
            performing.
          </p>
        </div>
        {plan && (
          <div className="analytics-plan-pill">
            Plan: <span className="analytics-plan-label">{plan}</span>
          </div>
        )}
      </div>

      {loading && <p>Loading analytics…</p>}

      {!loading && denied && (
        <div className="analytics-locked">
          <h2>Analytics is not included in your current plan.</h2>
          <p>
            Upgrade to <strong>Growth</strong> or higher to unlock call trends,
            agent performance, and outcome breakdowns.
          </p>
          <a href="/billing" className="btn-primary">
            View plans
          </a>
        </div>
      )}

      {!loading && error && !denied && (
        <div className="analytics-error">Error: {error}</div>
      )}

      {!loading && overview && !denied && (
        <>
          {/* Summary cards */}
          <div className="analytics-summary-row">
            <div className="analytics-summary-card">
              <div className="analytics-summary-label">Total calls (30 days)</div>
              <div className="analytics-summary-value">
                {overview.totalCalls.toLocaleString()}
              </div>
            </div>
            <div className="analytics-summary-card">
              <div className="analytics-summary-label">Average duration</div>
              <div className="analytics-summary-value">
                {formatDuration(overview.avgDurationSeconds)}
              </div>
            </div>
          </div>

          {/* Charts grid */}
          <div className="analytics-grid">
            {/* Outcomes bar chart */}
            <section className="analytics-card">
              <h2>Calls by outcome</h2>
              {outcomeData.length === 0 ? (
                <p className="analytics-sub">No outcome data available.</p>
              ) : (
                <div className="analytics-chart-container">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={outcomeData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="outcome" tick={{ fontSize: 10 }} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="count" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {/* Calls per day line chart */}
            <section className="analytics-card">
              <h2>Calls per day (last 30 days)</h2>
              {callsPerDayData.length === 0 ? (
                <p className="analytics-sub">No calls in this period.</p>
              ) : (
                <div className="analytics-chart-container">
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={callsPerDayData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="count"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {/* Calls per agent bar chart */}
            <section className="analytics-card analytics-card-span">
              <h2>Top agents by calls</h2>
              {agentData.length === 0 ? (
                <p className="analytics-sub">No agent data available.</p>
              ) : (
                <div className="analytics-chart-container">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart
                      data={[...agentData].sort(
                        (a, b) => (b.count || 0) - (a.count || 0)
                      )}
                      layout="vertical"
                      margin={{ left: 60, right: 16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="agent"
                        width={80}
                        tick={{ fontSize: 11 }}
                      />
                      <Tooltip />
                      <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "0s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function formatOutcome(outcome) {
  if (!outcome || outcome === "unknown") return "Unknown";
  return outcome
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}