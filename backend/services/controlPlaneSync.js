import { controlPlaneClient } from "./controlPlaneClient.js";
import {
  readActivationContext,
  upsertActivationContext,
  touchActivationHeartbeat,
} from "./activationContextStore.js";

const CACHE_TTL_MS = 60 * 1000;
const DEGRADE_GRACE_MS = Math.max(0, Number(process.env.CONTROL_PLANE_GRACE_MS || 300000));
const commercialCache = new Map();

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowMs() {
  return Date.now();
}

function isCacheFresh(entry) {
  if (!entry) return false;
  return nowMs() - entry.cachedAt < CACHE_TTL_MS;
}

function getControlPlaneData(raw) {
  if (raw?.data && typeof raw.data === "object") {
    return raw.data;
  }

  if (raw && typeof raw === "object") {
    return raw;
  }

  return {};
}

function getCommercialStateSource(raw) {
  const data = getControlPlaneData(raw);

  if (data?.state && typeof data.state === "object") {
    return data.state;
  }

  return data;
}

function normalizeCommercialState(raw, tenantId) {
  const source = getCommercialStateSource(raw);
  const seatEntitlement = source?.seatEntitlement || {};
  const activation = source?.activation || {};
  const activationState = source?.status || raw?.data?.status || raw?.status || null;
  const commercialStatus = String(
    source?.commercialStatus || activationState || "inactive"
  ).toLowerCase();

  return {
    tenantId: source.tenantId || tenantId,
    licenseActive: Boolean(source.licenseActive),
    commercialStatus,
    activationValid:
      source.activationValid !== false && String(activation.status || "active").toLowerCase() !== "revoked",
    plan: String(source.plan || "professional"),
    includedUsers: toNumber(source.includedUsers ?? seatEntitlement.includedUsers, 1),
    extraSeats: toNumber(source.extraSeats ?? seatEntitlement.extraSeats, 0),
    maxActivations: toNumber(source.maxActivations, 1),
    activeActivations: toNumber(source.activeActivations ?? source.activationCount, 0),
    canProvisionUser: Boolean(
      source.canProvisionUser ?? seatEntitlement.canProvisionUser
    ),
    blockedReason: source.blockedReason || "",
    activationId: source.activationId || activation.activationId || null,
    installId: activation.installId || null,
    signedStatusToken: source.signedStatusToken || null,
    degraded: false,
    degradedReason: "",
    checkedAt: new Date().toISOString(),
  };
}

function buildUnavailableCommercialState(tenantId, reason, code = "CONTROL_PLANE_UNAVAILABLE") {
  return {
    tenantId,
    licenseActive: false,
    commercialStatus: "unavailable",
    activationValid: false,
    plan: "unknown",
    includedUsers: 0,
    extraSeats: 0,
    maxActivations: 0,
    activeActivations: 0,
    canProvisionUser: false,
    degraded: true,
    graceActive: false,
    degradedReason: reason || "Control plane unavailable",
    degradedCode: code,
    checkedAt: new Date().toISOString(),
  };
}

async function requestControlPlane(method, path, body = null) {
  const tenantId = body?.tenantId || null;
  const activationId = body?.activationId || null;

  return controlPlaneClient.request(method, path, {
    body: body || undefined,
    tenantId,
    activationId,
  });
}

async function fetchTenantLicenseSummary(tenantId) {
  const tid = String(tenantId || "default").trim() || "default";
  return requestControlPlane(
    "GET",
    `/api/admin/tenant-license?tenantId=${encodeURIComponent(tid)}`
  );
}

