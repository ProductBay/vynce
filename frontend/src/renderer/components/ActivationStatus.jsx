import React from "react";

export function ActivationStatus({ title, message, loading, blocked, onAction, actionLabel }) {
  return (
    <div className="screen activation-status">
      <div className={`card ${blocked ? "blocked" : ""}`}>
        <h1>{title}</h1>
        <p className="muted">{message}</p>
        {loading && <div className="spinner" aria-label="Loading" />}
        {onAction && (
          <button className="primary" onClick={onAction}>
            {actionLabel || "Retry"}
          </button>
        )}
      </div>
    </div>
  );
}
