// src/pages/Support.jsx
import React, { useState } from "react";
import "../styles/Support.css";
import API_BASE_URL from "../api";
import { useAuth } from "../components/AuthContext.jsx";

export default function Support() {
  const { user } = useAuth();

  const [form, setForm] = useState({
    name: user ? `${user.firstName || ""} ${user.lastName || ""}`.trim() : "",
    email: user?.email || "",
    subject: "",
    category: "general",
    priority: "normal",
    message: "",
  });

  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null); // { type: "success" | "error", message }

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus(null);

    if (!form.email || !form.message) {
      setStatus({
        type: "error",
        message: "Email and message are required.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/support-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }

      const data = await res.json();
      if (data.success) {
        setStatus({
          type: "success",
          message:
            "Your support request has been submitted. We’ll get back to you shortly.",
        });
        setForm((prev) => ({ ...prev, subject: "", message: "" }));
      } else {
        throw new Error(data.message || "Unknown error");
      }
    } catch (err) {
      console.error("Support ticket error:", err);
      setStatus({
        type: "error",
        message:
          "We couldn’t submit your request. Please try again or email support@vynce.ai.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="support-page">
      <header className="support-hero">
        <div>
          <h1>Support &amp; Documentation</h1>
          <p>
            Everything you need to launch and run your call center on Vynce:
            step‑by‑step guides, troubleshooting tips, and direct access to our
            support team.
          </p>
        </div>
        <div className="support-contact-cta">
          <a href="mailto:support@vynce.ai" className="support-btn-primary">
            Email Support
          </a>
          <a href="/tickets/new" className="support-btn-secondary">
            Request a Callback
          </a>
        </div>
      </header>

      {/* Optional: just a client-side filter for now */}
      <div className="support-search">
        <input
          type="text"
          placeholder='Search help articles (e.g. "upload CSV", "scripts")'
        />
      </div>

      {/* Existing documentation cards */}
      <section className="support-grid">
        <article id="getting-started" className="support-card">
          <h2>Getting Started with Vynce</h2>
          <p className="support-card-subtitle">
            New to Vynce? Start here to configure your account and place your
            first calls.
          </p>
          <ol>
            <li>Create your account and verify email.</li>
            <li>
              Set your caller ID and time zone in <strong>Settings</strong>.
            </li>
            <li>
              Use <strong>New Call</strong> to place a test call to your own
              number.
            </li>
            <li>Upload a small CSV to test a campaign (5–10 contacts).</li>
            <li>
              Review call outcomes on the <strong>Calls</strong> page.
            </li>
          </ol>
        </article>

        <article id="daily-operations" className="support-card">
          <h2>Running Daily Campaigns</h2>
          <p className="support-card-subtitle">
            For supervisors and agents running outbound campaigns.
          </p>
          <ul>
            <li>
              Use <strong>Upload CSV</strong> in the topbar to import lead
              lists.
            </li>
            <li>
              Verify <strong>phone</strong> columns are correct in the CSV
              preview before starting.
            </li>
            <li>
              Monitor active calls and statuses on the{" "}
              <strong>Calls</strong> page.
            </li>
            <li>
              Train agents to always select an <strong>Outcome</strong> and add
              notes after each call.
            </li>
            <li>
              Use scripts to keep messaging consistent across the team.
            </li>
          </ul>
        </article>

        <article id="scripts" className="support-card">
          <h2>Using Call Scripts</h2>
          <p className="support-card-subtitle">
            Keep agents on-message with shared, versioned scripts.
          </p>
          <ul>
            <li>
              Go to <strong>Scripts</strong> in the sidebar to create and
              manage scripts.
            </li>
            <li>
              Group scripts by campaign type (Sales, Collections, Support,
              etc.).
            </li>
            <li>
              During a call, click <strong>Show Scripts</strong> to open the
              script panel without leaving the dialer.
            </li>
            <li>
              Use <strong>Call Notes</strong> to record objections and update
              scripts over time.
            </li>
          </ul>
        </article>

        <article id="outcomes" className="support-card">
          <h2>Call Outcomes &amp; Follow‑Up</h2>
          <p className="support-card-subtitle">
            Standardize how your team tags calls so reporting stays clean.
          </p>
          <ul>
            <li>
              After each call, choose an <strong>Outcome</strong>: Interested,
              Not Interested, Callback, No Answer, etc.
            </li>
            <li>
              Use <strong>Callback Requested</strong> to flag leads that must be
              followed up by a specific date/time.
            </li>
            <li>
              Add short but concrete notes (e.g. “Asked for pricing email, call
              back Wed 3pm EST”).
            </li>
            <li>
              Supervisors can filter calls by outcome on the{" "}
              <strong>Calls</strong> page for coaching and QA.
            </li>
          </ul>
        </article>

        <article id="troubleshooting" className="support-card">
          <h2>Troubleshooting Calls</h2>
          <p className="support-card-subtitle">
            What to check when calls fail, don’t connect, or sound bad.
          </p>
          <ul>
            <li>
              Use <strong>Test Connection</strong> in the topbar to verify the
              backend is reachable.
            </li>
            <li>
              Make sure your browser has <strong>microphone permission</strong>{" "}
              granted.
            </li>
            <li>
              If calls show as <em>Failed</em> or <em>Busy</em>, verify the
              destination number format (+1, area code, number).
            </li>
            <li>
              If you see repeated failures, contact{" "}
              <a href="mailto:support@vynce.ai">support@vynce.ai</a> with the
              call UUID from the <strong>Calls</strong> page.
            </li>
          </ul>
        </article>

        <article id="billing" className="support-card">
          <h2>Billing &amp; Usage</h2>
          <p className="support-card-subtitle">
            Understand limits, invoices, and how to upgrade.
          </p>
          <ul>
            <li>
              The usage meter in the topbar shows{" "}
              <strong>used calls / plan limit</strong>.
            </li>
            <li>
              Go to <strong>Billing</strong> in the sidebar to see current
              plan, invoices, and payment methods.
            </li>
            <li>
              If you expect a spike in call volume, contact us to lift limits
              before your campaign.
            </li>
          </ul>
        </article>
      </section>

      {/* Support form at the bottom */}
      <section className="support-form-section">
        <h2>Contact Vynce Support</h2>
        <p>
          Can’t find what you’re looking for in the docs? Send us a message and
          our team will respond as soon as possible.
        </p>

        {status && (
          <div
            className={
              "support-alert " +
              (status.type === "success"
                ? "support-alert-success"
                : "support-alert-error")
            }
          >
            {status.message}
          </div>
        )}

        <form className="support-form" onSubmit={handleSubmit}>
          <div className="support-form-row">
            <div className="support-field">
              <label htmlFor="name">Name</label>
              <input
                id="name"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Your name"
              />
            </div>
            <div className="support-field">
              <label htmlFor="email">Email *</label>
              <input
                id="email"
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                placeholder="you@company.com"
                required
              />
            </div>
          </div>

          <div className="support-form-row">
            <div className="support-field">
              <label htmlFor="category">Category</label>
              <select
                id="category"
                name="category"
                value={form.category}
                onChange={handleChange}
              >
                <option value="general">General Question</option>
                <option value="technical">Technical Issue</option>
                <option value="billing">Billing</option>
                <option value="onboarding">Onboarding / Training</option>
              </select>
            </div>
            <div className="support-field">
              <label htmlFor="priority">Priority</label>
              <select
                id="priority"
                name="priority"
                value={form.priority}
                onChange={handleChange}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <div className="support-field">
            <label htmlFor="subject">Subject</label>
            <input
              id="subject"
              name="subject"
              value={form.subject}
              onChange={handleChange}
              placeholder="Short summary of your issue"
            />
          </div>

          <div className="support-field">
            <label htmlFor="message">Message *</label>
            <textarea
              id="message"
              name="message"
              value={form.message}
              onChange={handleChange}
              placeholder="Describe what you’re trying to do and what’s going wrong. Include call UUIDs, CSV filenames, browser, etc."
              rows={5}
              required
            />
          </div>

          <button
            type="submit"
            className="support-btn-primary support-form-submit"
            disabled={submitting}
          >
            {submitting ? "Sending..." : "Submit Support Request"}
          </button>
        </form>
      </section>
    </div>
  );
}