export async function fetchTenantCommercialStatus(tenantId, options = {}) {
  const tid = String(tenantId || "default").trim() || "default";

  const cached = commercialCache.get(tid);
  if (!options.forceRefresh && isCacheFresh(cached)) {
    return cached.value;
  }

  if (!controlPlaneClient.isConfigured()) {
    const degraded = buildUnavailableCommercialState(
      tid,
      "Control plane integration is not configured",
      "CONTROL_PLANE_NOT_CONFIGURED"
    );
    commercialCache.set(tid, { value: degraded, cachedAt: nowMs() });
    return degraded;
  }

  try {
    const response = await fetchTenantLicenseSummary(tid);

    const normalized = normalizeCommercialState(response, tid);
    normalized.graceActive = false;
    commercialCache.set(tid, { value: normalized, cachedAt: nowMs() });
    return normalized;
  } catch (err) {
    if (cached?.value && !cached.value.degraded && nowMs() - cached.cachedAt <= DEGRADE_GRACE_MS) {
      const staleGrace = {
        ...cached.value,
        degraded: true,
        graceActive: true,
        degradedReason: err?.message || "Control plane unavailable",
        degradedCode: err?.code || "CONTROL_PLANE_UNAVAILABLE",
        checkedAt: new Date().toISOString(),
      };
      commercialCache.set(tid, { value: staleGrace, cachedAt: nowMs() });
      return staleGrace;
    }

    const degraded = buildUnavailableCommercialState(
      tid,
      err?.message || "Control plane unavailable",
      err?.code || "CONTROL_PLANE_UNAVAILABLE"
    );
    commercialCache.set(tid, { value: degraded, cachedAt: nowMs() });
    return degraded;
  }
}

export async function fetchTenantSeatEntitlement(tenantId, options = {}) {
  const commercial = await fetchTenantCommercialStatus(tenantId, options);

  return {
    tenantId: commercial.tenantId,
    includedUsers: Number(commercial.includedUsers ?? 0),
    extraSeats: Number(commercial.extraSeats ?? 0),
    canProvisionUser: Boolean(commercial.canProvisionUser),
    plan: commercial.plan,
    degraded: Boolean(commercial.degraded),
    degradedReason: commercial.degradedReason || "",
    maxActivations: Number(commercial.maxActivations ?? 0),
    activeActivations: Number(commercial.activeActivations ?? 0),
  };
}

export function buildTenantAccessState({ commercial, operational }) {
  const commercialAllowed =
    !commercial?.degraded &&
    commercial?.licenseActive === true &&
    String(commercial?.commercialStatus || "").toLowerCase() === "active" &&
    commercial?.activationValid !== false;

  const operationalTenantActive =
    String(operational?.tenantOperationalStatus || "").toLowerCase() === "active";

  const onboardingApproved = Boolean(operational?.onboardingApproved);
  const telephonyVerified = Boolean(operational?.telephonyVerified);

  return {
    canLogin: commercialAllowed && operationalTenantActive,
    canSingleCall:
      commercialAllowed && operationalTenantActive && onboardingApproved && telephonyVerified,
    canBulkCall:
      commercialAllowed && operationalTenantActive && onboardingApproved && telephonyVerified,
    canProvisionUser:
      commercialAllowed && operationalTenantActive && Boolean(commercial?.canProvisionUser),
    commercialBlocked: !commercialAllowed,
    operationalBlocked: !operationalTenantActive,
    degraded: Boolean(commercial?.degraded),
  };
}

export async function assertCommercialAccessAllowed(tenantId, options = {}) {
  const commercial = await fetchTenantCommercialStatus(tenantId, options);

  if (commercial.degraded) {
    const err = new Error(commercial.degradedReason || "Control plane unavailable");
    err.statusCode = 503;
    err.code = commercial.degradedCode || "CONTROL_PLANE_UNAVAILABLE";
    throw err;
  }

  if (
    commercial.licenseActive !== true ||
    String(commercial.commercialStatus).toLowerCase() !== "active" ||
    commercial.activationValid === false
  ) {
    const err = new Error("Commercial access is not active for this tenant");
    err.statusCode = 403;
    err.code = "COMMERCIAL_ACCESS_BLOCKED";
    err.commercial = commercial;
    throw err;
  }

  return commercial;
}

