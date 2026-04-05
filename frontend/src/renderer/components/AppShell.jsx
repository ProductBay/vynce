import React from "react";

export function AppShell({
  vynceAppUrl,
  activation,
  lastHeartbeatAt,
  onCheckNow,
  onDeactivate,
  onOpenSupport,
}) {
  const shellUrl = `${vynceAppUrl}/?desktop=true&tenantId=${encodeURIComponent(
    activation?.tenantId || ""
  )}`;

  return (
    <div className="shell-root">
      <header className="shell-header">
        <div>
          <strong>Vynce Desktop</strong>
          <span className="meta">Tenant: {activation?.tenantId || "unknown"}</span>
          <span className="meta">Plan: {activation?.plan || "unknown"}</span>
        </div>
        <div className="actions">
          <button onClick={onCheckNow}>Heartbeat</button>
          <button onClick={onOpenSupport}>Support</button>
          <button className="danger" onClick={onDeactivate}>
            Deactivate
          </button>
        </div>
      </header>
      <div className="heartbeat-meta">
        Last heartbeat: {lastHeartbeatAt ? new Date(lastHeartbeatAt).toLocaleString() : "Never"}
      </div>
      <iframe title="Vynce App" src={shellUrl} className="app-frame" />
    </div>
  );
}
