import { useEffect, useState } from "react";
import {
  fetchOnboardingStatus,
  submitOnboardingForReview,
} from "../api/onboarding";

const STEP_CONFIG = [
  {
    key: "companyInfo",
    label: "Company profile",
    description: "Confirm the business profile and caller settings are configured.",
    action: "/settings",
  },
  {
    key: "settingsConfigured",
    label: "Save call settings",
    description: "Save your caller ID, webhook URL, timezone, and related dialer settings.",
    action: "/settings",
  },
  {
    key: "vonageConnected",
    label: "Connect Vonage",
    description: "Verify your telephony credentials and application setup.",
    action: "/settings",
  },
  {
    key: "scriptUploaded",
    label: "Upload a script",
    description: "Add at least one usable script for your team.",
    action: "/scripts",
  },
  {
    key: "agentAdded",
    label: "Prepare users",
    description: "At least one tenant user must exist before go-live can be approved.",
    action: "/settings",
  },
  {
    key: "testCallCompleted",
    label: "Complete a test call",
    description: "Run a safe test call before requesting approval.",
    action: "/dashboard",
  },
];

function getReviewBadgeLabel(status) {
  switch (status) {
    case "pending_review":
      return "Pending Review";
    case "changes_requested":
      return "Changes Requested";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    default:
      return "Draft";
  }
}

export default function OnboardingChecklist({ authFetch }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        setError("");
        const nextData = await fetchOnboardingStatus(authFetch);
        if (mounted) setData(nextData);
      } catch (err) {
        if (mounted) setError(err.message || "Failed to load onboarding status");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [authFetch]);

  const steps = data?.steps || {};
  const review = data?.review || { status: "draft", requiredChanges: [] };
  const completion = data?.completion || { completed: 0, total: STEP_CONFIG.length, percent: 0 };
  const missingRequiredSteps = data?.missingRequiredSteps || [];
  const missingReviewBlockingSteps = data?.missingReviewBlockingSteps || [];
  const canSubmitForReview = Boolean(data?.canSubmitForReview);
  const vonageOnlyRemaining =
    missingRequiredSteps.length === 1 && missingRequiredSteps[0] === "vonageConnected";

  const canSubmit =
    canSubmitForReview &&
    review.status !== "pending_review" &&
    review.status !== "approved" &&
    !submitting;

  const handleSubmit = async () => {
    try {
      setSubmitting(true);
      setError("");
      setSuccess("");
      const nextData = await submitOnboardingForReview(authFetch);
      setData(nextData);
      setSuccess("Onboarding submitted for admin review.");
    } catch (err) {
      setError(err.message || "Failed to submit onboarding");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return null;
  if (!data) return null;

  return (
    <section className="onboarding-card">
      <div className="onboarding-header">
        <div>
          <h3>Go-Live Onboarding</h3>
          <p className="onboarding-subtitle">
            Finish setup, then submit your account for admin approval.
          </p>
        </div>

        <span className={`onboarding-status-badge ${review.status || "draft"}`}>
          {getReviewBadgeLabel(review.status)}
        </span>
      </div>

      <div className="onboarding-progress">
        <div className="onboarding-progress-top">
          <span>
            {completion.completed}/{completion.total} steps complete
          </span>
          <span>{completion.percent}%</span>
        </div>
        <div className="onboarding-progress-bar">
          <div
            className="onboarding-progress-fill"
            style={{ width: `${completion.percent}%` }}
          />
        </div>
      </div>

      {review.status === "changes_requested" && review.requiredChanges?.length ? (
        <div className="onboarding-message warning">
          <strong>Admin requested changes</strong>
          <ul className="onboarding-change-list">
            {review.requiredChanges.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {review.status === "approved" ? (
        <div className="onboarding-message success">
          <strong>Approved for go-live.</strong> Your tenant is ready for production-facing use.
        </div>
      ) : null}

      {review.status === "pending_review" ? (
        <div className="onboarding-message info">
          Your setup is with the admin team for review. You can still inspect the steps below.
        </div>
      ) : null}

      {vonageOnlyRemaining && review.status !== "approved" ? (
        <div className="onboarding-message info">
          You can submit for review now. Vonage is the last remaining go-live step and can be
          connected after admin approval.
        </div>
      ) : null}

      {missingReviewBlockingSteps.length > 0 && review.status !== "approved" ? (
        <div className="onboarding-message info">
          Complete the remaining required setup items in the linked pages, then submit for review.
        </div>
      ) : null}

      {error ? <div className="onboarding-message error">{error}</div> : null}
      {success ? <div className="onboarding-message success">{success}</div> : null}

      <div className="onboarding-step-list">
        {STEP_CONFIG.map((item) => {
          const done = Boolean(steps[item.key]);
          return (
            <div key={item.key} className={`onboarding-step ${done ? "done" : ""}`}>
              <div className="onboarding-step-main">
                <div>
                  <div className="onboarding-step-title">{item.label}</div>
                  <div className="onboarding-step-description">{item.description}</div>
                </div>
              </div>

              <div className="onboarding-step-actions">
                <span className={`onboarding-step-state ${done ? "done" : "pending"}`}>
                  {done ? "Done" : "Pending"}
                </span>
                <a href={item.action} className="setup-link">
                  Open
                </a>
              </div>
            </div>
          );
        })}
      </div>

      <div className="onboarding-actions">
        <button
          type="button"
          className="onboarding-submit-btn"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {submitting ? "Submitting..." : "Submit For Review"}
        </button>
      </div>
    </section>
  );
}
