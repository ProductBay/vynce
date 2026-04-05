import { getLicenseState } from "./licenseClient.js";
import LicenseSettings from "../models/LicenseSettings.js";

/**
 * Resolve tenant ID safely from request context
 */
function resolveTenantId(req) {
  if (req?.query?.tenantId) return String(req.query.tenantId);
  if (req?.headers?.["x-tenant-id"]) return String(req.headers["x-tenant-id"]);
  if (req?.user?.tenantId) return String(req.user.tenantId);
  if (req?.user?._id) return String(req.user._id); // DEV BACKSTOP
  return null;
}

/**
 * Enforce license validity
 * ✅ SaaS-first
 * ✅ Dev-safe
 * ✅ Offline-optional
 */
export async function enforceLicenseOrThrow(req, requiredFeature = null) {
  const tenantId = resolveTenantId(req);

  if (!tenantId) {
    throw new Error("Tenant not resolved");
  }

  // ─────────────────────────────────────────────
  // 1️⃣ SAAS / DEV LICENSE (DATABASE)
  // ─────────────────────────────────────────────
  let settings = await LicenseSettings.findOne({ tenantId });

  // Auto-create license if missing
  if (!settings) {
    settings = await LicenseSettings.create({
      tenantId,
      isEnabled: true,
      plan: "development",
      limits: {
        maxCallsPerDay: 999999,
      },
      client: {
        companyName: req.user?.companyName || "Dev Tenant",
        contactEmail: req.user?.email || "",
        tenantId,
        licenseId: `DEV-${Date.now()}`,
      },
    });

    console.log("🧪 License auto-created for tenant:", tenantId);
  }

  // ✅ Timed suspension check (MUST be after settings is initialized)
  if (
    settings.disabledUntil &&
    settings.disabledUntil instanceof Date &&
    settings.disabledUntil > new Date()
  ) {
    throw new Error(
      `License suspended until ${settings.disabledUntil.toISOString()}`
    );
  }

  // Hard disable check
  if (settings.isEnabled === false) {
    throw new Error("License disabled for this tenant");
  }

  // 🚨 If we are in dev / SaaS mode, STOP HERE.
  // Offline license MUST NOT block execution.
  if (settings.plan === "development") {
    return {
      mode: "development",
      plan: settings.plan,
      limits: settings.limits || {},
      features: {},
    };
  }

  // ─────────────────────────────────────────────
  // 2️⃣ OFFLINE / PACKAGED LICENSE (OPTIONAL)
  // ─────────────────────────────────────────────
  const state = await getLicenseState();

  // If no offline license, DO NOT BLOCK SaaS
  if (!state || !state.valid || !state.payload) {
    console.warn("⚠️ Offline license missing — allowing SaaS mode");
    return {
      mode: "saas",
      plan: settings.plan,
      limits: settings.limits || {},
      features: {},
    };
  }

  // Expiration check
  if (state.payload.exp && Date.now() / 1000 > state.payload.exp) {
    throw new Error("License expired");
  }

  // Feature gating (offline only)
  if (requiredFeature) {
    const enabled = state.payload.features?.[requiredFeature];
    if (!enabled) {
      throw new Error(`License feature disabled: ${requiredFeature}`);
    }
  }

  return state.payload;
}

/**
 * Enforce numeric limits (offline only)
 */
export async function enforceLimitsOrThrow({ activeChannels = 0, callsToday = 0 }) {
  const state = await getLicenseState();

  // Only enforce limits if offline license exists
  if (!state || !state.valid || !state.payload?.limits) {
    return true;
  }

  const limits = state.payload.limits;

  if (typeof limits.channels === "number" && activeChannels > limits.channels) {
    throw new Error(`Channel limit exceeded (${activeChannels}/${limits.channels})`);
  }

  if (typeof limits.maxCallsPerDay === "number" && callsToday > limits.maxCallsPerDay) {
    throw new Error(`Daily call limit exceeded (${callsToday}/${limits.maxCallsPerDay})`);
  }

  return true;
}