import React, { useEffect, useMemo, useState } from "react";
import { ActivationScreen } from "./components/ActivationScreen.jsx";
import { ActivationStatus } from "./components/ActivationStatus.jsx";
import { AppShell } from "./components/AppShell.jsx";

const initialState = {
  phase: "booting",
  blockedReason: null,
  message: "Initializing",
  activation: null,
  installIdentity: null,
  controlPlaneReachable: true,
  lastHeartbeatAt: null,
};

export function ElectronApp() {
  const [state, setState] = useState(initialState);
  const [config, setConfig] = useState(null);

  useEffect(() => {
    let unsubscribe = null;

    async function boot() {
      const [initialLicenseState, cfg] = await Promise.all([
        window.electronAPI.license.getState(),
        window.electronAPI.getConfig(),
      ]);

      setState(initialLicenseState);
      setConfig(cfg);
      unsubscribe = window.electronAPI.license.onStateChanged((nextState) => {
        setState(nextState);
      });
    }

    boot();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const supportMessage = useMemo(() => {
    if (!state.blockedReason) {
      return null;
    }

    const byReason = {
      invalid_license_key: "The license key is invalid. Confirm the key and try again.",
      activation_limit_reached: "Activation limit reached. Ask support to reset an existing activation.",
      activation_revoked: "This activation has been revoked by your administrator.",
      tenant_commercially_suspended: "Commercial access is suspended for this tenant.",
      control_plane_unavailable: "The licensing service is currently unavailable.",
      restore_failed: "Activation could not be restored on this device.",
      blocked: "Access is blocked by current license state.",
    };

    return byReason[state.blockedReason] || "Activation is blocked. Contact Vynce support.";
  }, [state.blockedReason]);

  if (!config || state.phase === "booting" || state.phase === "restoring") {
    return <ActivationStatus title="Preparing Vynce Desktop" message={state.message || "Checking activation"} loading />;
  }

  if (state.phase === "activation_required" || state.phase === "activating") {
    return (
      <ActivationScreen
        state={state}
        onSubmit={(payload) => window.electronAPI.license.activate(payload)}
        onUpdateDeviceName={(name) => window.electronAPI.license.updateDeviceName(name)}
        supportMessage={supportMessage}
      />
    );
  }

  if (state.phase === "blocked") {
    return (
      <ActivationStatus
        title="Access Blocked"
        message={supportMessage || state.message}
        blocked
        onAction={
          state.blockedReason === "control_plane_unavailable"
            ? () => window.electronAPI.license.restore()
            : undefined
        }
        actionLabel={state.blockedReason === "control_plane_unavailable" ? "Retry" : undefined}
      />
    );
  }

  if (state.phase === "degraded") {
    return (
      <ActivationStatus
        title="Limited Connectivity"
        message="The control plane is currently unreachable. Calls remain gated until licensing reconnects."
        onAction={() => window.electronAPI.license.heartbeat()}
        actionLabel="Retry heartbeat"
      />
    );
  }

  return (
    <AppShell
      vynceAppUrl={config.vynceAppUrl}
      activation={state.activation}
      lastHeartbeatAt={state.lastHeartbeatAt}
      onCheckNow={() => window.electronAPI.license.heartbeat()}
      onDeactivate={() => window.electronAPI.license.deactivate()}
      onOpenSupport={() => window.electronAPI.openExternal("https://vynce.com/support")}
    />
  );
}
