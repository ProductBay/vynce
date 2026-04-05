const EventEmitter = require("events");
const { ensureInstallIdentity } = require("./installIdentity.cjs");

function createActivationManager({ config, userDataPath, storage, controlPlane }) {
  const events = new EventEmitter();
  let heartbeatTimer = null;

  let state = {
    phase: "booting",
    blockedReason: null,
    message: "Initializing",
    activation: null,
    installIdentity: null,
    lastHeartbeatAt: null,
    controlPlaneReachable: true,
  };

  function sanitizedState() {
    return {
      phase: state.phase,
      blockedReason: state.blockedReason,
      message: state.message,
      lastHeartbeatAt: state.lastHeartbeatAt,
      controlPlaneReachable: state.controlPlaneReachable,
      installIdentity: state.installIdentity,
      activation: state.activation
        ? {
            activationId: state.activation.activationId,
            tenantId: state.activation.tenantId,
            plan: state.activation.plan,
            commercialStatus: state.activation.commercialStatus,
            activationValid: state.activation.activationValid,
            deviceName: state.activation.deviceName,
            installId: state.activation.installId,
          }
        : null,
    };
  }

  function emitState() {
    events.emit("state", sanitizedState());
  }

  function updateState(patch) {
    state = { ...state, ...patch };
    emitState();
  }

  function saveState() {
    const payload = {
      installIdentity: state.installIdentity,
      activation: state.activation,
      lastHeartbeatAt: state.lastHeartbeatAt,
    };
    storage.writeState(userDataPath, payload);
  }

  function loadState() {
    const loaded = storage.readState(userDataPath);
    const installIdentity = ensureInstallIdentity(loaded.installIdentity);

    state.installIdentity = installIdentity;
    state.activation = loaded.activation || null;
    state.lastHeartbeatAt = loaded.lastHeartbeatAt || null;

    saveState();
  }

  function applyCommercialState(rawState) {
    const normalized = {
      tenantId: rawState?.tenantId || rawState?.state?.tenantId || null,
      activationId: rawState?.activation?.activationId || rawState?.activationId || null,
      activationToken: state.activation?.activationToken || null,
      commercialStatus: rawState?.commercialStatus || "unknown",
      activationValid: rawState?.activation?.status ? rawState.activation.status === "active" : rawState?.activationValid !== false,
      plan: rawState?.plan || null,
      installId: state.installIdentity.installId,
      deviceName: state.installIdentity.deviceName,
      deviceFingerprintInput: state.installIdentity.deviceFingerprintInput,
    };

    state.activation = {
      ...(state.activation || {}),
      ...normalized,
    };
  }

  function deriveBlockedReason(result) {
    if (!result) {
      return "control_plane_unavailable";
    }

    if (!result.ok) {
      return result.errorCode || "control_plane_error";
    }

    const status = result.data?.status;
    const commercialStatus = result.data?.state?.commercialStatus || result.data?.commercialStatus;

    if (status === "blocked") {
      return result.data?.state?.blockedReason || commercialStatus || "blocked";
    }

    if (commercialStatus === "revoked") {
      return "activation_revoked";
    }

    if (commercialStatus === "suspended") {
      return "tenant_commercially_suspended";
    }

    return null;
  }

  async function initialize() {
    try {
      loadState();
    } catch (error) {
      updateState({
        phase: "blocked",
        blockedReason: "secure_storage_unavailable",
        message: "Secure storage is unavailable on this device",
      });
      return sanitizedState();
    }

    if (!state.activation?.activationId || !state.activation?.activationToken) {
      updateState({ phase: "activation_required", blockedReason: null, message: "Activation required" });
      return sanitizedState();
    }

    return restore();
  }

  async function activate(input) {
    updateState({ phase: "activating", blockedReason: null, message: "Activating license" });

    const payload = {
      ...input,
      installId: state.installIdentity.installId,
      deviceName: input.deviceName || state.installIdentity.deviceName,
      deviceFingerprint: state.installIdentity.deviceFingerprintInput,
    };

    const result = await controlPlane.activate(payload);

    if (!result.ok) {
      updateState({
        phase: "activation_required",
        blockedReason: deriveBlockedReason(result),
        message: result.message || "Activation failed",
        controlPlaneReachable: result.statusCode !== 0,
      });
      return sanitizedState();
    }

    const data = result.data || {};
    const cpState = data.state || {};

    state.activation = {
      activationId: data.activationId || cpState?.activation?.activationId || null,
      activationToken: data.activationToken || null,
      tenantId: cpState.tenantId || null,
      plan: cpState.plan || null,
      commercialStatus: cpState.commercialStatus || "active",
      activationValid: true,
      installId: state.installIdentity.installId,
      deviceName: payload.deviceName,
      deviceFingerprintInput: state.installIdentity.deviceFingerprintInput,
    };

    saveState();
    updateState({
      phase: "active",
      blockedReason: null,
      message: "Activation complete",
      controlPlaneReachable: true,
    });

    startHeartbeat();
    return sanitizedState();
  }

  async function restore() {
    if (!state.activation?.activationId || !state.activation?.activationToken) {
      updateState({ phase: "activation_required", blockedReason: "restore_failed", message: "No activation to restore" });
      return sanitizedState();
    }

    updateState({ phase: "restoring", blockedReason: null, message: "Restoring activation" });

    const result = await controlPlane.restore({
      activationId: state.activation.activationId,
      installId: state.installIdentity.installId,
      deviceFingerprint: state.installIdentity.deviceFingerprintInput,
    });

    if (!result.ok) {
      updateState({
        phase: "activation_required",
        blockedReason: "restore_failed",
        message: result.message || "Restore failed",
        controlPlaneReachable: result.statusCode !== 0,
      });
      return sanitizedState();
    }

    const data = result.data || {};
    const cpState = data.state || {};

    state.activation.activationToken = data.activationToken || state.activation.activationToken;
    applyCommercialState(cpState);
    saveState();

    const blockedReason = deriveBlockedReason({ ok: true, data: { state: cpState } });

    if (blockedReason) {
      updateState({
        phase: "blocked",
        blockedReason,
        message: "Activation is blocked",
      });
      stopHeartbeat();
      return sanitizedState();
    }

    updateState({
      phase: "active",
      blockedReason: null,
      message: "Activation restored",
      controlPlaneReachable: true,
    });
    startHeartbeat();

    return sanitizedState();
  }

  async function heartbeat() {
    if (!state.activation?.activationToken) {
      return sanitizedState();
    }

    const result = await controlPlane.heartbeat({
      activationToken: state.activation.activationToken,
      installId: state.installIdentity.installId,
      deviceFingerprint: state.installIdentity.deviceFingerprintInput,
    });

    if (!result.ok) {
      updateState({
        controlPlaneReachable: false,
        phase: state.phase === "active" ? "degraded" : state.phase,
        blockedReason: state.phase === "active" ? "control_plane_unavailable" : state.blockedReason,
        message: "Control plane unavailable",
      });
      return sanitizedState();
    }

    const cpState = result.data?.state || {};
    applyCommercialState(cpState);
    state.lastHeartbeatAt = new Date().toISOString();
    saveState();

    const blockedReason = deriveBlockedReason(result);

    if (blockedReason) {
      updateState({
        phase: "blocked",
        blockedReason,
        message: "Access blocked by license state",
        controlPlaneReachable: true,
      });
      stopHeartbeat();
      return sanitizedState();
    }

    updateState({
      phase: "active",
      blockedReason: null,
      message: "Heartbeat OK",
      controlPlaneReachable: true,
    });

    return sanitizedState();
  }

  async function deactivate() {
    if (state.activation?.activationToken) {
      await controlPlane.deactivate({
        activationToken: state.activation.activationToken,
        installId: state.installIdentity.installId,
        deviceFingerprint: state.installIdentity.deviceFingerprintInput,
      });
    }

    state.activation = null;
    state.lastHeartbeatAt = null;
    saveState();
    stopHeartbeat();

    updateState({
      phase: "activation_required",
      blockedReason: null,
      message: "Activation cleared",
    });

    return sanitizedState();
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      heartbeat().catch(() => {
        updateState({
          phase: "degraded",
          blockedReason: "control_plane_unavailable",
          message: "Control plane unavailable",
          controlPlaneReachable: false,
        });
      });
    }, config.heartbeatMs);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function updateDeviceName(deviceName) {
    state.installIdentity = {
      ...state.installIdentity,
      deviceName,
    };

    saveState();
    emitState();

    return sanitizedState();
  }

  function getSafeActivationContext() {
    if (!state.activation) {
      return null;
    }

    return {
      activationId: state.activation.activationId,
      tenantId: state.activation.tenantId,
      plan: state.activation.plan,
      commercialStatus: state.activation.commercialStatus,
      installId: state.installIdentity?.installId || null,
      deviceName: state.installIdentity?.deviceName || null,
    };
  }

  function onState(callback) {
    events.on("state", callback);
    return () => events.removeListener("state", callback);
  }

  return {
    initialize,
    activate,
    restore,
    heartbeat,
    deactivate,
    updateDeviceName,
    onState,
    getState: sanitizedState,
    getSafeActivationContext,
    stopHeartbeat,
  };
}

module.exports = {
  createActivationManager,
};