export async function syncTenantLicenseState(tenantId, extraContext = {}) {
  if (!controlPlaneClient.isConfigured()) return { skipped: true, reason: "not_configured" };

  const tid = String(tenantId || "default").trim() || "default";
  const isEnabled = extraContext?.isEnabled !== false;
  const performedBy = extraContext?.performedBy || extraContext?.source || "vynce-backend";
  const reason =
    extraContext?.reason ||
    extraContext?.reasonText ||
    extraContext?.reasonCode ||
    extraContext?.source ||
    "sync_from_vynce";
  const issueBody = {
    tenantId: tid,
    plan: extraContext?.plan || "professional",
    maxActivations: toNumber(extraContext?.maxActivations, 1),
    includedUsers: toNumber(extraContext?.includedUsers, 1),
    extraSeats: toNumber(extraContext?.extraSeats, 0),
    performedBy,
    reason,
    source: extraContext?.source || "vynce-backend",
  };
  const revokeBody = {
    tenantId: tid,
    performedBy,
    reason,
    source: extraContext?.source || "vynce-backend",
  };

  try {
    let summary = null;
    let summaryFound = false;

    try {
      const summaryResponse = await fetchTenantLicenseSummary(tid);
      summary = normalizeCommercialState(summaryResponse, tid);
      summaryFound = true;
    } catch (summaryErr) {
      if (summaryErr?.statusCode === 404) {
        summaryFound = false;
      } else {
        throw summaryErr;
      }
    }

    if (isEnabled) {
      if (summaryFound && summary?.licenseActive === true) {
        return {
          success: true,
          skipped: true,
          reason: "already_active",
          tenantId: tid,
        };
      }

      await requestControlPlane("POST", "/api/admin/licenses/issue", issueBody);
      return { success: true, tenantId: tid, action: "issue" };
    }

    if (!summaryFound) {
      return {
        success: true,
        skipped: true,
        reason: "missing_license",
        tenantId: tid,
      };
    }

    const status = String(summary?.commercialStatus || "").toLowerCase();
    if (summary?.licenseActive !== true || status === "revoked") {
      return {
        success: true,
        skipped: true,
        reason: "already_revoked",
        tenantId: tid,
      };
    }

    await requestControlPlane("POST", "/api/admin/licenses/revoke", revokeBody);
    return { success: true, tenantId: tid, action: "revoke" };
  } catch (err) {
    return { success: false, code: err?.code || "CONTROL_PLANE_SYNC_FAILED", message: err?.message };
  }
}

export async function syncTenantActivationState(tenantId, activationContext = {}) {
  if (!controlPlaneClient.isConfigured()) return { skipped: true, reason: "not_configured" };

  const tid = String(tenantId || "default").trim() || "default";
  const action = String(activationContext?.action || "").trim().toLowerCase();
  let activationId =
    activationContext?.activationId || activationContext?.id || activationContext?.targetActivationId || null;
  const performedBy = activationContext?.performedBy || activationContext?.source || "vynce-backend";
  const reason =
    activationContext?.reason ||
    activationContext?.reasonText ||
    activationContext?.reasonCode ||
    activationContext?.source ||
    "activation_sync_from_vynce";

  if (!action) {
    return { skipped: true, reason: "missing_action" };
  }

  if (!activationId) {
    let storedActivation = null;
    try {
      storedActivation = await readActivationContext({
        tenantId: tid,
        installId: activationContext?.installId,
        deviceFingerprint: activationContext?.deviceFingerprint,
      });
    } catch {
      storedActivation = null;
    }

    if (storedActivation?.activationId) {
      activationId = storedActivation.activationId;
    }
  }

  if (activationContext?.activationId || activationContext?.activationToken || activationContext?.installId) {
    try {
      await upsertActivationContext({
        tenantId: tid,
        activationId: activationContext?.activationId || activationId || null,
        activationToken: activationContext?.activationToken || null,
        installId: activationContext?.installId || null,
        deviceFingerprint: activationContext?.deviceFingerprint || null,
        lastHeartbeatAt: activationContext?.lastHeartbeatAt || null,
      });
    } catch {
      // Persistence is best-effort and must not block control-plane sync.
    }
  }

  const sharedPayload = {
    ...activationContext,
    tenantId: tid,
    performedBy,
    reason,
    action,
  };

  try {
    if (["revoke", "suspend", "temporary_suspend"].includes(action)) {
      if (activationId) {
        await requestControlPlane("POST", "/api/admin/activations/revoke", {
          ...sharedPayload,
          activationId,
        });
        return { success: true, action: "revoke", tenantId: tid, activationId };
      }

      console.warn(
        JSON.stringify({
          event: "control_plane_action_unmapped",
          action: "activations_revoke",
          tenantId: tid,
          activationId: null,
          reason: "missing_activation_id",
        })
      );

      await requestControlPlane("POST", "/api/admin/licenses/revoke", {
        tenantId: tid,
        performedBy,
        reason,
        source: activationContext?.source || "vynce-backend",
      });
      return { success: true, action: "tenant_revoke_fallback", tenantId: tid, skippedActivation: true };
    } else if (["reset", "reset_activations"].includes(action)) {
      if (activationId) {
        await requestControlPlane("POST", "/api/admin/activations/reset", {
          ...sharedPayload,
          activationId,
        });
        try {
          await touchActivationHeartbeat({
            tenantId: tid,
            activationId,
            lastHeartbeatAt: new Date().toISOString(),
          });
        } catch {
          // Heartbeat persistence is best-effort.
        }
        return { success: true, action: "reset", tenantId: tid, activationId };
      }

      console.warn(
        JSON.stringify({
          event: "control_plane_action_unmapped",
          action: "activations_reset",
          tenantId: tid,
          activationId: null,
          reason: "missing_activation_id",
        })
      );

      await requestControlPlane("POST", "/api/admin/licenses/reset", {
        tenantId: tid,
        performedBy,
        reason,
        source: activationContext?.source || "vynce-backend",
      });
      return { success: true, action: "tenant_reset_fallback", tenantId: tid, skippedActivation: true };
    } else {
      return { skipped: true, reason: "unsupported_action", action };
    }
  } catch (err) {
    return { success: false, code: err?.code || "CONTROL_PLANE_SYNC_FAILED", message: err?.message };
  }
}

export async function syncTenantSeatEntitlement(tenantId, seatContext = {}) {
  if (!controlPlaneClient.isConfigured()) return { skipped: true, reason: "not_configured" };

  const tid = String(tenantId || "default").trim() || "default";
  const extraSeats = toNumber(seatContext?.extraSeats, null);

  if (extraSeats === null) {
    return { skipped: true, reason: "missing_extra_seats" };
  }

  try {
    await requestControlPlane("POST", "/api/admin/seats/grant", {
      tenantId: tid,
      extraSeats,
      additionalSeatPrice: toNumber(seatContext?.additionalSeatPrice, 0),
      performedBy: seatContext?.performedBy || seatContext?.source || "vynce-backend",
      reason:
        seatContext?.reason ||
        seatContext?.reasonText ||
        seatContext?.source ||
        "seat_sync_from_vynce",
      source: seatContext?.source || "vynce-backend",
    });

    return { success: true };
  } catch (err) {
    return { success: false, code: err?.code || "CONTROL_PLANE_SYNC_FAILED", message: err?.message };
  }
}

export async function issueTenantLicenseKey(tenantId, issueContext = {}) {
  if (!controlPlaneClient.isConfigured()) {
    return {
      success: false,
      statusCode: 503,
      code: "CONTROL_PLANE_NOT_CONFIGURED",
      message: "Control plane is not configured",
    };
  }

  const tid = String(tenantId || "default").trim() || "default";
  const body = {
    tenantId: tid,
    plan: String(issueContext?.plan || "professional").trim() || "professional",
    maxActivations: toNumber(issueContext?.maxActivations, 1),
    includedUsers: toNumber(issueContext?.includedUsers, 1),
    extraSeats: toNumber(issueContext?.extraSeats, 0),
    performedBy: issueContext?.performedBy || issueContext?.source || "vynce-backend",
    reason:
      issueContext?.reason ||
      issueContext?.reasonText ||
      issueContext?.source ||
      "issued_from_vynce_admin",
    source: issueContext?.source || "vynce-admin-license",
  };

  if (issueContext?.expiresAt) {
    body.expiresAt = issueContext.expiresAt;
  }

  try {
    const response = await requestControlPlane("POST", "/api/admin/licenses/issue", body);
    const data = getControlPlaneData(response);

    return {
      success: true,
      statusCode: 200,
      tenantId: data?.tenantId || tid,
      licenseId: data?.licenseId || null,
      licenseKey: data?.licenseKey || "",
      state: data?.state || null,
    };
  } catch (err) {
    return {
      success: false,
      statusCode: err?.statusCode || 500,
      code: err?.code || "CONTROL_PLANE_SYNC_FAILED",
      message: err?.message || "Failed to issue license key",
    };
  }
}
