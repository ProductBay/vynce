
// backend/dialer.js
import "dotenv/config";
import fs from "fs";
import http from "http";
import path from 'path';
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import multer from "multer";
import csv from "csv-parser";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import cookieParser from "cookie-parser";
import { Server } from "socket.io";
import { Vonage } from "@vonage/server-sdk";
import { v4 as uuidv4 } from "uuid";
import fetch from 'node-fetch';

// Local Imports
import { startLicenseManager } from "./license/licenseClient.js";
import { enforceLicenseOrThrow } from "./license/licenseGuard.js";
import User from "./models/User.js";
import Settings from "./models/Settings.js";
import Call from "./models/Call.js";
import VoicemailMessage from "./models/VoicemailMessage.js";
import VonageWebhookAudit from "./models/VonageWebhookAudit.js";
import plans, {
  getAdditionalActiveUserPrice,
  getIncludedActiveUsers,
  getPlanDefinition,
  normalizePlanKey,
} from "./config/plans.js";
import Subscription from "./models/Subscription.js";
import OnboardingStatus from "./models/OnboardingStatus.js";
import OnboardingReview from "./models/OnboardingReview.js";
import TelephonySettings from "./models/TelephonySettings.js";
import SupportConversation from "./models/SupportConversation.js";
import SupportMessage from "./models/SupportMessage.js";
import {
  assertCommercialAccessAllowed,
  buildTenantAccessState,
  fetchTenantCommercialStatus,
  fetchTenantSeatEntitlement,
  issueTenantLicenseKey,
  syncTenantActivationState,
  syncTenantLicenseState,
  syncTenantSeatEntitlement,
} from "./services/controlPlaneSync.js";
import {
  getLicenseSourceMode,
  shouldStartLegacyLicenseManager,
} from "./services/licenseSource.js";

// ===============================
// OFFLINE EDITION SWITCH
// ===============================
const OFFLINE_MODE = (process.env.OFFLINE_MODE || "false").toLowerCase() === "true";
const VONAGE_WEBHOOK_AUDIT_ENABLED =
  (process.env.VONAGE_WEBHOOK_AUDIT || "false").toLowerCase() === "true";
if (OFFLINE_MODE) {
  logDebug("🔒 OFFLINE MODE IS ACTIVE");
}

// =========================================================
// 📞 UNIVERSAL CALL INITIATION (DEFINED ONCE, AT THE TOP)
// =========================================================
async function initiateCall(toNumber, metadata = {}) {
  const { callId, tenantId } = metadata;

  if (!callId) throw new Error("initiateCall requires a callId in metadata");
  if (!publicWebhookUrl) throw new Error("PUBLIC_WEBHOOK_URL is not set.");

  // Load per-tenant Vonage client and outbound number.
  // Falls back to global singleton + global callerId when no per-tenant creds.
  const { vonageInstance, fromNumber: tenantFromNumber } =
    await buildVonageClientForTenant(tenantId || null);

  // ✅ NORMALIZE NUMBER HERE (CRITICAL)
  let formatted = String(toNumber || "").trim();

// keep digits
let digits = formatted.replace(/\D/g, "");
if (!digits) throw new Error("Invalid target phone number");

// convert to E.164
if (digits.length === 10) digits = "1" + digits;       // assume US
if (digits.length === 11 && digits.startsWith("1")) {
  formatted = `+${digits}`;
} else if (formatted.startsWith("+")) {
  // if user already gave +country..., normalize to +digits
  formatted = `+${digits}`;
} else {
  formatted = `+${digits}`;
}

  const fromNumber = tenantFromNumber || callerId;
  if (!fromNumber) {
    throw new Error(
      "No outbound number available. Set a Caller ID in Settings or enter your Vonage " +
      "credentials and verify them in Settings → Telephony."
    );
  }

  const normalizedTenantId = String(tenantId || "").trim();
  const callbackContext = createVonageWebhookContextToken({
    tenantId: normalizedTenantId,
    callId,
    target: formatted,
  });
  const callbackQuery = new URLSearchParams({
    callId: String(callId),
    target: formatted,
  });
  if (normalizedTenantId) {
    callbackQuery.set("tenantId", normalizedTenantId);
  }
  if (callbackContext) {
    callbackQuery.set("ctx", callbackContext);
  }

  const eventQuery = new URLSearchParams({
    callId: String(callId),
  });
  if (normalizedTenantId) {
    eventQuery.set("tenantId", normalizedTenantId);
  }
  if (callbackContext) {
    eventQuery.set("ctx", callbackContext);
  }

  const payload = {
    to: [{ type: "phone", number: formatted }],
    from: { type: "phone", number: fromNumber },

    answer_url: [
      `${publicWebhookUrl}/api/voice?${callbackQuery.toString()}`
    ],

    event_url: [
      `${publicWebhookUrl}/api/status?${eventQuery.toString()}`
    ],

    event_method: "POST",
    machine_detection: {
      behavior: "continue",
      mode: "default",
      beep_timeout: 45,
    },
  };

  try {
    logVonageDebug("📤 Sending to Vonage API:");
    logVonageDebug("   To:", formatted, "| From:", fromNumber);
    logVonageDebug("   Answer URL:", payload.answer_url[0]);

    const call = await vonageInstance.voice.createOutboundCall(payload);

    logVonageDebug(`✅ Vonage call created successfully. UUID: ${call.uuid}`);
    return { uuid: call.uuid, data: call };

  } catch (err) {
    console.error("❌ Vonage API call failed!");
    console.error("   Error Message:", err.message);
    if (err.body) {
      console.error(
        "   Vonage Error Body:",
        JSON.stringify(err.body, null, 2)
      );
    }
    throw err;
  }
}


// 📍 END OF LANDMARK 1
// =========================================================
// LICENSE SETTINGS (TENANT-AWARE)
// =========================================================

// ✅ Tenant-aware settings doc (ONE per tenant)
const LicenseSettingsSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      default: "default",
    },

    isEnabled: {
      type: Boolean,
      default: true,
    },

    suspendReason: {
      type: String,
      default: "",
    },

    suspendReasonCode: {
      type: String,
      default: "",
    },

    suspendReasonText: {
      type: String,
      default: "",
    },

    plan: {
      type: String,
      default: "professional",
    },

    callingMode: {
      type: String,
      enum: ["offline", "live"],
      default: "live",
    },

    limits: {
      maxCallsPerDay: {
        type: Number,
        default: 5000,
      },
    },

    // Client identity (admin-facing)
    client: {
      companyName: {
        type: String,
        default: "Unknown",
      },
      contactEmail: {
        type: String,
        default: "",
      },
      tenantId: {
        type: String,
        default: "",
      },
      licenseId: {
        type: String,
        default: "",
      },
    },

    // Reserved for future timed suspensions
    disabledUntil: {
      type: Date,
      default: null,
    },

    updatedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      email: { type: String, default: "" },
      role: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

// ✅ SINGLE unique index (fixes mongoose warning)
LicenseSettingsSchema.index({ tenantId: 1 }, { unique: true });

const LicenseSettings =
  mongoose.models.LicenseSettings ||
  mongoose.model("LicenseSettings", LicenseSettingsSchema);

const TENANT_SUSPEND_REASON_CODES = new Set([
  "non_payment",
  "abuse",
  "manual_review",
  "compliance",
  "other",
]);

function normalizeSuspendReasonCode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  return TENANT_SUSPEND_REASON_CODES.has(normalized) ? normalized : "";
}

function getTenantLicenseStatus(settings) {
  if (!settings?.isEnabled) {
    if (settings.disabledUntil && new Date(settings.disabledUntil).getTime() > Date.now()) {
      return "temporarily_suspended";
    }

    return "suspended";
  }

  return "active";
}

function getOnboardingOverrideState(settings) {
  const enabled = settings?.onboardingOverride?.enabled === true;
  const expiresAtRaw = settings?.onboardingOverride?.expiresAt || null;
  const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
  const active =
    enabled &&
    (!expiresAt || (Number.isFinite(expiresAt.getTime()) && expiresAt.getTime() > Date.now()));

  return {
    active,
    enabled,
    reason: String(settings?.onboardingOverride?.reason || "").trim(),
    enabledAt: settings?.onboardingOverride?.enabledAt || null,
    expiresAt: expiresAtRaw || null,
    enabledBy: settings?.onboardingOverride?.enabledBy || null,
  };
}

async function ensureTenantSuspensionState(settings) {
  if (!settings) return settings;

  let changed = false;

  if (
    settings.isEnabled === false &&
    settings.disabledUntil &&
    new Date(settings.disabledUntil).getTime() <= Date.now()
  ) {
    settings.isEnabled = true;
    settings.disabledUntil = null;
    settings.suspendReason = "";
    settings.suspendReasonCode = "";
    settings.suspendReasonText = "";
    changed = true;
  }

  const overrideEnabled = settings?.onboardingOverride?.enabled === true;
  const overrideExpiresAt = settings?.onboardingOverride?.expiresAt
    ? new Date(settings.onboardingOverride.expiresAt)
    : null;
  if (
    overrideEnabled &&
    overrideExpiresAt &&
    Number.isFinite(overrideExpiresAt.getTime()) &&
    overrideExpiresAt.getTime() <= Date.now()
  ) {
    settings.onboardingOverride.enabled = false;
    changed = true;
  }

  if (changed) {
    await settings.save();
  }

  return settings;
}

function getTenantCallingModeState(settings) {
  const requested =
    String(settings?.callingMode || (OFFLINE_MODE ? "offline" : "live"))
      .trim()
      .toLowerCase() === "live"
      ? "live"
      : "offline";

  const liveAvailable = !OFFLINE_MODE && !!vonage && !!publicWebhookUrl;
  const effective = requested === "live" && liveAvailable ? "live" : "offline";

  return {
    requested,
    effective,
    liveAvailable,
    reason:
      requested === "live" && !liveAvailable
        ? "Live provider calling is not available on this server right now."
        : null,
  };
}

function buildTenantLicenseResponse(settings) {
  const status = getTenantLicenseStatus(settings);
  const mode = getTenantCallingModeState(settings);
  const onboardingOverride = getOnboardingOverrideState(settings);

  return {
    tenantId: settings.tenantId,
    companyName: settings.client?.companyName || "Unknown",
    isEnabled: settings.isEnabled,
    status,
    suspendReason: settings.suspendReason || "",
    reasonCode: settings.suspendReasonCode || "",
    reasonText: settings.suspendReasonText || "",
    disabledUntil: settings.disabledUntil || null,
    plan: settings.plan,
    mode,
    onboardingOverride,
    limits: settings.limits || {},
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy || null,
    licenseIdentity: {
      company: settings.client?.companyName || "Unknown",
      tenantId: settings.client?.tenantId || settings.tenantId,
      licenseId: settings.client?.licenseId || `vynce-${settings.tenantId}`,
      plan: settings.plan,
    },
  };
}




// =========================================================
// TENANT RESOLUTION
// =========================================================
function resolveTenantId(req) {
  // 1️⃣ Explicit admin selection
  if (req.query?.tenantId) {
    return String(req.query.tenantId).trim();
  }

  // 2️⃣ Header-based (future SaaS support)
  if (req.headers["x-tenant-id"]) {
    return String(req.headers["x-tenant-id"]).trim();
  }

  // 3️⃣ Authenticated user
  if (req.user?.tenantId) {
    return String(req.user.tenantId).trim();
  }

  // 4️⃣ Safe fallback
  return "default";
}

// =========================================================
// GET OR CREATE LICENSE SETTINGS (TENANT-SAFE)
// =========================================================
async function getOrCreateLicenseSettings(tenantId = "default") {
  const tid = String(tenantId || "default").trim() || "default";

  let doc = await LicenseSettings.findOne({ tenantId: tid });

  if (!doc) {
    // ✅ First-time tenant bootstrap
    doc = await LicenseSettings.create({
      tenantId: tid,
      plan: "professional",
      callingMode: OFFLINE_MODE ? "offline" : "live",
      isEnabled: true,
      limits: { maxCallsPerDay: 5000 },
      client: {
        companyName: "Unknown",
        contactEmail: "",
        tenantId: tid,
        licenseId: `vynce-${tid}`,
      },
    });

    return doc;
  }

  // 🔁 Keep client identity in sync (only save if needed)
  let changed = false;

  if (!doc.client) {
    doc.client = {};
    changed = true;
  }

  if (!doc.client.tenantId) {
    doc.client.tenantId = tid;
    changed = true;
  }

  if (!doc.client.licenseId) {
    doc.client.licenseId = `vynce-${tid}`;
    changed = true;
  }

  if (changed) {
    await doc.save();
  }

  return doc;
}

async function getExistingLicenseSettingsOrThrow(tenantId) {
  const tid = String(tenantId || "").trim();

  if (!tid) {
    const err = new Error("tenantId is required");
    err.statusCode = 400;
    err.code = "TENANT_ID_REQUIRED";
    throw err;
  }

  const settings = await LicenseSettings.findOne({ tenantId: tid });
  if (!settings) {
    const err = new Error("Tenant not found");
    err.statusCode = 404;
    err.code = "TENANT_NOT_FOUND";
    throw err;
  }

  return settings;
}

async function rollbackFailedAdminTenantProvisioning(tenantId) {
  const tid = String(tenantId || "").trim();
  if (!tid) return;

  await Promise.all([
    LicenseSettings.deleteOne({ tenantId: tid }),
    OnboardingStatus.deleteOne({ tenantId: tid }),
    OnboardingReview.deleteOne({ tenantId: tid }),
    LicenseAuditLog.deleteMany({ "target.tenantId": tid }),
  ]);
}

/* =========================================================
   SUBSCRIPTION (GET OR CREATE — TENANT SAFE)
========================================================= */
/* =========================================================
   SUBSCRIPTION (GET OR CREATE — TENANT SAFE)
========================================================= */
/* =========================================================
   SUBSCRIPTION (GET OR CREATE — USER + TENANT SAFE)
========================================================= */
async function getOrCreateSubscription(
  tenantId,
  userId,
  fallbackPlan = "professional"
) {
  // 1️⃣ PRIMARY: userId (unique)
  let sub = await Subscription.findOne({ userId });

  if (sub) return sub;

  // 2️⃣ SECONDARY: tenantId (legacy safety)
  sub = await Subscription.findOne({ tenantId });

  if (sub) return sub;

  // 3️⃣ CREATE (ONLY IF NONE FOUND)
  const plan = getPlanDefinition(fallbackPlan);

  sub = await Subscription.create({
    tenantId,
    userId,
    plan: plan.key,
    usage: {
      callsThisMonth: 0,
    },
    limits: {
      maxCalls: 0,
      includedActiveUsers: getIncludedActiveUsers(plan.key),
    },
    billing: {
      unlimitedCalls: true,
      monthlyPrice: Number(plan.billing?.monthlyPrice ?? 0),
      additionalAgentSeats: 0,
      additionalActiveUserPrice: getAdditionalActiveUserPrice(plan.key),
    },
    createdAt: new Date(),
  });

  logDebug(
    `🆕 Subscription auto-created for user ${userId} (tenant ${tenantId})`
  );

  return sub;
}

function buildUserSubscription(planValue = "professional", overrides = {}) {
  const plan = getPlanDefinition(planValue);
  const includedActiveUsers = getIncludedActiveUsers(plan.key);
  const additionalAgentSeats = Math.max(
    0,
    Number(overrides.additionalAgentSeats ?? 0)
  );
  const unlimitedCalls = plan.billing?.unlimitedCalls !== false;

  return {
    plan: plan.key,
    maxCalls: unlimitedCalls ? 0 : Number(plan.limits?.monthlyCallAttempts ?? 0),
    unlimitedCalls,
    includedActiveUsers,
    additionalAgentSeats,
    additionalAgentPrice: getAdditionalActiveUserPrice(plan.key),
    monthlyPrice: Number(plan.billing?.monthlyPrice ?? 0),
    active: overrides.active ?? true,
    expiresAt: overrides.expiresAt ?? null,
    status: overrides.status || "active",
  };
}

function buildTenantSubscriptionPatch(planValue = "professional", additionalAgentSeats = 0) {
  const snapshot = buildUserSubscription(planValue, { additionalAgentSeats });

  return {
    "subscription.plan": snapshot.plan,
    "subscription.maxCalls": snapshot.maxCalls,
    "subscription.unlimitedCalls": snapshot.unlimitedCalls,
    "subscription.includedActiveUsers": snapshot.includedActiveUsers,
    "subscription.additionalAgentSeats": snapshot.additionalAgentSeats,
    "subscription.additionalAgentPrice": snapshot.additionalAgentPrice,
    "subscription.monthlyPrice": snapshot.monthlyPrice,
  };
}

async function syncTenantUserSubscriptions(tenantId, planValue, additionalAgentSeats = 0) {
  const patch = buildTenantSubscriptionPatch(planValue, additionalAgentSeats);
  await User.updateMany({ tenantId }, { $set: patch });
}

async function getTenantSeatSnapshot(tenantId) {
  const tid = String(tenantId || "default").trim() || "default";
  const [tenantUsers, settings] = await Promise.all([
    User.find({ tenantId: tid })
      .select("firstName lastName email role isDisabled createdAt subscription tenantId")
      .sort({ createdAt: 1 })
      .lean(),
    getOrCreateLicenseSettings(tid),
  ]);

  const primaryUser = tenantUsers[0] || null;
  const planKey = normalizePlanKey(
    settings?.plan || primaryUser?.subscription?.plan || "professional"
  );
  let includedActiveUsers =
    Number(primaryUser?.subscription?.includedActiveUsers) || getIncludedActiveUsers(planKey);
  let additionalAgentSeats = Math.max(
    0,
    Number(primaryUser?.subscription?.additionalAgentSeats ?? 0)
  );
  let canProvisionUserFromCommercial = null;
  let commercial = null;

  try {
    const entitlement = await fetchTenantSeatEntitlement(tid);
    commercial = await fetchTenantCommercialStatus(tid);

    if (Number.isFinite(entitlement?.includedUsers) && entitlement.includedUsers >= 0) {
      includedActiveUsers = Number(entitlement.includedUsers);
    }

    if (Number.isFinite(entitlement?.extraSeats) && entitlement.extraSeats >= 0) {
      additionalAgentSeats = Number(entitlement.extraSeats);
    }

    if (typeof entitlement?.canProvisionUser === "boolean") {
      canProvisionUserFromCommercial = entitlement.canProvisionUser;
    }
  } catch (err) {
    logWarnDebug("Seat entitlement sync failed:", err?.message || err);
  }

  const totalSeats = Number.isFinite(includedActiveUsers)
    ? includedActiveUsers + additionalAgentSeats
    : Infinity;
  const activeUsers = tenantUsers.filter((item) => !item.isDisabled);
  const localSeatCapacityOpen =
    !Number.isFinite(totalSeats) || activeUsers.length < totalSeats;
  const canAddUser =
    typeof canProvisionUserFromCommercial === "boolean"
      ? canProvisionUserFromCommercial && localSeatCapacityOpen
      : localSeatCapacityOpen;

  return {
    tenantId: tid,
    plan: planKey,
    companyName: settings?.client?.companyName || primaryUser?.company || "Unknown",
    includedActiveUsers,
    additionalAgentSeats,
    totalSeats,
    activeUserCount: activeUsers.length,
    availableSeats: Number.isFinite(totalSeats)
      ? Math.max(totalSeats - activeUsers.length, 0)
      : Infinity,
    canProvisionUser:
      typeof canProvisionUserFromCommercial === "boolean"
        ? canProvisionUserFromCommercial
        : canAddUser,
    commercial,
    additionalAgentPrice: getAdditionalActiveUserPrice(planKey),
    users: tenantUsers.map((item) => ({
      id: item._id?.toString?.() || item.id || "",
      email: item.email,
      firstName: item.firstName,
      lastName: item.lastName,
      role: item.role,
      isDisabled: !!item.isDisabled,
      createdAt: item.createdAt || null,
    })),
    canAddUser,
  };
}

function emitCallDocumentUpdate(callDocLike) {
  io.emit("callUpdate", callDocLike);
}

function scheduleTenantOfflineCallLifecycle(callDoc) {
  const callId = callDoc?._id?.toString?.() || callDoc?._id;
  if (!callId) return;

  setTimeout(async () => {
    try {
      const initiated = await Call.findByIdAndUpdate(
        callId,
        {
          $set: {
            uuid: callDoc.uuid || `offline-${callId}`,
            status: "initiated",
            updatedAt: new Date(),
          },
        },
        { new: true }
      ).lean();

      if (initiated) emitCallDocumentUpdate(initiated);
    } catch {}
  }, 250);

  setTimeout(async () => {
    try {
      const answered = await Call.findByIdAndUpdate(
        callId,
        {
          $set: {
            uuid: callDoc.uuid || `offline-${callId}`,
            status: "answered",
            answeredAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { new: true }
      ).lean();

      if (answered) emitCallDocumentUpdate(answered);
    } catch {}
  }, 1200);
}



/* =========================================================
   LICENSE STATE
========================================================= */
global.currentLicensePayload = null;
global.lastLicenseHeartbeat = null;
global.callsUsed = 0;

/* =========================================================
   STATE (IN-MEMORY)
========================================================= */
let isBulkCampaignActive = false;
let isBulkCallRunning = false;
let allCalls = [];
let callNotes = [];
let bulkPaused = false;
let bulkStopped = false;
let bulkCallQueue = [];
/* =========================================================
   ACTIVE CALL COUNTER (GLOBAL)
========================================================= */
let activeCalls = 0;


/* =========================================================
   ENV / CONSTANTS
========================================================= */



/* -------------------------
   Core Runtime Config
-------------------------- */
const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const LICENSE_SOURCE = getLicenseSourceMode(process.env);
const USE_CONTROL_PLANE_SOURCE = LICENSE_SOURCE === "control_plane";
let publicWebhookUrl =
  process.env.PUBLIC_WEBHOOK_URL || `http://localhost:${PORT}`;
const CONTROL_PLANE_BASE_URL = String(process.env.CONTROL_PLANE_BASE_URL || "").trim();
const CONTROL_PLANE_API_SECRET = String(process.env.CONTROL_PLANE_API_SECRET || "").trim();
const CONTROL_PLANE_TIMEOUT_MS = Number(process.env.CONTROL_PLANE_TIMEOUT_MS || 8000);
const VONAGE_API_SIGNATURE_SECRET =
  process.env.VONAGE_API_SIGNATURE_SECRET || "";
const WEBHOOK_CONTEXT_SECRET =
  String(process.env.WEBHOOK_CONTEXT_SECRET || process.env.JWT_SECRET || "").trim();
const VONAGE_SIGNED_WEBHOOKS_REQUIRED =
  !OFFLINE_MODE &&
  (
    process.env.VONAGE_ENFORCE_SIGNED_WEBHOOKS ||
    (IS_PRODUCTION ? "true" : "false")
  ).toLowerCase() === "true";
const uploadDir = "uploads/";

function isPlaceholderEnvValue(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return true;

  return (
    normalized.includes("replace_with") ||
    normalized.includes("paste_your") ||
    normalized.includes("change_me") ||
    normalized.includes("example.com") ||
    normalized.includes("your-public-webhook") ||
    normalized === "optional_public_key_if_used"
  );
}

function ensureProductionEnv(name, value, validator, message) {
  const normalized = String(value || "").trim();

  if (!normalized || isPlaceholderEnvValue(normalized)) {
    console.error(`❌ Missing or placeholder ${name} in production`);
    process.exit(1);
  }

  if (typeof validator === "function" && !validator(normalized)) {
    console.error(`❌ ${message || `${name} is invalid for production`}`);
    process.exit(1);
  }
}

function captureRawBody(req, res, buf) {
  req.rawBody = buf?.length ? buf.toString("utf8") : "";
}

function logVonageDebug(...args) {
  if (process.env.NODE_ENV !== "production") {
    console.log(...args);
  }
}

function logDebug(...args) {
  if (process.env.NODE_ENV !== "production") {
    console.log(...args);
  }
}

function logWarnDebug(...args) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(...args);
  }
}

function logErrorDebug(...args) {
  if (process.env.NODE_ENV !== "production") {
    console.error(...args);
  }
}

const ACCESS_TTL = process.env.ACCESS_TTL || "15m";
const REFRESH_DAYS = Number(process.env.REFRESH_DAYS || 14);

/* -------------------------
   Dialer Settings (DEFAULTS)
-------------------------- */
const dialerSettings = {
  bulkDelayMs: Number(process.env.BULK_DELAY_MS || 1500),
  enableVoicemailDrop:
    (process.env.ENABLE_VOICEMAIL_DROP || "false").toLowerCase() === "true",
  timeZone: process.env.TIME_ZONE || "UTC",
};

/* -------------------------
   Caller ID / Forward-To (DEFAULTS)
-------------------------- */
let callerId =
  process.env.CALLER_ID ||
  process.env.VONAGE_FROM_NUMBER ||
  process.env.VONAGE_OUTBOUND_NUMBER ||
  "";
let vonageApplicationId = process.env.VONAGE_APPLICATION_ID || "";

let forwardTo = process.env.FORWARD_TO_NUMBER || "";
const VONAGE_GLOBAL_ENV_KEYS = [
  "VONAGE_API_KEY",
  "VONAGE_API_SECRET",
  "VONAGE_APPLICATION_ID",
];
const VONAGE_GLOBAL_ENV_PARTIALLY_CONFIGURED = VONAGE_GLOBAL_ENV_KEYS.some(
  (name) => String(process.env[name] || "").trim().length > 0
);
/* -------------------------
   REQUIRED ENV CHECKS
-------------------------- */
if (!process.env.JWT_SECRET) {
  console.error("❌ Missing JWT_SECRET in environment variables");
  process.exit(1);
}

if (!OFFLINE_MODE && IS_PRODUCTION) {
  if (!process.env.PUBLIC_WEBHOOK_URL) {
    console.error("âŒ Missing PUBLIC_WEBHOOK_URL in production");
    process.exit(1);
  }

  if (/localhost|127\.0\.0\.1/i.test(process.env.PUBLIC_WEBHOOK_URL)) {
    console.error("âŒ PUBLIC_WEBHOOK_URL cannot point to localhost in production");
    process.exit(1);
  }
}

if (VONAGE_SIGNED_WEBHOOKS_REQUIRED && !VONAGE_API_SIGNATURE_SECRET) {
  console.error(
    "âŒ Missing VONAGE_API_SIGNATURE_SECRET while signed webhook verification is required"
  );
  process.exit(1);
}

if (!OFFLINE_MODE && IS_PRODUCTION) {
  if (USE_CONTROL_PLANE_SOURCE) {
    ensureProductionEnv(
      "CONTROL_PLANE_BASE_URL",
      process.env.CONTROL_PLANE_BASE_URL,
      (value) => /^https:\/\//i.test(value),
      "CONTROL_PLANE_BASE_URL must use HTTPS in production"
    );
    ensureProductionEnv("CONTROL_PLANE_API_SECRET", process.env.CONTROL_PLANE_API_SECRET);
    ensureProductionEnv(
      "CONTROL_PLANE_TIMEOUT_MS",
      process.env.CONTROL_PLANE_TIMEOUT_MS,
      (value) => Number(value) > 0,
      "CONTROL_PLANE_TIMEOUT_MS must be a positive number"
    );
  }
  ensureProductionEnv(
    "JWT_SECRET",
    process.env.JWT_SECRET,
    (value) => value.length >= 32,
    "JWT_SECRET must be at least 32 characters in production"
  );
  ensureProductionEnv(
    "MONGODB_URI",
    process.env.MONGODB_URI,
    (value) => /^mongodb(\+srv)?:\/\//i.test(value),
    "MONGODB_URI must be a valid MongoDB connection string in production"
  );
  ensureProductionEnv(
    "PUBLIC_WEBHOOK_URL",
    process.env.PUBLIC_WEBHOOK_URL,
    (value) => /^https:\/\//i.test(value) && !/localhost|127\.0\.0\.1/i.test(value),
    "PUBLIC_WEBHOOK_URL must use HTTPS and cannot point to localhost in production"
  );
  ensureProductionEnv(
    "CORS_ORIGIN",
    process.env.CORS_ORIGIN,
    (value) =>
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .every(
          (origin) =>
            /^https:\/\//i.test(origin) && !/localhost|127\.0\.0\.1/i.test(origin)
        ),
    "CORS_ORIGIN must contain only HTTPS production origins"
  );
  if (VONAGE_GLOBAL_ENV_PARTIALLY_CONFIGURED) {
    ensureProductionEnv("VONAGE_API_KEY", process.env.VONAGE_API_KEY);
    ensureProductionEnv("VONAGE_API_SECRET", process.env.VONAGE_API_SECRET);
    ensureProductionEnv(
      "VONAGE_APPLICATION_ID",
      process.env.VONAGE_APPLICATION_ID,
      (value) => /^[0-9a-f-]{36}$/i.test(value),
      "VONAGE_APPLICATION_ID must be a valid UUID in production"
    );
    ensureProductionEnv("VONAGE_PRIVATE_KEY_PATH", process.env.VONAGE_PRIVATE_KEY_PATH);
  }
  ensureProductionEnv("VONAGE_API_SIGNATURE_SECRET", process.env.VONAGE_API_SIGNATURE_SECRET);
  ensureProductionEnv(
    "SUPPORT_PROVIDER_WEBHOOK_SECRET",
    process.env.SUPPORT_PROVIDER_WEBHOOK_SECRET
  );
  if (!USE_CONTROL_PLANE_SOURCE) {
    ensureProductionEnv("VYNCE_LICENSE_TOKEN", process.env.VYNCE_LICENSE_TOKEN);
    ensureProductionEnv("VYNCE_ACTIVATION_ID", process.env.VYNCE_ACTIVATION_ID);
  }
}

/* =========================================================
   LICENSE BOOTSTRAP (OFFLINE SAFE)
========================================================= */
const licenseToken = process.env.VYNCE_LICENSE_TOKEN;

if (!USE_CONTROL_PLANE_SOURCE && licenseToken) {
  try {
    const decoded = process.env.LICENSE_PUBLIC_KEY
      ? jwt.verify(licenseToken, process.env.LICENSE_PUBLIC_KEY)
      : jwt.decode(licenseToken); // 🔓 DEV / OFFLINE fallback

    global.currentLicensePayload = {
      ...decoded,
      status: "active",
      usage: decoded?.usage || { callsUsed: 0 },
    };

    logDebug("✅ License loaded");
  } catch (err) {
    console.error(
      "⚠️ License verification failed at startup:",
      err.message
    );

    // 🔐 SAFE OFFLINE / DEV FALLBACK
    global.currentLicensePayload = {
      status: "active",
      plan: "development",
      usage: { callsUsed: 0 },
      features: {},
    };
  }
} else if (!USE_CONTROL_PLANE_SOURCE) {
  // 🧪 Explicit offline fallback when no token exists
  global.currentLicensePayload = {
    status: "active",
    plan: "offline",
    usage: { callsUsed: 0 },
    features: {},
  };
}

/* =========================================================
   HTTP SERVER + SOCKET.IO (MUST ALWAYS RUN)
========================================================= */

/* =========================================================
   APP / SERVER / IO (SINGLE SOURCE OF TRUTH)
========================================================= */

// 1️⃣ Create express app FIRST
const app = express();

// 2️⃣ Create HTTP server using app
const server = http.createServer(app);

// 3️⃣ Attach Socket.IO to server
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173"], // Your frontend URL
    methods: ["GET", "POST"],
    credentials: true
  }
});

// 4️⃣ Make io globally accessible (matches Vynce logic)
global.io = io;

// 5️⃣ Optional socket logs (safe)
io.on("connection", (socket) => {
  logDebug("🔌 Socket connected:", socket.id);

  socket.on("disconnect", () => {
    logDebug("🔌 Socket disconnected:", socket.id);
  });
});


/* =========================================================
   MONGOOSE
========================================================= */
if (!process.env.MONGODB_URI) {
  console.error("❌ Missing MONGODB_URI in environment variables");
  process.exit(1);
}
/* =========================================================
   MONGOOSE (OFFLINE LOCKED)
========================================================= */

const MONGO_URI = OFFLINE_MODE
  ? "mongodb://127.0.0.1:27017/vynce_offline"
  : process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error("❌ MongoDB connection string missing");
  process.exit(1);
}

logDebug(
  "🗄️ Connecting to Mongo:",
  OFFLINE_MODE ? "LOCAL (offline)" : "ATLAS (cloud)"
);
mongoose.connection.on("error", (e) => console.error("❌ Mongo error event:", e.message));
mongoose.connection.on("connected", () => logDebug("🟢 Mongo connected event"));
mongoose.connection.on("disconnected", () => logDebug("🟠 Mongo disconnected event"));
/* =========================================================
   MAIN INITIALIZATION (WRAPPED IN ASYNC IIFE)
========================================================= */
(async () => {
  try {
    // 1. Connect to MongoDB
    logDebug("🗄️ Connecting to MongoDB...");
await mongoose.connect(MONGO_URI, {
  serverSelectionTimeoutMS: 10_000,
  connectTimeoutMS: 10_000,
});
logDebug("✅ Connected to MongoDB");

    // 2. Seed offline admin if needed
    if (OFFLINE_MODE) {
      await seedOfflineAdmin();
    }

    // 3. Initialize Vonage global client (only when env creds are present).
    // When VONAGE_API_KEY is absent, per-tenant TelephonySettings credentials
    // are used at call time via buildVonageClientForTenant().
    if (VONAGE_ENV_CREDS_PRESENT) {
      logDebug("🔧 Initializing Vonage client from environment credentials...");
      await initializeVonage();
      logDebug("✅ Vonage client initialized successfully");
    } else {
      logDebug(
        "⚠️  No VONAGE_API_KEY in environment — global Vonage client not initialized. " +
        "Calls will use per-tenant credentials from TelephonySettings."
      );
    }

    // 4. Now start the server
    server.listen(PORT, () => {
      logDebug(`\n🚀 Ring-Di-Skull backend running on http://localhost:${PORT}`);
      logDebug(`📦 OFFLINE MODE: ${OFFLINE_MODE}`);
      logDebug(`✅ Ready\n`);
      
      logDebug("🚀 Registered API Routes:");
      if (!IS_PRODUCTION) {
        app._router.stack
          .filter((r) => r.route)
          .forEach((r) => {
            const methods = Object.keys(r.route.methods)
              .map((m) => m.toUpperCase())
              .join(", ");
            console.log(`  ${methods} http://localhost:${PORT}${r.route.path}`);
          });
      }
    });

    logDebug("🔌 Waiting for socket connections...");

  } catch (err) {
    console.error("❌ Fatal initialization error:", err);
    process.exit(1);
  }
})();



/* =========================================================
   VONAGE ENVIRONMENT VALIDATION
========================================================= */


/* =========================================================
   VONAGE INITIALIZATION - FINAL CORRECTED VERSION
========================================================= */

// Required environment variables
const REQUIRED_ENV_VARS = [
  { name: 'VONAGE_API_KEY', description: 'Vonage API Key from dashboard' },
  { name: 'VONAGE_API_SECRET', description: 'Vonage API Secret from dashboard' },
  { name: 'VONAGE_APPLICATION_ID', description: 'Vonage Application ID from dashboard' },
  { name: 'VONAGE_PRIVATE_KEY_PATH', description: 'Path to RSA private key file' }
];

// Validate environment variables.
// Only enforce fatal exit when VONAGE_API_KEY is set (global/env-based credential mode).
// When VONAGE_API_KEY is absent, per-tenant credentials from TelephonySettings will be
// used at call time and global Vonage init is skipped gracefully.
const VONAGE_ENV_CREDS_PRESENT = !!process.env.VONAGE_API_KEY;
if (VONAGE_ENV_CREDS_PRESENT) {
  for (const { name, description } of REQUIRED_ENV_VARS) {
    if (!process.env[name]) {
      console.error(`❌ Missing required environment variable: ${name}`);
      console.error(`   Description: ${description}`);
      process.exit(1);
    }
  }
} else {
  logVonageDebug(
    "⚠️  No VONAGE_API_KEY in environment. Global Vonage client will not be initialized." +
    " Per-tenant credentials from TelephonySettings will be used at call time."
  );
}

/* =========================================================
   PRIVATE KEY LOADING AND VALIDATION
========================================================= */
let VONAGE_PRIVATE_KEY;
if (VONAGE_ENV_CREDS_PRESENT) {
  try {
    const keyPath = path.resolve(process.env.VONAGE_PRIVATE_KEY_PATH);
    logVonageDebug(`🔑 Loading private key from: ${keyPath}`);

    if (!fs.existsSync(keyPath)) {
      throw new Error(`Private key file not found at: ${keyPath}`);
    }

    VONAGE_PRIVATE_KEY = fs.readFileSync(keyPath, 'utf8').trim();

    if (!VONAGE_PRIVATE_KEY.startsWith('-----BEGIN RSA PRIVATE KEY-----') ||
        !VONAGE_PRIVATE_KEY.endsWith('-----END RSA PRIVATE KEY-----')) {
      throw new Error('Invalid private key format. Must be RSA private key with BEGIN/END tags.');
    }

    if (VONAGE_PRIVATE_KEY.length < 500) {
      throw new Error(`Private key too short (${VONAGE_PRIVATE_KEY.length} chars).`);
    }

    logVonageDebug(`✅ Private key loaded (${VONAGE_PRIVATE_KEY.length} chars)`);
  } catch (err) {
    console.error('❌ Failed to load private key:', err.message);
    process.exit(1);
  }
} else {
  logVonageDebug("⚠️  Skipping global private key load — per-tenant TelephonySettings in use.");
}

/* =========================================================
   CREDENTIAL DIAGNOSTIC AND VALIDATION
========================================================= */
async function runCredentialDiagnostic() {

  logVonageDebug('🔍 Running Vonage credential diagnostic...');
logVonageDebug("VONAGE ENV CHECK", {
  apiKeyMasked: maskValue(process.env.VONAGE_API_KEY),
  apiSecretPresent: !!process.env.VONAGE_API_SECRET,
  applicationIdMasked: maskValue(vonageApplicationId),
});
  

  // Test 2: Credential validation
  try {
    logVonageDebug('🔐 Testing Vonage credentials...');
    const auth = Buffer
  .from(`${process.env.VONAGE_API_KEY}:${process.env.VONAGE_API_SECRET}`)
  .toString("base64");

const testResponse = await fetch("https://rest.nexmo.com/account/get-balance", {
  method: "GET",
  headers: {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  },
  signal: AbortSignal.timeout(10_000),
});

const responseText = await testResponse.text();

    // Check if we got HTML (indicates auth failure)
    if (responseText.includes('<html') || responseText.includes('<HTML')) {
      console.error('❌ Authentication failed - received HTML response');
      logErrorDebug('   This typically means:');
      logErrorDebug('   1. Incorrect API key or secret');
      logErrorDebug('   2. Account is disabled or suspended');
      logErrorDebug('   3. IP address is not whitelisted (if using IP restrictions)');

      // Provide exact curl command for manual testing
      logErrorDebug('\n🔧 Manual testing command:');
      logErrorDebug('   Use the Vonage dashboard or a secret-safe local credential check');

      return false;
    }

    // Try to parse as JSON
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      console.error('❌ Invalid API response format');
      logErrorDebug('   Response:', responseText.substring(0, 200));
      return false;
    }

    if (!testResponse.ok) {
      console.error('❌ API request failed:', responseData.error_title || testResponse.statusText);
      return false;
    }

    logVonageDebug('✅ Vonage credentials validated successfully');
    logVonageDebug(`   💰 Account Balance: ${responseData.value} ${responseData.currency || 'EUR'}`);
    return true;
  } catch (err) {
    console.error('❌ Credential validation failed:', err.message);
    if (err.code === 'ECONNREFUSED') {
      logErrorDebug('   Connection refused - check network/firewall');
    } else if (err.code === 'ENOTFOUND') {
      logErrorDebug('   DNS lookup failed - check internet connection');
    } else if (err.code === 'ETIMEDOUT') {
      logErrorDebug('   Request timeout - API may be slow or unavailable');
    }
    return false;
  }
}

/* =========================================================
   PER-TENANT VONAGE CLIENT BUILDER
   Loads verified TelephonySettings and returns a scoped
   Vonage instance + outbound number for that tenant.
   Falls back to the global singleton when no per-tenant
   credentials are stored.
========================================================= */
async function buildVonageClientForTenant(tenantId) {
  if (!tenantId) return { vonageInstance: vonage, fromNumber: callerId };

  try {
    const ts = await TelephonySettings.findOne({
      tenantId,
      verified: true,
    })
      .sort({ updatedAt: -1 })
      .lean();

    if (
      ts &&
      ts.apiKey &&
      ts.apiSecret &&
      ts.applicationId &&
      ts.privateKey
    ) {
      const instance = new Vonage({
        apiKey: ts.apiKey,
        apiSecret: ts.apiSecret,
        applicationId: ts.applicationId,
        privateKey: ts.privateKey,
        debug: !IS_PRODUCTION,
      });
      const fromNumber = ts.outboundNumber || callerId;
      logVonageDebug(
        `🔑 Using per-tenant Vonage credentials for tenantId=${tenantId}` +
        ` from=${maskValue(fromNumber)}`
      );
      return { vonageInstance: instance, fromNumber };
    }
  } catch (err) {
    logWarnDebug(
      `buildVonageClientForTenant: could not load TelephonySettings for ` +
      `tenantId=${tenantId}:`,
      err.message
    );
  }

  // Fall back to global singleton
  if (!vonage) {
    throw new Error(
      "No per-tenant Vonage credentials found and global Vonage client is not initialized. " +
      "Please verify your Vonage credentials in Settings."
    );
  }
  logVonageDebug(`🔑 Falling back to global Vonage client for tenantId=${tenantId}`);
  return { vonageInstance: vonage, fromNumber: callerId };
}

/* =========================================================
   VONAGE CLIENT INITIALIZATION WITH FALLBACKS
========================================================= */
let vonage;
async function initializeVonage() {
  if (OFFLINE_MODE) {
    logVonageDebug("📦 OFFLINE: Vonage initialization bypassed");
    return null;
  }
  if (!VONAGE_ENV_CREDS_PRESENT) {
    logVonageDebug(
      "⚠️  initializeVonage: no env credentials — skipping global client init. " +
      "Per-tenant credentials will be used at call time."
    );
    return null;
  }

  try {
    // Run diagnostic first
    const credentialsValid = await runCredentialDiagnostic();
    if (!credentialsValid) {
      throw new Error('Vonage credential diagnostic failed');
    }

    logVonageDebug('🔧 Initializing Vonage client...');

    // Create Vonage client instance
    vonage = new Vonage({
      apiKey: process.env.VONAGE_API_KEY,
      apiSecret: process.env.VONAGE_API_SECRET,
      applicationId: vonageApplicationId,
      privateKey: VONAGE_PRIVATE_KEY,
      debug: !IS_PRODUCTION
    });

    if (!vonage) {
      throw new Error('Vonage client initialization failed');
    }

    logVonageDebug('✅ Vonage client initialized successfully');
    return vonage;
  } catch (err) {
    console.error('❌ Vonage initialization failed:', err.message);

    // Provide comprehensive troubleshooting guide
    logErrorDebug('\n🔧 COMPREHENSIVE TROUBLESHOOTING GUIDE:');
    logErrorDebug('1. CREDENTIAL VERIFICATION:');
    logErrorDebug('   - Log in to: https://dashboard.vonage.com');
    logErrorDebug('   - Navigate to: Settings > API Settings');
    logErrorDebug('   - Verify API Key and Secret match your .env file');
    logErrorDebug('   - Regenerate API Secret if needed');

    logErrorDebug('2. MANUAL TESTING:');
    logErrorDebug('   Use the Vonage dashboard or a secret-safe local credential check');

    logErrorDebug('3. ACCOUNT STATUS:');
    logErrorDebug('   - Check account is active and not suspended');
    logErrorDebug('   - Verify sufficient balance');
    logErrorDebug('   - Check: https://dashboard.vonage.com/account/overview');

    logErrorDebug('4. NETWORK CHECKS:');
    logErrorDebug('   - Test basic connectivity: ping api.vonage.com');
    logErrorDebug('   - Check firewall/proxy settings');
    logErrorDebug('   - Verify no IP restrictions in Vonage dashboard');

    logErrorDebug('5. PRIVATE KEY:');
    logErrorDebug('   - Verify path in VONAGE_PRIVATE_KEY_PATH');
    logErrorDebug('   - Ensure key matches application in dashboard');
    logErrorDebug('   - Key should start with "-----BEGIN RSA PRIVATE KEY-----"');

    process.exit(1);
  }
}

app.get("/internal/voice-legacy-disabled", async (req, res) => {
  const callId = req.query.callId;
  // GET THE DYNAMIC TARGET FROM THE URL
  const targetNumber = req.query.target;
  void writeVonageWebhookAudit("voice", req, {
    callId: String(callId || ""),
    targetNumber: String(targetNumber || ""),
  });

  logVonageDebug(`📞 VOICE WEBHOOK: CallID=${callId}, Target=${targetNumber}`);

  // If target is missing, fallback to env (safety net)
  const connectNumber = targetNumber || process.env.FORWARD_TO_NUMBER;

  const ncco = [
    {
      action: "talk",
      text: "Connecting your call...",
      voiceName: "Jennifer"
    },
    {
      action: "connect",
      endpoint: [
        {
          type: "phone",
          number: connectNumber // USE THE DYNAMIC NUMBER HERE
        }
      ]
    }
  ];

  res.json(ncco);
});

/* =========================================================
   MIDDLEWARE
========================================================= */
app.use(cookieParser());
app.use(bodyParser.json({ limit: "2mb", verify: captureRawBody }));
app.use(bodyParser.urlencoded({ extended: false, verify: captureRawBody }));


// ✅ Allow comma-separated origins in env (common on Render/Vercel configs)
const envOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = ["http://localhost:5173", "http://localhost:3000", ...envOrigins].filter(
  Boolean
);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  })
);
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    logDebug(`➡️ ${req.method} ${req.path}`);
  }
  next();
});
// Open paths that must NOT require auth/license checks
const OPEN_PATHS = new Set([
"/api/health",
"/api/auth/login",
"/api/auth/me",
"/api/auth/logout",
"/api/auth/register",
"/api/auth/refresh",
"/api/voice",
"/api/amd-status",
"/api/status",
]);

const ADMIN_DASHBOARD_BYPASS_PREFIXES = ["/api/admin/", "/api/support/"];
const ADMIN_DASHBOARD_BYPASS_PATHS = new Set(["/api/calls"]);

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    logDebug(`➡️ ${req.method} ${req.path}`);
  }
  next();
});

// Global guard: protect all API routes except open paths
app.use(async (req, res, next) => {
if (!req.path.startsWith("/api")) return next();
if (OPEN_PATHS.has(req.path)) return next();

// Require auth first, then license enabled (except superadmin)
return authMiddleware(req, res, async () => {
if (req.user?.isSuperAdmin) return next();
const role = String(req.user?.role || "").toLowerCase();
const isAdminRole = role === "admin" || role === "superadmin";
const isAdminDashboardPath =
  ADMIN_DASHBOARD_BYPASS_PATHS.has(req.path) ||
  ADMIN_DASHBOARD_BYPASS_PREFIXES.some((prefix) => req.path.startsWith(prefix));
if (isAdminRole && isAdminDashboardPath) return next();
return enforceAccountEnabled(req, res, next);
});
});

function enforceLimitsOrThrow({ subscription, activeCalls }) {
  if (!subscription) return; // dev-safe

  const plan = plans[subscription.plan];
  if (!plan) return;

  // Monthly limit
  if (
    typeof subscription.usage?.callsThisMonth === "number" &&
    subscription.usage.callsThisMonth >= plan.limits.monthlyCallAttempts
  ) {
    throw new Error("Monthly call limit reached");
  }

  // Concurrent limit
  if (
    typeof plan.limits?.maxConcurrentCalls === "number" &&
    activeCalls >= plan.limits.maxConcurrentCalls
  ) {
    throw new Error("Concurrent call limit reached");
  }
}


function requireFeature(subscription, feature) {
  const plan = plans[subscription.plan];

  if (!plan.features[feature]) {
    throw new Error(`Feature '${feature}' not available on your plan`);
  }
}


// scripts (in-memory for now)
let callScripts = [
  {
    id: "1",
    name: "Sales Introduction",
    content: `Hello [Name], this is [Agent] calling from Vynce.`,
    category: "sales",
    isActive: true,
  },
];

// voicemail (in-memory for now)
let voicemailMessages = [
  {
    id: "default",
    name: "Default Message",
    content: "Hello, this is Vynce calling back...",
    voiceId: "Amy",
    label: "Amy (US Female)",
    isActive: true,
  },
];
let activeVoicemailId = "";

const TTS_VOICES = [
  { id: "Amy", label: "Amy (US Female)" },
  { id: "Joey", label: "Joey (US Male)" },
  { id: "Emma", label: "Emma (UK Female)" },
];

function replaceVoicemailPlaceholders(template, call) {
  const metadata = call?.metadata || {};
  const replacements = {
    "[Agent]": call?.agent || "Vynce",
    "[Number]": call?.number || call?.to || "",
    "[Company]": metadata.company || metadata.companyName || "Vynce",
    "[Product]": metadata.product || "our service",
    "[Name]":
      metadata.name ||
      [metadata.firstName, metadata.lastName].filter(Boolean).join(" ") ||
      "there",
  };

  return Object.entries(replacements).reduce(
    (content, [placeholder, value]) => content.replaceAll(placeholder, value || ""),
    template || ""
  );
}

function normalizeWebhookValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function maskValue(value = "", visibleChars = 4) {
  const input = String(value || "");
  if (!input) return "";
  if (input.length <= visibleChars) return "*".repeat(input.length);
  return `${"*".repeat(Math.max(0, input.length - visibleChars))}${input.slice(-visibleChars)}`;
}

function extractBearerToken(headerValue = "") {
  const raw = String(headerValue || "").trim();
  if (!raw) return "";
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : raw;
}

function createVonageWebhookContextToken(payload = {}) {
  if (!WEBHOOK_CONTEXT_SECRET) return "";

  return jwt.sign(
    {
      tenantId: String(payload.tenantId || "").trim(),
      callId: String(payload.callId || "").trim(),
      target: String(payload.target || "").trim(),
      type: "vonage_callback_context",
    },
    WEBHOOK_CONTEXT_SECRET,
    {
      algorithm: "HS256",
      expiresIn: "2h",
      issuer: "vynce",
      audience: "vonage-webhook",
    }
  );
}

function verifyVonageWebhookContextToken(token = "") {
  if (!WEBHOOK_CONTEXT_SECRET || !token) return null;

  return jwt.verify(String(token || "").trim(), WEBHOOK_CONTEXT_SECRET, {
    algorithms: ["HS256"],
    issuer: "vynce",
    audience: "vonage-webhook",
  });
}

async function findVerifiedTelephonySettingsForTenant(tenantId) {
  const tid = String(tenantId || "").trim();
  if (!tid) return null;

  return TelephonySettings.findOne({
    tenantId: tid,
    verified: true,
  })
    .sort({ updatedAt: -1 })
    .lean()
    .catch(() => null);
}

async function resolveVonageWebhookVerificationContext(req) {
  const queryTenantId = String(req.query?.tenantId || "").trim();
  const queryCallId = String(req.query?.callId || "").trim();
  const queryTarget = String(req.query?.target || "").trim();
  const contextToken = String(req.query?.ctx || "").trim();

  let signedContext = null;
  if (contextToken) {
    signedContext = verifyVonageWebhookContextToken(contextToken);
  }

  const tenantIdFromContext = String(signedContext?.tenantId || "").trim();
  const callIdFromContext = String(signedContext?.callId || "").trim();

  if (queryTenantId && tenantIdFromContext && queryTenantId !== tenantIdFromContext) {
    const err = new Error("Webhook tenant context mismatch");
    err.statusCode = 401;
    err.code = "WEBHOOK_CONTEXT_MISMATCH";
    throw err;
  }

  if (queryCallId && callIdFromContext && queryCallId !== callIdFromContext) {
    const err = new Error("Webhook call context mismatch");
    err.statusCode = 401;
    err.code = "WEBHOOK_CONTEXT_MISMATCH";
    throw err;
  }

  if (queryTarget && signedContext?.target && queryTarget !== signedContext.target) {
    const err = new Error("Webhook target context mismatch");
    err.statusCode = 401;
    err.code = "WEBHOOK_CONTEXT_MISMATCH";
    throw err;
  }

  let tenantId = tenantIdFromContext || queryTenantId;
  const callId = callIdFromContext || queryCallId;

  if (!tenantId && callId && mongoose.Types.ObjectId.isValid(callId)) {
    const callById = await Call.findById(callId).select("tenantId").lean().catch(() => null);
    tenantId = String(callById?.tenantId || "").trim();
  }

  if (!tenantId) {
    const callUuid = String(
      req.body?.call_uuid || req.body?.uuid || req.body?.conversation_uuid || ""
    ).trim();
    if (callUuid) {
      const callByUuid = await Call.findOne({ uuid: callUuid }).select("tenantId").lean().catch(() => null);
      tenantId = String(callByUuid?.tenantId || "").trim();
    }
  }

  const telephonySettings = await findVerifiedTelephonySettingsForTenant(tenantId);
  const expectedApplicationId = String(
    telephonySettings?.applicationId || vonageApplicationId || ""
  ).trim();
  const expectedSignatureSecret = String(
    telephonySettings?.webhookSecret || VONAGE_API_SIGNATURE_SECRET || ""
  ).trim();

  return {
    tenantId,
    callId,
    signedContext,
    telephonySettings,
    expectedApplicationId,
    expectedSignatureSecret,
  };
}

async function verifyVonageSignedWebhook(req, res, next) {
  if (!VONAGE_SIGNED_WEBHOOKS_REQUIRED || OFFLINE_MODE) {
    return next();
  }

  try {
    const token = extractBearerToken(req.headers.authorization);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Missing Vonage webhook signature",
      });
    }

    const verificationContext = await resolveVonageWebhookVerificationContext(req);
    if (!verificationContext.expectedSignatureSecret) {
      return res.status(401).json({
        success: false,
        message: "Vonage webhook secret is not configured for this tenant",
      });
    }

    const decoded = jwt.verify(token, verificationContext.expectedSignatureSecret, {
      algorithms: ["HS256", "HS384", "HS512"],
    });

    if (
      decoded.application_id &&
      verificationContext.expectedApplicationId &&
      decoded.application_id !== verificationContext.expectedApplicationId
    ) {
      return res.status(401).json({
        success: false,
        message: "Vonage webhook application mismatch",
      });
    }

    if (decoded.payload_hash) {
      const actualHash = crypto
        .createHash("sha256")
        .update(req.rawBody || "")
        .digest("hex");

      if (String(decoded.payload_hash).toLowerCase() !== actualHash.toLowerCase()) {
        return res.status(401).json({
          success: false,
          message: "Vonage webhook payload hash mismatch",
        });
      }
    }

    req.vonageWebhookClaims = decoded;
    req.vonageWebhookContext = verificationContext;
    return next();
  } catch (err) {
    logWarnDebug("Vonage webhook signature verification failed:", err.message);
    return res.status(401).json({
      success: false,
      message: "Invalid Vonage webhook signature",
    });
  }
}

function isHumanMachineEvent(payload = {}) {
  const status = normalizeWebhookValue(payload.status);
  const answeredBy = normalizeWebhookValue(
    payload.answered_by || payload.answeredBy
  );
  const machineResult = normalizeWebhookValue(
    payload.machine_detection_result || payload.machineDetectionResult
  );

  return [status, answeredBy, machineResult].some(
    (value) => value === "human" || value === "machine"
  );
}

function isVoicemailDetectionEvent(payload = {}) {
  const status = normalizeWebhookValue(payload.status);
  const subState = normalizeWebhookValue(payload.sub_state || payload.subState);
  const answeredBy = normalizeWebhookValue(
    payload.answered_by || payload.answeredBy
  );
  const machineResult = normalizeWebhookValue(
    payload.machine_detection_result || payload.machineDetectionResult
  );
  const machine = normalizeWebhookValue(payload.machine);
  const detail = normalizeWebhookValue(payload.detail);
  const reason = normalizeWebhookValue(payload.reason);

  const exactMatches = new Set([
    "machine",
    "voicemail",
    "answering_machine",
    "machine_start",
    "beep_start",
    "beep_timeout",
  ]);

  const values = [status, subState, answeredBy, machineResult, machine, detail, reason]
    .filter(Boolean);

  if (values.some((value) => exactMatches.has(value))) {
    return true;
  }

  return values.some(
    (value) =>
      value.includes("machine") ||
      value.includes("voicemail") ||
      value.includes("answering")
  );
}

function buildWebhookAuditHeaders(headers = {}) {
  return {
    "content-type": String(headers["content-type"] || ""),
    "user-agent": String(headers["user-agent"] || ""),
    "x-request-id": String(headers["x-request-id"] || ""),
    "x-forwarded-for": String(headers["x-forwarded-for"] || ""),
    "x-vonage-signature": String(headers["x-vonage-signature"] || ""),
  };
}

function classifyWebhookMatch(payload = {}) {
  if (isVoicemailDetectionEvent(payload)) return "voicemail";

  const status = normalizeWebhookValue(payload.status);
  const answeredBy = normalizeWebhookValue(
    payload.answered_by || payload.answeredBy
  );
  const machineResult = normalizeWebhookValue(
    payload.machine_detection_result || payload.machineDetectionResult
  );

  if ([status, answeredBy, machineResult].includes("human")) {
    return "human";
  }

  if ([status, answeredBy, machineResult].includes("machine")) {
    return "machine";
  }

  return "unclassified";
}

async function writeVonageWebhookAudit(eventType, req, metadata = {}) {
  if (!VONAGE_WEBHOOK_AUDIT_ENABLED || OFFLINE_MODE) {
    return;
  }

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const query = req.query && typeof req.query === "object" ? req.query : {};

    await VonageWebhookAudit.create({
      eventType,
      callUuid: String(
        metadata.callUuid ||
          body.call_uuid ||
          body.uuid ||
          body.conversation_uuid ||
          ""
      ),
      conversationUuid: String(body.conversation_uuid || ""),
      callId: String(
        metadata.callId || query.callId || body.callId || body.call_id || ""
      ),
      matchedAs: metadata.matchedAs || classifyWebhookMatch(body),
      status: String(body.status || ""),
      subState: String(body.sub_state || body.subState || ""),
      answeredBy: String(body.answered_by || body.answeredBy || ""),
      machineDetectionResult: String(
        body.machine_detection_result || body.machineDetectionResult || ""
      ),
      detail: String(body.detail || ""),
      reason: String(body.reason || ""),
      request: {
        method: req.method,
        query,
        headers: buildWebhookAuditHeaders(req.headers),
        body,
      },
      metadata,
    });
  } catch (auditErr) {
    logWarnDebug("Vonage webhook audit logging failed:", auditErr.message);
  }
}

async function getVoicemailRuntimeConfig() {
  let settings = await Settings.findOne({ singleton: true });

  if (!settings) {
    settings = await Settings.create({
      singleton: true,
      bulkDelayMs: dialerSettings.bulkDelayMs,
      enableVoicemailDrop: dialerSettings.enableVoicemailDrop,
      timeZone: dialerSettings.timeZone,
      callerId,
      forwardTo: process.env.FORWARD_TO_NUMBER || "",
      publicWebhookUrl,
      activeVoicemailId: activeVoicemailId || "",
    });
  }

  let activeMessage = null;

  if (settings.activeVoicemailId && mongoose.isValidObjectId(settings.activeVoicemailId)) {
    activeMessage = await VoicemailMessage.findById(settings.activeVoicemailId).lean();
  }

  if (!activeMessage) {
    activeMessage = await VoicemailMessage.findOne({ isActive: true }).lean();
  }

  if (!activeMessage) {
    const seeded = await VoicemailMessage.create({
      name: "Default Message",
      content: "Hello, this is [Agent] from [Company]. Please call us back at [Number].",
      voiceId: "Amy",
      isActive: true,
    });

    activeMessage = seeded.toObject();
    settings.activeVoicemailId = seeded._id.toString();
    await settings.save();
  }

  activeVoicemailId = activeMessage?._id?.toString() || activeVoicemailId;

  return {
    settings,
    activeMessage,
  };
}

async function handleDetectedVoicemail(callDoc) {
  if (!callDoc?.uuid) return null;

  const { settings, activeMessage } = await getVoicemailRuntimeConfig();
  const updatePayload = {
    voicemailDetected: true,
    status: "voicemail",
    updatedAt: new Date(),
  };

  if (callDoc.voicemailDetected && callDoc.voicemailLeft) {
    return Call.findById(callDoc._id).lean();
  }

  if (settings.enableVoicemailDrop && activeMessage && vonage) {
    try {
      const text = replaceVoicemailPlaceholders(activeMessage.content, callDoc);

      await vonage.voice.transferCallWithNCCO(callDoc.uuid, [
        {
          action: "talk",
          text,
          voiceName: activeMessage.voiceId,
        },
        { action: "hangup" },
      ]);

      updatePayload.voicemailLeft = true;
      updatePayload.voicemailLeftAt = new Date();
      updatePayload.voicemailMessageId = activeMessage._id.toString();
      updatePayload.voicemailVoiceId = activeMessage.voiceId;
      updatePayload.outcome = callDoc.outcome || "voicemail";
    } catch (err) {
      console.error("Voicemail TTS transfer failed:", err.message || err);
    }
  }

  return Call.findByIdAndUpdate(callDoc._id, { $set: updatePayload }, { new: true }).lean();
}

let activeChannels = 1;

// ✅ Don’t start at 2 (this causes “phantom usage” on fresh boot)
let callsToday = 0;

// NOTE: this resets every 24h from process start (fine for now)
setInterval(() => {
  callsToday = 0;
}, 1000 * 60 * 60 * 24);

/* =========================================================
   SOCKET.IO (BACKEND ONLY)
========================================================= */
io.on("connection", (socket) => {
  logDebug("📡 Client connected:", socket.id);

  // Send initial in-memory calls to newly connected client
  socket.emit("callsUpdate", allCalls);

  socket.on("disconnect", () => {
    logDebug("📴 Client disconnected:", socket.id);
  });
});



/**
 * Broadcast license state changes (enable / disable)
 * Called after admin updates license settings
 */
function broadcastLicenseUpdate(settings) {
  io.emit("license:update", {
    tenantId: settings.tenantId,
    isEnabled: settings.isEnabled,
    suspendReason: settings.suspendReason || "",
    plan: settings.plan || "standard",
    updatedAt: settings.updatedAt,
  });

  logDebug("🔔 License update broadcasted:", {
    tenantId: settings.tenantId,
    isEnabled: settings.isEnabled,
  });
}

/**
 * Utility: format phone numbers for display/logging
 */
function formatPhone(phone) {
  const clean = (phone || "").replace(/\D/g, "");

  if (clean.length === 11 && clean.startsWith("1")) {
    return `(${clean.slice(1, 4)}) ${clean.slice(4, 7)}-${clean.slice(7)}`;
  }

  if (clean.length === 10) {
    return `(${clean.slice(0, 3)}) ${clean.slice(3, 6)}-${clean.slice(6)}`;
  }

  return phone;
}

/* =========================================================
   LICENSE ENV DEBUG
========================================================= */
logDebug("LICENSE ENV CHECK", {
  licenseSource: LICENSE_SOURCE,
  hasToken: !!process.env.VYNCE_LICENSE_TOKEN,
  hasActivationId: !!process.env.VYNCE_ACTIVATION_ID,
});


/* =========================================================
   LICENSE MANAGER (STARTUP)
========================================================= */
if (shouldStartLegacyLicenseManager({ offlineMode: OFFLINE_MODE, mode: LICENSE_SOURCE })) {
  startLicenseManager({
    token: process.env.VYNCE_LICENSE_TOKEN,
    activationId: process.env.VYNCE_ACTIVATION_ID,
  });
} else {
  logDebug("📦 Legacy JWT manager bypassed", {
    offlineMode: OFFLINE_MODE,
    licenseSource: LICENSE_SOURCE,
  });
}


/* =========================================================
   LICENSE HEARTBEAT (CRITICAL)
========================================================= */

/* =========================================================
   LICENSE HEARTBEAT (FIXED + SAFE)
========================================================= */

const LICENSE_HEARTBEAT_MS = 30_000; // 30 seconds

async function runLicenseHeartbeat() {
  try {
    // 🚫 Payload must NEVER be null
    if (!global.currentLicensePayload) {
      console.error("❌ CRITICAL: License payload missing — forcing dev fallback");

      global.currentLicensePayload = {
        status: "active",
        plan: "development",
        usage: { callsUsed: 0 },
        limits: {},
        features: {},
        forcedFallback: true,
      };
    }

    const payload = global.currentLicensePayload;

    // ⏳ Expiry check (only if exp exists)
    if (payload.exp) {
      const expiresAt = payload.exp * 1000;

      if (Date.now() >= expiresAt) {
        console.warn("⚠️ License expired — switching to expired state");
        payload.status = "expired";
        payload.expiredAt = new Date(expiresAt).toISOString();
      }
    }

    // 💓 Record heartbeat timestamp
    global.lastLicenseHeartbeat = new Date();

    logDebug("💓 License heartbeat OK", {
      status: payload.status,
      plan: payload.plan,
      callsUsed: payload.usage?.callsUsed || 0,
      devMode: !!payload.forcedFallback,
    });

  } catch (err) {
    console.error("❌ License heartbeat error:", err.message);
  }
}

// ✅ START HEARTBEAT
if (!OFFLINE_MODE && !USE_CONTROL_PLANE_SOURCE) {
  setInterval(runLicenseHeartbeat, LICENSE_HEARTBEAT_MS);
  runLicenseHeartbeat();
} else {
  logDebug("📦 Legacy license heartbeat disabled", {
    offlineMode: OFFLINE_MODE,
    licenseSource: LICENSE_SOURCE,
  });
}



/* =========================================================
   AUTH HELPERS (ACCESS + REFRESH)
========================================================= */
function userToSafeObject(userDoc) {
  if (!userDoc) return null;
  const obj = userDoc.toObject ? userDoc.toObject() : { ...userDoc };
  delete obj.passwordHash;
  delete obj.refreshTokens;
  return obj;
}

function signAccessToken(userDoc) {
  return jwt.sign(
    {
      id: userDoc._id.toString(),
      role: userDoc.role || "customer",
      isSuperAdmin: !!userDoc.isSuperAdmin,
      tenantId: userDoc.tenantId || undefined,
    },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

function createRefreshToken() {
  return crypto.randomBytes(48).toString("hex");
}

function hashToken(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function refreshCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";

  // 🧪 OFFLINE / LOCALHOST
  if (!isProd) {
    return {
      httpOnly: true,
      secure: false,          // ❌ NOT HTTPS on localhost
      sameSite: "lax",        // ✅ REQUIRED for localhost
      path: "/",
      maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000,
    };
  }

  // 🌍 PRODUCTION (HTTPS)
  return {
    httpOnly: true,
    secure: true,             // ✅ HTTPS only
    sameSite: "none",         // ✅ cross-site allowed
    path: "/",
    maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000,
  };
}




// JWT access middleware
// ===============================
// AUTH MIDDLEWARE (SINGLE SOURCE)
// ===============================
async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "No token provided",
    });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const userId =
      payload.id ||
      payload._id ||
      payload.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid token payload",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    req.auth = payload;
    req.user = user;

    // ✅ GUARANTEED TENANT CONTEXT
    req.user.tenantId =
      user.tenantId ||
      payload.tenantId ||
      payload.subscription?.tenantId ||
      String(user._id);

    next();
  } catch (err) {
    console.error("Auth error:", err.message);
    return res.status(401).json({
      success: false,
      message: "Invalid token",
    });
  }
}

export { authMiddleware };


function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const role = req.user?.role;
    const isSuperAdmin = !!req.user?.isSuperAdmin;

    if (isSuperAdmin) return next();
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    return next();
  };
}

function adminOnly(req, res, next) {
  if (req.user?.isSuperAdmin || req.user?.role === "admin") return next();
  return res.status(403).json({ success: false, message: "Admin only" });
}

const ONBOARDING_REVIEW_STATUSES = [
  "draft",
  "pending_review",
  "changes_requested",
  "approved",
  "rejected",
];

const ONBOARDING_REVIEW_ACTIONS = ["approve", "request_changes", "reject"];
const TENANT_EDITABLE_ONBOARDING_STEPS = ["billingSetup", "complianceAccepted"];
const REQUIRED_ONBOARDING_STEP_KEYS = [
  "companyInfo",
  "settingsConfigured",
  "vonageConnected",
  "scriptUploaded",
  "agentAdded",
  "testCallCompleted",
];
const REVIEW_OPTIONAL_ONBOARDING_STEP_KEYS = ["vonageConnected"];

function getDefaultOnboardingSteps() {
  return {
    companyInfo: false,
    vonageConnected: false,
    agentAdded: false,
    scriptUploaded: false,
    testCallCompleted: false,
    billingSetup: false,
    settingsConfigured: false,
    complianceAccepted: false,
  };
}

function normalizeOnboardingSteps(steps = {}) {
  const defaults = getDefaultOnboardingSteps();
  const normalized = { ...defaults };

  for (const key of Object.keys(defaults)) {
    if (key in steps) {
      normalized[key] = Boolean(steps[key]);
    }
  }

  return normalized;
}

function pickOnboardingStepUpdates(steps = {}) {
  const defaults = getDefaultOnboardingSteps();
  const updates = {};

  for (const key of Object.keys(defaults)) {
    if (key in steps) {
      updates[key] = Boolean(steps[key]);
    }
  }

  return updates;
}

function getOnboardingCompletionSummary(
  steps = {},
  trackedKeys = REQUIRED_ONBOARDING_STEP_KEYS
) {
  const normalized = normalizeOnboardingSteps(steps);
  const values = trackedKeys.map((key) => Boolean(normalized[key]));
  const completed = values.filter(Boolean).length;
  const total = values.length;

  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 0,
  };
}

function getMissingRequiredOnboardingSteps(steps = {}) {
  const normalized = normalizeOnboardingSteps(steps);
  return REQUIRED_ONBOARDING_STEP_KEYS.filter((key) => !normalized[key]);
}

function getReviewBlockingOnboardingSteps(steps = {}) {
  return getMissingRequiredOnboardingSteps(steps).filter(
    (key) => !REVIEW_OPTIONAL_ONBOARDING_STEP_KEYS.includes(key)
  );
}

function canSubmitOnboardingForReview(steps = {}) {
  return getReviewBlockingOnboardingSteps(steps).length === 0;
}

function buildOnboardingValidationError(steps = {}, message, missingStepsOverride) {
  const missingSteps = Array.isArray(missingStepsOverride)
    ? missingStepsOverride
    : getMissingRequiredOnboardingSteps(steps);

  return {
    success: false,
    code: "ONBOARDING_INCOMPLETE",
    message:
      message ||
      "Complete all required onboarding steps before requesting admin approval.",
    missingSteps,
    completion: getOnboardingCompletionSummary(steps),
  };
}

function buildOnboardingPayload(progressDoc, reviewDoc) {
  const steps = normalizeOnboardingSteps(progressDoc?.steps || {});
  const reviewStatus = reviewDoc?.status || "draft";
  const missingRequiredSteps = getMissingRequiredOnboardingSteps(steps);
  const missingReviewBlockingSteps = getReviewBlockingOnboardingSteps(steps);

  return {
    tenantId: progressDoc?.tenantId || reviewDoc?.tenantId || "default",
    ownerUserId: progressDoc?.ownerUserId || progressDoc?.userId || null,
    steps,
    completion: getOnboardingCompletionSummary(steps),
    requiredSteps: REQUIRED_ONBOARDING_STEP_KEYS,
    missingRequiredSteps,
    missingReviewBlockingSteps,
    canSubmitForReview: missingReviewBlockingSteps.length === 0,
    review: {
      status: reviewStatus,
      submittedAt:
        reviewDoc?.submittedAt || progressDoc?.submittedForReviewAt || null,
      reviewedAt: reviewDoc?.reviewedAt || null,
      reviewedBy: reviewDoc?.reviewedBy || null,
      adminNotes: reviewDoc?.adminNotes || "",
      requiredChanges: Array.isArray(reviewDoc?.requiredChanges)
        ? reviewDoc.requiredChanges
        : [],
      approvedForLiveCalling: !!reviewDoc?.approvedForLiveCalling,
      approvedForBilling: !!reviewDoc?.approvedForBilling,
    },
    submittedForReviewAt: progressDoc?.submittedForReviewAt || null,
    canGoLive:
      reviewStatus === "approved" &&
      !!reviewDoc?.approvedForLiveCalling &&
      missingRequiredSteps.length === 0,
  };
}

function buildCallingPermissions(onboarding, options = {}) {
  const reviewStatus = onboarding?.review?.status || "draft";
  const testCallCompleted = !!onboarding?.steps?.testCallCompleted;
  const canGoLive =
    !!onboarding?.canGoLive || Boolean(options?.onboardingOverrideActive);

  return {
    canSingleCall: canGoLive || !testCallCompleted,
    canBulkCall: canGoLive,
    testCallAvailable: !canGoLive && !testCallCompleted,
    requiresApproval: !canGoLive,
    reviewStatus,
  };
}

async function getTenantOnboardingPayload({ tenantId, userId }) {
  const [progress, review] = await Promise.all([
    getOrCreateOnboardingStatus({ tenantId, userId }),
    getOrCreateOnboardingReview(tenantId),
  ]);

  return buildOnboardingPayload(progress, review);
}

function buildOnboardingBlockedError(onboarding, mode) {
  const singleCallMessage =
    "Tenant onboarding is not approved yet. You can complete one test call before approval, but additional live calling is blocked until admin approval.";
  const bulkMessage =
    "Tenant onboarding is not approved yet. Bulk calling is blocked until admin approval.";

  const err = new Error(mode === "bulk" ? bulkMessage : singleCallMessage);
  err.statusCode = 403;
  err.code = "ONBOARDING_APPROVAL_REQUIRED";
  err.payload = {
    success: false,
    code: "ONBOARDING_APPROVAL_REQUIRED",
    onboarding: onboarding.review,
    canGoLive: !!onboarding.canGoLive,
    message: mode === "bulk" ? bulkMessage : singleCallMessage,
  };
  return err;
}

async function enforceOnboardingForCalling({ tenantId, userId, mode }) {
  const [onboarding, settings] = await Promise.all([
    getTenantOnboardingPayload({ tenantId, userId }),
    ensureTenantSuspensionState(await getOrCreateLicenseSettings(tenantId)),
  ]);
  const onboardingOverride = getOnboardingOverrideState(settings);

  if (onboarding.canGoLive || onboardingOverride.active) {
    return { onboarding, isTestCall: false };
  }

  if (mode === "bulk") {
    throw buildOnboardingBlockedError(onboarding, "bulk");
  }

  const priorSingleCalls = await Call.countDocuments({
    tenantId,
    callType: "single",
  });

  if (priorSingleCalls > 0 || onboarding.steps.testCallCompleted) {
    throw buildOnboardingBlockedError(onboarding, "single");
  }

  return { onboarding, isTestCall: true };
}

async function buildTenantOperationalState({ tenantId, userId, onboarding = null, tenantSettings = null }) {
  const tid = String(tenantId || "default").trim() || "default";

  const [resolvedOnboarding, resolvedSettings, telephonySettings] = await Promise.all([
    onboarding || getTenantOnboardingPayload({ tenantId: tid, userId }),
    tenantSettings || ensureTenantSuspensionState(await getOrCreateLicenseSettings(tid)),
    TelephonySettings.findOne({ tenantId: tid }).lean().catch(() => null),
  ]);

  const tenantOperationalStatus = resolvedSettings?.isEnabled
    ? "active"
    : getTenantLicenseStatus(resolvedSettings);
  const onboardingOverride = getOnboardingOverrideState(resolvedSettings);

  const onboardingApproved =
    onboardingOverride.active ||
    (resolvedOnboarding?.review?.status === "approved" &&
      Boolean(resolvedOnboarding?.review?.approvedForLiveCalling));
  const telephonyVerified = telephonySettings?.verification?.status === "verified";

  return {
    tenantId: tid,
    onboardingApproved,
    onboardingOverride,
    tenantOperationalStatus,
    telephonyVerified,
    canGoLive: Boolean(onboardingApproved && telephonyVerified),
  };
}

async function getTenantAccessSnapshot({
  tenantId,
  userId,
  forceCommercialRefresh = false,
  onboarding = null,
  tenantSettings = null,
}) {
  const tid = String(tenantId || "default").trim() || "default";

  const [commercial, operational] = await Promise.all([
    fetchTenantCommercialStatus(tid, { forceRefresh: forceCommercialRefresh }),
    buildTenantOperationalState({
      tenantId: tid,
      userId,
      onboarding,
      tenantSettings,
    }),
  ]);

  const effectiveAccess = buildTenantAccessState({ commercial, operational });

  return {
    tenantId: tid,
    commercial,
    operational,
    effectiveAccess,
  };
}

async function getOrCreateOnboardingStatus({ tenantId, userId }) {
  const tid = String(tenantId || "default").trim() || "default";

  let doc = await OnboardingStatus.findOne({
    $or: [{ tenantId: tid }, ...(userId ? [{ ownerUserId: userId }, { userId }] : [])],
  });

  if (!doc) {
    return OnboardingStatus.create({
      tenantId: tid,
      ownerUserId: userId,
      userId,
      steps: getDefaultOnboardingSteps(),
    });
  }

  let changed = false;

  if (!doc.tenantId) {
    doc.tenantId = tid;
    changed = true;
  }

  if (userId && !doc.ownerUserId) {
    doc.ownerUserId = userId;
    changed = true;
  }

  if (userId && !doc.userId) {
    doc.userId = userId;
    changed = true;
  }

  const normalizedSteps = normalizeOnboardingSteps(doc.steps || {});
  if (JSON.stringify(doc.steps || {}) !== JSON.stringify(normalizedSteps)) {
    doc.steps = normalizedSteps;
    changed = true;
  }

  if (changed) {
    await doc.save();
  }

  let stepChanged = false;
  const currentSteps = normalizeOnboardingSteps(doc.steps || {});
  const nextSteps = { ...currentSteps };

  const license = await getOrCreateLicenseSettings(tid);
  if (
    !nextSteps.companyInfo &&
    ((license?.client?.companyName &&
      license.client.companyName !== "Unknown") ||
      license?.client?.contactEmail)
  ) {
    nextSteps.companyInfo = true;
    stepChanged = true;
  }

  if (!nextSteps.agentAdded && (doc.ownerUserId || doc.userId || userId)) {
    nextSteps.agentAdded = true;
    stepChanged = true;
  }

  const telephonyFilter = userId
    ? {
        $or: [{ userId }, { tenantId: tid }],
        verified: true,
      }
    : { tenantId: tid, verified: true };
  const verifiedTelephony = await TelephonySettings.findOne(telephonyFilter)
    .select("_id")
    .lean();

  if (!nextSteps.vonageConnected && verifiedTelephony) {
    nextSteps.vonageConnected = true;
    stepChanged = true;
  }

  if (stepChanged) {
    doc.steps = nextSteps;
    await doc.save();
  }

  return doc;
}

async function getOrCreateOnboardingReview(tenantId) {
  const tid = String(tenantId || "default").trim() || "default";
  let doc = await OnboardingReview.findOne({ tenantId: tid });

  if (!doc) {
    doc = await OnboardingReview.create({
      tenantId: tid,
      status: "draft",
    });
  }

  return doc;
}

async function updateOnboardingSteps({ tenantId, userId, updates = {} }) {
  const status = await getOrCreateOnboardingStatus({ tenantId, userId });
  const nextSteps = {
    ...normalizeOnboardingSteps(status.steps || {}),
    ...pickOnboardingStepUpdates(updates),
  };

  if (JSON.stringify(status.steps || {}) !== JSON.stringify(nextSteps)) {
    status.steps = nextSteps;
    if (!status.ownerUserId && userId) status.ownerUserId = userId;
    if (!status.userId && userId) status.userId = userId;
    await status.save();
  }

  return status;
}
/* =========================================================
   LICENSE LIMIT HELPERS
========================================================= */
function enforceCallLimitOrThrow(increment = 1) {
  const payload = global.currentLicensePayload;
  if (!payload) throw new Error("No license loaded");

  const status = String(payload.status || "active").toLowerCase();
  if (status !== "active") {
    throw new Error(`License is ${status}`);
  }

  const limit = Number(payload?.limits?.calls ?? 0);
  const used = Number(payload?.usage?.callsUsed ?? 0);

  if (!limit || Number.isNaN(limit)) return;

  if (used + Number(increment) > limit) {
    throw new Error(`License call limit reached (${used}/${limit})`);
  }
}

/**
 * ✅ Express middleware – blocks disabled tenants
 */
async function enforceAccountEnabled(req, res, next) {
try {
if (!req.user) {
return res.status(401).json({ success: false, message: "Unauthorized" });
}

    // Superadmin bypass so you can re-enable tenants
if (req.user.isSuperAdmin) return next();

const tenantId = req.user.tenantId || "default";
const settings = await ensureTenantSuspensionState(
  await getOrCreateLicenseSettings(tenantId)
);

if (!settings.isEnabled) {
  return res.status(403).json({
    success: false,
    code: "TENANT_DISABLED",
    status: getTenantLicenseStatus(settings),
    reasonCode: settings.suspendReasonCode || "",
    reasonText: settings.suspendReasonText || "",
    disabledUntil: settings.disabledUntil || null,
    message: settings.suspendReason || "Account disabled",
  });
}

const accessState = await getTenantAccessSnapshot({
  tenantId,
  userId: req.user?._id,
  tenantSettings: settings,
});

if (!accessState.effectiveAccess.canLogin) {
  const degraded = accessState.commercial?.degraded;
  return res.status(degraded ? 503 : 403).json({
    success: false,
    code: degraded ? "CONTROL_PLANE_UNAVAILABLE" : "COMMERCIAL_ACCESS_BLOCKED",
    message: degraded
      ? accessState.commercial?.degradedReason || "Control plane is unavailable"
      : "Commercial access is blocked for this tenant",
    data: accessState,
  });
}

return next();

  } catch (err) {
    console.error("Account enable check failed:", err.message);
    return res.status(500).json({
      success: false,
      message: "Account status check failed",
    });
  }
}

/**
 * ✅ Tenant-aware admin override (throw-style)
 * Use this INSIDE routes (not as middleware)
 */
async function enforceAdminLicenseOverrideOrThrow(req) {
  const tenantId = resolveTenantId(req);
  const settings = await ensureTenantSuspensionState(
    await getOrCreateLicenseSettings(tenantId)
  );

  if (!settings.isEnabled) {
    throw new Error(
      settings.suspendReason || "License suspended by administrator"
    );
  }

  return settings;
}


/* =========================================================
   BULK QUEUE PROCESSOR (AUTHORITATIVE)
========================================================= */
// In dialer.js
/* =========================================================
   BULK QUEUE PROCESSOR (AUTHORITATIVE) — FIXED
   - Starts only once (guarded)
   - Properly sets running=true at start and running=false at end
   - Updates Mongo status: queued -> dialing -> initiated/failed
   - Emits callUpdate for BOTH success and failure (so UI moves off "Queued")
   - Supports pause/resume/stop
========================================================= */

async function processBulkQueue() {
  // 1) Guard: don't start twice
  if (isBulkCallRunning) {
    logDebug("⚠️ Bulk campaign already running. Ignoring new start request.");
    return;
  }

  // 2) Initialize state
  isBulkCallRunning = true;
  isBulkCampaignActive = true;
  bulkPaused = false;
  bulkStopped = false;

  // ✅ Tell UI campaign is running
  io.emit("bulkStatusUpdate", { running: true, paused: false, stopped: false });
  logDebug("🚀 Bulk Campaign Started.", { queued: bulkCallQueue.length });

  let successCount = 0;
  let processedCount = 0;

  try {
    // 3) Main loop (authoritative)
    while (isBulkCampaignActive) {
      // STOP check (highest priority)
      if (bulkStopped) {
        logDebug("⛔ Bulk STOP requested.");
        break;
      }

      // PAUSE loop
      while (bulkPaused && !bulkStopped) {
        // keep UI informed while paused
        io.emit("bulkStatusUpdate", { running: true, paused: true, stopped: false });
        await new Promise((r) => setTimeout(r, 500));
      }

      if (bulkStopped) {
        logDebug("⛔ Bulk STOP requested during pause.");
        break;
      }

      // Natural completion
      if (bulkCallQueue.length === 0) {
        logDebug("✅ Bulk queue empty. Campaign completed naturally.");
        break;
      }

      // Process next item
      const item = bulkCallQueue.shift();
      processedCount++;

      const analyticsId = item?.analyticsId;
      const number = item?.number || item?.to;

      if (!analyticsId || !number) {
        console.error("❌ Invalid bulk queue item (missing analyticsId/number):", item);
        continue;
      }

      // Mark as dialing (so UI moves off queued immediately)
      try {
        await Call.findByIdAndUpdate(analyticsId, {
          status: "dialing",
          updatedAt: new Date(),
        });

        const dialingDoc = await Call.findById(analyticsId).lean();
        if (dialingDoc) io.emit("callUpdate", dialingDoc);
      } catch (e) {
        logWarnDebug("⚠️ Failed to mark call as dialing (non-blocking):", e?.message || e);
      }

      try {
        logDebug(`📞 Dialing ${processedCount}/${processedCount + bulkCallQueue.length}...`, {
          number,
          analyticsId,
        });

        const call = await initiateCall(number, {
          callId: analyticsId,
          type: "bulk",
          tenantId: item.tenantId || null,
        });

        const uuid = call?.uuid || call?.data?.uuid || null;

        await Call.findByIdAndUpdate(analyticsId, {
          uuid,
          status: "initiated",
          updatedAt: new Date(),
        });

        const initiatedDoc = await Call.findById(analyticsId).lean();
        if (initiatedDoc) io.emit("callUpdate", initiatedDoc);

        successCount++;
      } catch (err) {
        console.error(`❌ Failed to dial ${number}:`, err?.message || err);

        await Call.findByIdAndUpdate(analyticsId, {
          status: "failed",
          error: err?.message || String(err),
          updatedAt: new Date(),
        });

        const failedDoc = await Call.findById(analyticsId).lean();
        if (failedDoc) io.emit("callUpdate", failedDoc);
      }

      // Progress update
      io.emit("bulkProgress", {
        current: processedCount,
        total: processedCount + bulkCallQueue.length,
        success: successCount,
      });

      // Delay between calls (respect settings)
      await new Promise((r) =>
        setTimeout(r, Number(dialerSettings?.bulkDelayMs || 1500))
      );
    }
  } catch (err) {
    console.error("🚨 Fatal error in bulk processor loop:", err);
  } finally {
    // 4) Cleanup
    logDebug("🛑 Bulk Campaign Finished. Resetting state.", {
      processed: processedCount,
      success: successCount,
      remaining: bulkCallQueue.length,
      stopped: bulkStopped,
    });

    isBulkCallRunning = false;
    isBulkCampaignActive = false;
    bulkPaused = false;

    // ✅ Tell UI campaign is OVER
    io.emit("bulkStatusUpdate", { running: false, paused: false, stopped: !!bulkStopped });

    io.emit("bulkComplete", {
      success: successCount,
      total: processedCount,
      stopped: !!bulkStopped,
    });
  }
}
/* =========================================================
   ROUTES
========================================================= */
/* =========================================================
   ONBOARDING STATUS
========================================================= */
app.get("/api/onboarding/status", authMiddleware, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.user?._id?.toString() || "default";
    const status = await getOrCreateOnboardingStatus({
      tenantId,
      userId: req.user._id,
    });
    const review = await getOrCreateOnboardingReview(tenantId);
    const payload = buildOnboardingPayload(status, review);

    return res.json({
      success: true,
      steps: payload.steps,
      data: payload,
      review: payload.review,
      canGoLive: payload.canGoLive,
    });
  } catch (err) {
    console.error("Onboarding status error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load onboarding status"
    });
  }
});

app.post("/api/onboarding/steps", authMiddleware, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.user?._id?.toString() || "default";
    const incomingSteps =
      req.body?.steps && typeof req.body.steps === "object" ? req.body.steps : {};
    const incomingKeys = Object.keys(incomingSteps);
    const invalidKeys = incomingKeys.filter(
      (key) => !TENANT_EDITABLE_ONBOARDING_STEPS.includes(key)
    );

    if (invalidKeys.length > 0) {
      return res.status(400).json({
        success: false,
        message:
          "Those onboarding steps are system-managed and cannot be updated manually.",
        invalidSteps: invalidKeys,
      });
    }

    const review = await getOrCreateOnboardingReview(tenantId);
    const status = await updateOnboardingSteps({
      tenantId,
      userId: req.user._id,
      updates: incomingSteps,
    });

    return res.json({
      success: true,
      message: "Onboarding progress saved",
      data: buildOnboardingPayload(status, review),
    });
  } catch (err) {
    console.error("Onboarding update error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to save onboarding progress",
    });
  }
});

app.post("/api/onboarding/submit", authMiddleware, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.user?._id?.toString() || "default";
    const status = await getOrCreateOnboardingStatus({
      tenantId,
      userId: req.user._id,
    });
    const review = await getOrCreateOnboardingReview(tenantId);
    const payload = buildOnboardingPayload(status, review);

    if (!payload.canSubmitForReview) {
      return res.status(400).json(
        buildOnboardingValidationError(
          payload.steps,
          "Complete the remaining required onboarding steps before submitting for admin review. Vonage can be connected after approval.",
          payload.missingReviewBlockingSteps
        )
      );
    }

    status.submittedForReviewAt = new Date();
    status.lastSubmittedBy = req.user._id;

    if (review.status !== "approved") {
      review.status = "pending_review";
      review.submittedAt = new Date();
      review.reviewedAt = null;
      review.reviewedBy = null;
      review.adminNotes = "";
      review.requiredChanges = [];
      review.approvedForLiveCalling = false;
      review.approvedForBilling = false;
    }

    await status.save();
    await review.save();

    return res.json({
      success: true,
      message: "Onboarding submitted for review",
      data: buildOnboardingPayload(status, review),
    });
  } catch (err) {
    console.error("Onboarding submit error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to submit onboarding for review",
    });
  }
});

app.get("/api/admin/onboarding/queue", authMiddleware, adminOnly, async (req, res) => {
  try {
    const requestedStatuses =
      typeof req.query?.status === "string" && req.query.status.trim()
        ? req.query.status
            .split(",")
            .map((value) => value.trim())
            .filter((value) => ONBOARDING_REVIEW_STATUSES.includes(value))
        : ["pending_review", "changes_requested"];

    const reviews = await OnboardingReview.find({
      status: { $in: requestedStatuses },
    }).sort({ submittedAt: -1, updatedAt: -1 });

    const tenantIds = reviews.map((item) => item.tenantId);
    const [statuses, tenants] = await Promise.all([
      OnboardingStatus.find({ tenantId: { $in: tenantIds } }),
      LicenseSettings.find({ tenantId: { $in: tenantIds } }),
    ]);

    const statusMap = new Map(statuses.map((doc) => [doc.tenantId, doc]));
    const tenantMap = new Map(tenants.map((doc) => [doc.tenantId, doc]));

    const queue = reviews.map((review) => {
      const progress = statusMap.get(review.tenantId) || null;
      const license = tenantMap.get(review.tenantId) || null;
      const payload = buildOnboardingPayload(progress, review);

      return {
        tenantId: review.tenantId,
        companyName: license?.client?.companyName || "Unknown",
        contactEmail: license?.client?.contactEmail || "",
        plan: license?.plan || "standard",
        status: payload.review.status,
        submittedAt: payload.review.submittedAt,
        reviewedAt: payload.review.reviewedAt,
        completion: payload.completion,
        canGoLive: payload.canGoLive,
      };
    });

    return res.json({ success: true, queue });
  } catch (err) {
    console.error("Onboarding queue error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load onboarding queue",
    });
  }
});

app.get("/api/admin/onboarding", authMiddleware, adminOnly, async (req, res) => {
  try {
    const tenantId = String(req.query?.tenantId || "").trim();

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenantId is required",
      });
    }

    const [status, review, license] = await Promise.all([
      getOrCreateOnboardingStatus({ tenantId }),
      getOrCreateOnboardingReview(tenantId),
      getOrCreateLicenseSettings(tenantId),
    ]);

    return res.json({
      success: true,
      data: {
        ...buildOnboardingPayload(status, review),
        tenant: {
          tenantId,
          companyName: license?.client?.companyName || "Unknown",
          contactEmail: license?.client?.contactEmail || "",
          plan: license?.plan || "standard",
          licenseId: license?.client?.licenseId || `vynce-${tenantId}`,
        },
      },
    });
  } catch (err) {
    console.error("Onboarding detail error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load onboarding details",
    });
  }
});

app.post("/api/admin/onboarding/review", authMiddleware, adminOnly, async (req, res) => {
  try {
    const tenantId = String(req.body?.tenantId || "").trim();
    const action = String(req.body?.action || "").trim();
    const adminNotes = String(req.body?.adminNotes || "").trim();
    const requiredChanges = Array.isArray(req.body?.requiredChanges)
      ? req.body.requiredChanges
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [];

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenantId is required",
      });
    }

    if (!ONBOARDING_REVIEW_ACTIONS.includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid onboarding review action",
      });
    }

    const [status, review] = await Promise.all([
      getOrCreateOnboardingStatus({ tenantId }),
      getOrCreateOnboardingReview(tenantId),
    ]);

    review.reviewedAt = new Date();
    review.reviewedBy = req.user._id;
    review.adminNotes = adminNotes;

    if (action === "approve") {
      const payload = buildOnboardingPayload(status, review);
      if (!payload.canSubmitForReview) {
        return res.status(400).json(
          buildOnboardingValidationError(
            payload.steps,
            "This tenant cannot be approved yet because required onboarding steps are still incomplete. Vonage may remain pending, but the rest of onboarding must be complete.",
            payload.missingReviewBlockingSteps
          )
        );
      }

      review.status = "approved";
      review.requiredChanges = [];
      review.approvedForLiveCalling = true;
      review.approvedForBilling = true;
    } else if (action === "request_changes") {
      review.status = "changes_requested";
      review.requiredChanges = requiredChanges;
      review.approvedForLiveCalling = false;
      review.approvedForBilling = false;
    } else {
      review.status = "rejected";
      review.requiredChanges = requiredChanges;
      review.approvedForLiveCalling = false;
      review.approvedForBilling = false;
    }

    await review.save();

    return res.json({
      success: true,
      message: "Onboarding review updated",
      data: buildOnboardingPayload(status, review),
    });
  } catch (err) {
    console.error("Onboarding review error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update onboarding review",
    });
  }
});

/* ---------------- ADMIN TENANT LIST ---------------- */
app.post("/api/admin/tenants", authMiddleware, adminOnly, async (req, res) => {
  try {
    const requestedTenantId = String(req.body?.tenantId || "")
      .trim()
      .toLowerCase();
    const companyName = String(req.body?.companyName || "").trim() || "Unknown";
    const contactEmail = String(req.body?.contactEmail || "").trim();
    const requestedPlan = String(req.body?.plan || "professional")
      .trim()
      .toLowerCase();
    const issueLicense = req.body?.issueLicense === true;
    const issueOptions = req.body?.issueOptions || {};

    const TENANT_ID_REGEX = /^[a-z0-9][a-z0-9_-]{2,63}$/;

    const slugifyTenantSeed = (value) =>
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-{2,}/g, "-")
        .slice(0, 40);

    const createAutoTenantIdBase = () => {
      const seed = slugifyTenantSeed(companyName) || "client";
      const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const base = `tenant_${seed}_${datePart}`;
      return base.slice(0, 64);
    };

    const ensureTenantIdFormat = (candidate) => {
      const value = String(candidate || "")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "_")
        .replace(/^[_-]+/, "")
        .slice(0, 64);

      if (!value) return "tenant_default";
      if (/^[a-z0-9]/.test(value)) return value;
      return `tenant_${value}`.slice(0, 64);
    };

    const generateUniqueTenantId = async (baseCandidate) => {
      const base = ensureTenantIdFormat(baseCandidate);
      if (TENANT_ID_REGEX.test(base)) {
        const exists = await LicenseSettings.exists({ tenantId: base });
        if (!exists) return base;
      }

      for (let i = 0; i < 16; i += 1) {
        const suffix = Math.random().toString(36).slice(2, 8);
        const candidate = `${base.slice(0, 57)}_${suffix}`.slice(0, 64);
        if (!TENANT_ID_REGEX.test(candidate)) continue;
        const exists = await LicenseSettings.exists({ tenantId: candidate });
        if (!exists) return candidate;
      }

      throw new Error("Unable to auto-generate a unique tenantId.");
    };

    let rawTenantId = requestedTenantId;
    if (!rawTenantId) {
      rawTenantId = await generateUniqueTenantId(createAutoTenantIdBase());
    }

    if (!TENANT_ID_REGEX.test(rawTenantId)) {
      return res.status(400).json({
        success: false,
        message:
          "tenantId must be 3-64 chars and contain only lowercase letters, numbers, underscores, or hyphens.",
      });
    }

    if (contactEmail && !/^\S+@\S+\.\S+$/.test(contactEmail)) {
      return res.status(400).json({
        success: false,
        message: "contactEmail must be a valid email when provided.",
      });
    }

    const allowedPlans = new Set(["development", "professional", "enterprise"]);
    const normalizedPlan = allowedPlans.has(requestedPlan)
      ? requestedPlan
      : "professional";

    const existing = await LicenseSettings.findOne({ tenantId: rawTenantId }).lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        message: "A tenant with this tenantId already exists.",
      });
    }

    const settings = await getOrCreateLicenseSettings(rawTenantId);
    settings.plan = normalizedPlan;
    settings.client = settings.client || {};
    settings.client.companyName = companyName;
    settings.client.contactEmail = contactEmail;
    settings.client.tenantId = rawTenantId;
    settings.client.licenseId = settings.client.licenseId || `vynce-${rawTenantId}`;
    settings.updatedBy = {
      userId: req.user._id,
      email: req.user.email,
      role: req.user.role,
    };
    await settings.save();

    await Promise.all([
      getOrCreateOnboardingStatus({ tenantId: rawTenantId }),
      getOrCreateOnboardingReview(rawTenantId),
    ]);

    await LicenseAuditLog.create({
      action: "TENANT_CREATED",
      performedBy: {
        userId: req.user._id,
        email: req.user.email,
        role: req.user.role,
      },
      target: {
        companyName,
        tenantId: rawTenantId,
        licenseId: settings.client?.licenseId || `vynce-${rawTenantId}`,
      },
      before: null,
      after: {
        tenantId: rawTenantId,
        companyName,
        contactEmail,
        plan: normalizedPlan,
      },
    });

    let issuedLicense = null;
    let licenseIssueError = null;
    if (issueLicense) {
      const requestedMaxActivations = issueOptions?.maxActivations;
      const requestedIncludedUsers = issueOptions?.includedUsers;
      const requestedExtraSeats = issueOptions?.extraSeats;
      const requestedExpiresAt = issueOptions?.expiresAt;
      const requestedReason = String(
        issueOptions?.reason || "Tenant commercial onboarding"
      ).trim();
      const requestedPerformedBy = String(
        issueOptions?.performedBy || req.user?.email || "vynce-admin"
      ).trim();

      const normalizedMaxActivations = Number.isFinite(Number(requestedMaxActivations))
        ? Math.max(1, Math.floor(Number(requestedMaxActivations)))
        : 1;
      const normalizedIncludedUsers = Number.isFinite(Number(requestedIncludedUsers))
        ? Math.max(1, Math.floor(Number(requestedIncludedUsers)))
        : 1;
      const normalizedExtraSeats = Number.isFinite(Number(requestedExtraSeats))
        ? Math.max(0, Math.floor(Number(requestedExtraSeats)))
        : 0;

      let normalizedExpiresAt = null;
      if (requestedExpiresAt) {
        const parsed = new Date(requestedExpiresAt);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({
            success: false,
            code: "INVALID_LICENSE_EXPIRY",
            message: "expiresAt must be a valid ISO date when provided.",
          });
        }
        normalizedExpiresAt = parsed.toISOString();
      }

      const issueResult = await issueTenantLicenseKey(rawTenantId, {
        plan: normalizedPlan,
        maxActivations: normalizedMaxActivations,
        includedUsers: normalizedIncludedUsers,
        extraSeats: normalizedExtraSeats,
        expiresAt: normalizedExpiresAt,
        performedBy: requestedPerformedBy || "vynce-admin",
        reason: requestedReason || "Tenant commercial onboarding",
        source: "vynce-admin-license",
      });

      if (!issueResult.success) {
        licenseIssueError = {
          code: issueResult.code || "LICENSE_ISSUE_FAILED",
          message: normalizeIssueErrorMessage(issueResult),
          statusCode: Number(issueResult.statusCode || 500),
        };
      } else {
        await LicenseAuditLog.create({
          action: "LICENSE_ISSUED",
          performedBy: {
            userId: req.user._id,
            email: req.user.email,
            role: req.user.role,
          },
          target: {
            companyName,
            tenantId: rawTenantId,
            licenseId: issueResult.licenseId || settings.client?.licenseId || `vynce-${rawTenantId}`,
          },
          before: {
            plan: normalizedPlan,
          },
          after: {
            plan: normalizedPlan,
            maxActivations: normalizedMaxActivations,
            includedUsers: normalizedIncludedUsers,
            extraSeats: normalizedExtraSeats,
            expiresAt: normalizedExpiresAt,
            reason: requestedReason || "Tenant commercial onboarding",
          },
        });

        issuedLicense = {
          tenantId: rawTenantId,
          licenseId: issueResult.licenseId,
          licenseKey: issueResult.licenseKey,
          oneTimeDisplay: true,
          issuedAt: new Date().toISOString(),
          plan: normalizedPlan,
          maxActivations: normalizedMaxActivations,
          includedUsers: normalizedIncludedUsers,
          extraSeats: normalizedExtraSeats,
          expiresAt: normalizedExpiresAt,
        };
      }
    }

    return res.status(201).json({
      success: true,
      message:
        issueLicense && issuedLicense
          ? "Tenant created and license key issued successfully."
          : issueLicense
            ? "Tenant created, but license key issuance failed. Retry issuing from tenant details."
            : "Tenant created successfully.",
      data: {
        tenant: {
          tenantId: rawTenantId,
          companyName,
          contactEmail,
          plan: normalizedPlan,
          licenseId: settings.client?.licenseId || `vynce-${rawTenantId}`,
          status: getTenantLicenseStatus(settings),
          isEnabled: !!settings.isEnabled,
        },
        issuedLicense,
        licenseIssueError,
      },
    });
  } catch (err) {
    console.error("Create tenant error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to create tenant",
    });
  }
});

app.get("/api/admin/tenants", authMiddleware, adminOnly, async (req, res) => {
  try {
    const includeCommercial =
      String(req.query?.includeCommercial || "false").toLowerCase() === "true";

    const withTimeout = (promise, ms, label = "operation") =>
      Promise.race([
        promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        ),
      ]);

    const rows = await LicenseSettings.find({})
      .select(
        "tenantId client plan isEnabled suspendReason suspendReasonCode suspendReasonText disabledUntil updatedAt createdAt"
      )
      .sort({ updatedAt: -1 });

    const normalizedRows = await Promise.all(
      rows.map(async (row) => {
        try {
          return await ensureTenantSuspensionState(row);
        } catch (e) {
          console.warn("[admin/tenants] ensureTenantSuspensionState failed:", e?.message || e);
          return row;
        }
      })
    );

    const tenantResults = await Promise.allSettled(
      normalizedRows.map(async (doc) => {
        const tenantId = doc?.tenantId || "default";
        let accessState = null;

        if (includeCommercial) {
          try {
            accessState = await withTimeout(
              getTenantAccessSnapshot({ tenantId }),
              2500,
              "tenant access snapshot (" + tenantId + ")"
            );
          } catch (snapErr) {
            console.warn(
              "[admin/tenants] accessState failed for " + tenantId + ":",
              snapErr?.message || snapErr
            );
          }
        }

        return {
          tenantId,
          companyName: doc?.client?.companyName || "Unknown",
          licenseId: doc?.client?.licenseId || ("vynce-" + tenantId),
          contactEmail: doc?.client?.contactEmail || "",
          plan: doc?.plan || "standard",
          isEnabled: !!doc?.isEnabled,
          status: getTenantLicenseStatus(doc),
          reasonCode: doc?.suspendReasonCode || "",
          reasonText: doc?.suspendReasonText || "",
          disabledUntil: doc?.disabledUntil || null,
          updatedAt: doc?.updatedAt || null,
          createdAt: doc?.createdAt || null,
          commercial: accessState?.commercial || null,
          commercialBlocked: accessState ? !accessState.effectiveAccess.canLogin : false,
          effectiveAccess: accessState?.effectiveAccess || null,
        };
      })
    );

    const tenants = tenantResults
      .filter((item) => item.status === "fulfilled")
      .map((item) => item.value);

    return res.json({ success: true, tenants });
  } catch (err) {
    console.error("Tenant list error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load tenants",
      error: err?.message || "unknown_error",
    });
  }
});

app.post(
  "/api/telephony/vonage/verify",
  authMiddleware,
  async (req, res) => {
    const checkedAt = new Date();
    const {
      apiKey,
      apiSecret,
      applicationId,
      privateKey,
      preferredNumber,
      webhookSecret,
    } = req.body;

    const persistFailure = async (verification) => {
      await TelephonySettings.findOneAndUpdate(
        {
          $or: [{ tenantId: req.user.tenantId }, { userId: req.user._id }],
        },
        {
          tenantId: req.user.tenantId,
          userId: req.user._id,
          provider: "vonage",
          verified: false,
          verification,
          updatedAt: checkedAt,
        },
        { upsert: true, new: true }
      );
    };

    try {
      if (!apiKey || !apiSecret || !applicationId || !privateKey) {
        const verification = buildVonageVerificationPayload({
          ok: false,
          code: "MISSING_CREDENTIALS",
          message: "Missing Vonage credentials",
          checkedAt,
          account: {
            apiKeyMasked: maskValue(apiKey),
            applicationId: applicationId || "",
          },
        });
        await persistFailure(verification);

        return res.status(400).json({
          success: false,
          message: "Missing Vonage credentials",
          verification,
        });
      }

      const normalizedWebhookSecret = String(webhookSecret || "").trim();
      const effectiveWebhookSecret = normalizedWebhookSecret || VONAGE_API_SIGNATURE_SECRET;

      if (VONAGE_SIGNED_WEBHOOKS_REQUIRED && !effectiveWebhookSecret) {
        const verification = buildVonageVerificationPayload({
          ok: false,
          code: "MISSING_WEBHOOK_SECRET",
          message: "A Vonage webhook signature secret is required for production webhook verification.",
          checkedAt,
          account: {
            apiKeyMasked: maskValue(apiKey),
            applicationId,
          },
          checks: {
            credentials: true,
            application: true,
            numbers: false,
            preferredNumber: false,
            webhookSignature: false,
          },
        });
        await persistFailure(verification);

        return res.status(400).json({
          success: false,
          message: verification.message,
          verification,
        });
      }

      // Initialize Vonage client
      const vonage = new Vonage({
        apiKey,
        apiSecret,
        applicationId,
        privateKey
      });

      // 🔎 Test API access (cheap + fast)
      const numbersResponse = await vonage.numbers.getOwnedNumbers({
        size: 10
      });

      if (
        !numbersResponse.numbers ||
        numbersResponse.numbers.length === 0
      ) {
        const verification = buildVonageVerificationPayload({
          ok: false,
          code: "NO_NUMBERS",
          message: "No voice-enabled Vonage numbers found",
          checkedAt,
          account: {
            apiKeyMasked: maskValue(apiKey),
            applicationId,
          },
          checks: {
            credentials: true,
            application: true,
            numbers: false,
            preferredNumber: false,
            webhookSignature: !!effectiveWebhookSecret,
          },
        });
        await persistFailure(verification);

        return res.status(400).json({
          success: false,
          message: "No voice-enabled Vonage numbers found",
          verification,
        });
      }

      // Optional: Validate preferred number
      const matchedNumber = preferredNumber
        ? numbersResponse.numbers.find(
            (n) => n.msisdn === preferredNumber.replace("+", "")
          )
        : numbersResponse.numbers[0];

      if (!matchedNumber) {
        const verification = buildVonageVerificationPayload({
          ok: false,
          code: "PREFERRED_NUMBER_NOT_FOUND",
          message: "Preferred number not found in Vonage account",
          checkedAt,
          account: {
            apiKeyMasked: maskValue(apiKey),
            applicationId,
          },
          checks: {
            credentials: true,
            application: true,
            numbers: true,
            preferredNumber: false,
            webhookSignature: !!effectiveWebhookSecret,
          },
          context: {
            preferredNumber,
          },
        });
        await persistFailure(verification);

        return res.status(400).json({
          success: false,
          message: "Preferred number not found in Vonage account",
          verification,
        });
      }

      const verification = buildVonageVerificationPayload({
        ok: true,
        code: "VERIFIED",
        message: "Vonage credentials verified successfully.",
        checkedAt,
        account: {
          apiKeyMasked: maskValue(apiKey),
          applicationId,
          outboundNumber: `+${matchedNumber.msisdn}`,
          label: process.env.VONAGE_PLAN_NAME || "Vonage Voice Account",
        },
        checks: {
          credentials: true,
          application: true,
          numbers: true,
          preferredNumber: true,
          webhookSignature: !!effectiveWebhookSecret,
        },
      });

      // 🔐 Save encrypted settings (example)
      await TelephonySettings.findOneAndUpdate(
  {
    $or: [
      { tenantId: req.user.tenantId },
      { userId: req.user._id },
    ],
  },
  {
    tenantId: req.user.tenantId,   // ✅ ensure stored
    userId: req.user._id,          // ✅ ensure stored
    provider: "vonage",
    apiKey,
    apiSecret,
    applicationId,
    privateKey, // encrypt later
    webhookSecret: effectiveWebhookSecret,
    outboundNumber: `+${matchedNumber.msisdn}`,
    verified: true,
    verification,
    updatedAt: new Date(),
  },
  { upsert: true, new: true }
);

      try {
        await updateOnboardingSteps({
          tenantId: req.user.tenantId,
          userId: req.user._id,
          updates: {
            vonageConnected: true,
            settingsConfigured: true,
          },
        });
      } catch (e) {
        logErrorDebug("Onboarding telephony update failed:", e.message);
      }

      return res.json({
        success: true,
        verified: true,
        verification,
        numbers: numbersResponse.numbers.map((n) => ({
          number: `+${n.msisdn}`,
          country: n.country,
          features: n.features
        })),
        account: verification.account,
      });
    } catch (err) {
      console.error("Vonage verification failed:", err);

      const statusMatch = /HTTP\s+(\d+)/i.exec(String(err?.message || ""));
      const httpStatus = statusMatch ? Number(statusMatch[1]) : null;
      const code =
        httpStatus === 401 || httpStatus === 403
          ? "AUTH_FAILED"
          : "APPLICATION_INVALID";
      const verification = buildVonageVerificationPayload({
        ok: false,
        code,
        message: err.message || "Failed to verify Vonage credentials",
        checkedAt,
        account: {
          apiKeyMasked: maskValue(apiKey),
          applicationId: applicationId || "",
        },
        checks: {
          credentials: false,
          application: false,
          numbers: false,
          preferredNumber: false,
          webhookSignature: Boolean(webhookSecret || VONAGE_API_SIGNATURE_SECRET),
        },
        context: {
          httpStatus,
        },
      });

      try {
        await persistFailure(verification);
      } catch (persistErr) {
        logErrorDebug("Vonage verification persistence failed:", persistErr.message);
      }

      return res.status(500).json({
        success: false,
        message: "Failed to verify Vonage credentials",
        verification,
      });
    }
  }
);


/* ---------------- HEALTH ---------------- */
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    message: "Vynce backend running",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/* ---------------- CONTROL PLANE DIAGNOSTIC (admin only) ---------------- */
app.get("/api/admin/control-plane/status", authMiddleware, adminOnly, async (req, res) => {
  const { getControlPlaneConfig } = await import("./services/controlPlaneClient.js");
  const config = getControlPlaneConfig();
  const configured = Boolean(config.baseUrl && config.apiSecret);

  if (!configured) {
    return res.status(503).json({
      success: false,
      configured: false,
      baseUrl: config.baseUrl || null,
      hasSecret: Boolean(config.apiSecret),
      message: "Control plane is NOT configured on this backend. Set CONTROL_PLANE_BASE_URL and CONTROL_PLANE_ADMIN_SECRET (or CONTROL_PLANE_API_SECRET) in Render environment variables.",
    });
  }

  try {
    const { controlPlaneClient } = await import("./services/controlPlaneClient.js");
    const result = await controlPlaneClient.request("GET", "/api/health", { timeoutMs: 5000 });
    return res.json({
      success: true,
      configured: true,
      baseUrl: config.baseUrl,
      hasSecret: true,
      reachable: true,
      controlPlaneResponse: result,
    });
  } catch (err) {
    return res.status(502).json({
      success: false,
      configured: true,
      baseUrl: config.baseUrl,
      hasSecret: true,
      reachable: false,
      error: err?.message || "Control plane unreachable",
      code: err?.code || "CONTROL_PLANE_UNAVAILABLE",
    });
  }
});

app.get("/api/ready", (req, res) => {
  const mongoConnected = mongoose.connection.readyState === 1;
  const corsConfigured = Boolean(process.env.CORS_ORIGIN);
  const webhookConfigured = Boolean(publicWebhookUrl);
  const controlPlaneConfigured = USE_CONTROL_PLANE_SOURCE
    ? Boolean(CONTROL_PLANE_BASE_URL) && Boolean(CONTROL_PLANE_API_SECRET)
    : true;
  const controlPlaneTimeoutConfigured = USE_CONTROL_PLANE_SOURCE
    ? Number.isFinite(CONTROL_PLANE_TIMEOUT_MS) && CONTROL_PLANE_TIMEOUT_MS > 0
    : true;
  const vonageConfigured =
    !VONAGE_GLOBAL_ENV_PARTIALLY_CONFIGURED ||
    (
      Boolean(process.env.VONAGE_API_KEY) &&
      Boolean(process.env.VONAGE_API_SECRET) &&
      Boolean(process.env.VONAGE_APPLICATION_ID) &&
      Boolean(process.env.VONAGE_PRIVATE_KEY_PATH)
    );
  const signedWebhookSecretConfigured = Boolean(VONAGE_API_SIGNATURE_SECRET);
  const supportWebhookSecretConfigured = Boolean(SUPPORT_PROVIDER_WEBHOOK_SECRET);
  const licenseConfigured = USE_CONTROL_PLANE_SOURCE
    ? true
    : Boolean(process.env.VYNCE_LICENSE_TOKEN) &&
      Boolean(process.env.VYNCE_ACTIVATION_ID);
  const productionReadyChecks = {
    mongoConnected,
    corsConfigured,
    webhookConfigured,
    controlPlaneConfigured,
    controlPlaneTimeoutConfigured,
    vonageConfigured,
    signedWebhookSecretConfigured,
    supportWebhookSecretConfigured,
    licenseConfigured,
  };
  const allChecksPassing = Object.values(productionReadyChecks).every(Boolean);
  const status = OFFLINE_MODE
    ? "offline-ready"
    : allChecksPassing
      ? "ready"
      : "degraded";

  res.status(allChecksPassing || OFFLINE_MODE ? 200 : 503).json({
    success: allChecksPassing || OFFLINE_MODE,
    status,
    nodeEnv: process.env.NODE_ENV || "development",
    offlineMode: OFFLINE_MODE,
    licenseSource: LICENSE_SOURCE,
    checks: productionReadyChecks,
    timestamp: new Date().toISOString(),
  });
});

/* =========================================================
   AUTH
========================================================= */

/* ---------------- REGISTER ---------------- */
async function rollbackFailedTenantRegistration({ userId = null, tenantId = "" } = {}) {
  const tid = String(tenantId || "").trim();

  await Promise.allSettled([
    userId ? User.deleteOne({ _id: userId }) : Promise.resolve(),
    tid ? LicenseSettings.deleteOne({ tenantId: tid }) : Promise.resolve(),
    tid ? OnboardingStatus.deleteMany({ tenantId: tid }) : Promise.resolve(),
    tid ? OnboardingReview.deleteMany({ tenantId: tid }) : Promise.resolve(),
  ]);
}

app.post("/api/auth/register", async (req, res) => {
  let createdUser = null;
  let createdTenantId = "";

  try {
    let { firstName, lastName, email, password, plan, company } = req.body;

    firstName = String(firstName || "").trim();
    lastName = String(lastName || "").trim();
    email = String(email || "").trim().toLowerCase();
    password = String(password || "");
    company = String(company || "").trim();

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "First name, last name, email, and password are required",
      });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const subscriptionPlan = normalizePlanKey(plan || "professional");

    // ✅ Always generate a unique tenantId
    const tenantId = `tenant_${crypto.randomUUID()}`;
    createdTenantId = tenantId;

    const user = await User.create({
      firstName,
      lastName,
      email,
      passwordHash,
      company,
      tenantId,
      subscription: buildUserSubscription(subscriptionPlan),
      role: "customer",
      isSuperAdmin: false,
    });
    createdUser = user;

    // ✅ Ensure LicenseSettings exists (admin enable/disable will work instantly)
  // ✅ Ensure LicenseSettings exists (admin enable/disable will work instantly)
try {
  const ls = await getOrCreateLicenseSettings(tenantId);

  let changed = false;
  if (!ls.client.companyName || ls.client.companyName === "Unknown") {
    ls.client.companyName = company || `${firstName} ${lastName}`.trim();
    changed = true;
  }
  if (!ls.client.contactEmail) {
    ls.client.contactEmail = email;
    changed = true;
  }
  if (!ls.client.tenantId) {
    ls.client.tenantId = tenantId;
    changed = true;
  }
  if (!ls.client.licenseId) {
    ls.client.licenseId = `vynce-${tenantId}`;
    changed = true;
  }
  if (changed) await ls.save();
  const licenseSync = await syncTenantLicenseState(tenantId, {
    plan: ls.plan,
    isEnabled: ls.isEnabled,
    source: "vynce-register",
  });

  if (!licenseSync?.success) {
    const provisioningError = new Error(
      licenseSync?.message ||
        "Commercial provisioning could not be completed for this tenant."
    );
    provisioningError.statusCode =
      licenseSync?.statusCode ||
      (licenseSync?.code === "CONTROL_PLANE_NOT_CONFIGURED" ? 503 : 502);
    provisioningError.code =
      licenseSync?.code || "COMMERCIAL_PROVISIONING_FAILED";
    throw provisioningError;
  }
} catch (e) {
  throw e;
}

try {
  await updateOnboardingSteps({
    tenantId,
    userId: user._id,
    updates: {
      companyInfo: Boolean(company),
      agentAdded: true,
    },
  });
  await getOrCreateOnboardingReview(tenantId);
} catch (e) {
  logErrorDebug("Onboarding init failed (non-blocking):", e.message);
}

const accessToken = signAccessToken(user);

// 🔄 REFRESH TOKEN
const rawRefresh = createRefreshToken();
const tokenHash = hashToken(rawRefresh);
const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);

user.refreshTokens = user.refreshTokens || [];
user.refreshTokens.push({
  tokenHash,
  expiresAt,
  createdAt: new Date(),
  lastUsedAt: new Date(),
  userAgent: req.get("user-agent") || "",
  ip: req.ip || "",
});

await user.save();

// 🍪 COOKIE (SINGLE SOURCE OF TRUTH)
res.cookie("vynce_refresh", rawRefresh, refreshCookieOptions());

logDebug("🍪 Register: refresh cookie SET");

return res.json({
  success: true,
  token: accessToken,
  user: userToSafeObject(user),
});

  } catch (err) {
    if (createdUser?._id || createdTenantId) {
      try {
        await rollbackFailedTenantRegistration({
          userId: createdUser?._id || null,
          tenantId: createdTenantId,
        });
      } catch (rollbackErr) {
        console.error("Registration rollback failed:", rollbackErr);
      }
    }

    console.error("Register error:", err);
    return res.status(err?.statusCode || 500).json({
      success: false,
      code: err?.code || "REGISTRATION_FAILED",
      message: err?.message || "Server error during registration",
    });
  }
});

/* ---------------- AUTH ME ---------------- */
app.get("/api/auth/me", authMiddleware, (req, res) => {
  res.json({ success: true, user: userToSafeObject(req.user) });
});

/* ---------------- LOGIN (POST ONLY) ---------------- */
/* =========================================================
   AUTH ROUTES (OFFLINE SAFE)
========================================================= */

app.post("/api/auth/login", async (req, res) => {
  try {
    let { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    email = email.toLowerCase().trim();

    const user = await User.findOne({ email }).select("+passwordHash");

    if (!user || !user.passwordHash) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // ✅ ADD: CHECK IF USER IS DISABLED
    if (user.isDisabled === true) {
      logWarnDebug("🔒 LOGIN ATTEMPT BLOCKED: User is disabled", {
        email: user.email,
        userId: user._id,
        disabledAt: user.updatedAt,
      });

      return res.status(403).json({
        success: false,
        message: "Account disabled by administrator. Contact support.",
      });
    }
// Tenant-wide disable check (after password is valid)
try {
const settings = await ensureTenantSuspensionState(
await getOrCreateLicenseSettings(user.tenantId || "default")
);
if (!user.isSuperAdmin && !settings.isEnabled) {
logWarnDebug("🚫 Login blocked: tenant disabled", {
userId: user._id,
tenantId: user.tenantId,
});
return res.status(403).json({
success: false,
code: "TENANT_DISABLED",
status: getTenantLicenseStatus(settings),
reasonCode: settings.suspendReasonCode || "",
reasonText: settings.suspendReasonText || "",
disabledUntil: settings.disabledUntil || null,
message: settings.suspendReason || "Account disabled by administrator.",
});
}
} catch (e) {
console.error("License check failed during login:", e.message);
return res.status(500).json({
success: false,
message: "Login failed (license check)",
});
}
    logDebug("🔐 LOGIN DEBUG", {
      email,
      hasUser: !!user,
      hasPasswordHash: !!user?.passwordHash,
      isDisabled: user.isDisabled, // 👈 now logged for visibility
    });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    const tenantAccess = await getTenantAccessSnapshot({
      tenantId: user.tenantId || "default",
      userId: user._id,
      forceCommercialRefresh: true,
    });

    if (!tenantAccess.effectiveAccess.canLogin) {
      const degraded = tenantAccess.commercial?.degraded;
      return res.status(degraded ? 503 : 403).json({
        success: false,
        code: degraded ? "CONTROL_PLANE_UNAVAILABLE" : "COMMERCIAL_ACCESS_BLOCKED",
        message: degraded
          ? tenantAccess.commercial?.degradedReason || "Commercial service is unavailable"
          : "Commercial access is blocked for this tenant",
        data: tenantAccess,
      });
    }

    const accessToken = signAccessToken(user);

    // 🔄 REFRESH TOKEN
    const rawRefresh = createRefreshToken();
    const tokenHash = hashToken(rawRefresh);
    const expiresAt = new Date(
      Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000
    );

    user.refreshTokens = user.refreshTokens || [];
    user.refreshTokens.push({
      tokenHash,
      expiresAt,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      userAgent: req.get("user-agent") || "",
      ip: req.ip || "",
    });

    await user.save();

    // 🍪 COOKIE (MUST MATCH REGISTER + REFRESH)
    res.cookie("vynce_refresh", rawRefresh, refreshCookieOptions());

    logDebug("🍪 Login: refresh cookie SET");

    return res.json({
      success: true,
      token: accessToken,
      user: userToSafeObject(user),
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    return res.status(500).json({
      success: false,
      message: "Login failed",
    });
  }
});


/* ---------------- LOGOUT ---------------- */
app.post("/api/auth/logout", async (req, res) => {
  try {
    // Clear refresh cookie
    res.clearCookie("vynce_refresh", refreshCookieOptions());

    return res.json({ success: true, message: "Logged out" });
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({ success: false, message: "Logout failed" });
  }
});


/* ---------------- REFRESH TOKEN ---------------- */
app.post("/api/auth/refresh", async (req, res) => {
  try {
    const raw = req.cookies?.vynce_refresh;

    if (!raw) {
  // Optional: avoid log spam in dev/offline
  if (process.env.NODE_ENV === "production") {
    logWarnDebug("⚠️ Refresh attempted with NO cookie");
  }
  return res.status(401).json({
    success: false,
    message: "No refresh token",
  });
}

    const tokenHash = hashToken(raw);

    const user = await User.findOne({
      "refreshTokens.tokenHash": tokenHash,
    });

    if (!user) {
      res.clearCookie("vynce_refresh", refreshCookieOptions());
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    const session = user.refreshTokens.find(
      (t) => t.tokenHash === tokenHash
    );

    if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
      const remaining = user.refreshTokens.filter(
        (t) => t.tokenHash !== tokenHash
      );

      await User.findByIdAndUpdate(user._id, {
        $set: { refreshTokens: remaining },
      });

      res.clearCookie("vynce_refresh", refreshCookieOptions());
      return res.status(401).json({
        success: false,
        message: "Refresh expired",
      });
    }

    // 🔁 ROTATE TOKEN
    const newRaw = createRefreshToken();
    const newHash = hashToken(newRaw);
    const newExpiresAt = new Date(
      Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000
    );

    const updatedTokens = user.refreshTokens
      .filter((t) => t.tokenHash !== tokenHash)
      .concat({
        tokenHash: newHash,
        expiresAt: newExpiresAt,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        userAgent: req.get("user-agent") || "",
        ip: req.ip || "",
      });

    await User.findByIdAndUpdate(user._id, {
      $set: {
        refreshTokens: updatedTokens,
        lastLoginAt: new Date(),
      },
    });

    // 🍪 SET NEW COOKIE (IDENTICAL OPTIONS)
    res.cookie("vynce_refresh", newRaw, refreshCookieOptions());

    logDebug("🍪 Refresh: cookie ROTATED");

    const accessToken = signAccessToken(user);

    return res.json({
      success: true,
      token: accessToken,
    });
  } catch (err) {
    console.error("Refresh error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during refresh",
    });
  }
});


/* =========================================================
   ADMIN
========================================================= */

// Create customer (SUPERADMIN ONLY)
app.post(
  "/api/admin/create-customer",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (req, res) => {
    try {
      // 🔒 Absolute guard — only superadmin
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "Not authorized",
        });
      }

      const { company, firstName, lastName, email, plan } = req.body;

      if (!company || !firstName || !lastName || !email || !plan) {
        return res.status(400).json({
          success: false,
          message: "Company, first name, last name, email, and plan are required",
        });
      }

      const cleanEmail = String(email).toLowerCase().trim();

      const existing = await User.findOne({ email }).select("+passwordHash");

      if (existing) {
        return res.status(400).json({
          success: false,
          message: "Email is already in use",
        });
      }

      // ✅ Create unique tenantId per customer
      const tenantId = `tenant_${crypto.randomUUID()}`;

      const subscriptionPlan = normalizePlanKey(plan);

      const initialPassword =
        "Vynce" + Math.random().toString(36).slice(2, 8) + "!";

      const passwordHash = await bcrypt.hash(initialPassword, 10);

      const user = await User.create({
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        email: cleanEmail,
        passwordHash,
        company: String(company).trim(),
        tenantId, // ✅ REQUIRED FOR SAAS CONTROL
        subscription: buildUserSubscription(subscriptionPlan),
        role: "customer",
        isSuperAdmin: false,
      });

      // ✅ Ensure LicenseSettings exists and is synced
      try {
        const ls = await getOrCreateLicenseSettings(tenantId);

        let changed = false;
        if (!ls.client.companyName || ls.client.companyName === "Unknown") {
          ls.client.companyName = company;
          changed = true;
        }
        if (!ls.client.contactEmail) {
          ls.client.contactEmail = cleanEmail;
          changed = true;
        }
        if (!ls.client.tenantId) {
          ls.client.tenantId = tenantId;
          changed = true;
        }
        if (!ls.client.licenseId) {
          ls.client.licenseId = `vynce-${tenantId}`;
          changed = true;
        }

        if (changed) await ls.save();
        await syncTenantLicenseState(tenantId, {
          plan: ls.plan,
          isEnabled: ls.isEnabled,
          source: "vynce-admin-create-customer",
        });
      } catch (e) {
        logErrorDebug(
          "⚠️ LicenseSettings init failed (non-blocking):",
          e.message
        );
      }

      try {
        await updateOnboardingSteps({
          tenantId,
          userId: user._id,
          updates: {
            companyInfo: Boolean(company),
            agentAdded: true,
          },
        });
        await getOrCreateOnboardingReview(tenantId);
      } catch (e) {
        logErrorDebug("Onboarding init failed (non-blocking):", e.message);
      }

      return res.json({
        success: true,
        message: "Customer created successfully",
        user: userToSafeObject(user),
        initialPassword,
      });
    } catch (err) {
      console.error("Create customer error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to create customer",
      });
    }
  }
);

app.get("/api/tenant/users", authMiddleware, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || "default";
    const [seats, access] = await Promise.all([
      getTenantSeatSnapshot(tenantId),
      getTenantAccessSnapshot({ tenantId, userId: req.user?._id }),
    ]);

    return res.json({
      success: true,
      data: {
        ...seats,
        commercial: access.commercial,
        effectiveAccess: access.effectiveAccess,
      },
    });
  } catch (err) {
    console.error("Tenant users load error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load tenant users",
    });
  }
});

app.get("/api/admin/tenant-monitoring", authMiddleware, adminOnly, async (req, res) => {
  try {
    const tenantId = String(req.query?.tenantId || "").trim();

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "tenantId is required",
      });
    }

    const [license, onboardingStatus, onboardingReview, telephonySettings] =
      await Promise.all([
        ensureTenantSuspensionState(await getOrCreateLicenseSettings(tenantId)),
        getOrCreateOnboardingStatus({ tenantId }),
        getOrCreateOnboardingReview(tenantId),
        TelephonySettings.findOne({ tenantId }).lean().catch(() => null),
      ]);

    let seats = null;
    try {
      seats = await Promise.race([
        getTenantSeatSnapshot(tenantId),
        new Promise((_, reject) => setTimeout(() => reject(new Error("getTenantSeatSnapshot timed out")), 3000)),
      ]);
    } catch (seatErr) {
      console.warn("[tenant-monitoring] getTenantSeatSnapshot failed for " + tenantId + ":", seatErr?.message);
    }

    const onboarding = buildOnboardingPayload(onboardingStatus, onboardingReview);
    let accessState = null;
    try {
      accessState = await Promise.race([
        getTenantAccessSnapshot({ tenantId, onboarding, tenantSettings: license }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("getTenantAccessSnapshot timed out")), 3000)),
      ]);
    } catch (snapErr) {
      console.warn("[tenant-monitoring] getTenantAccessSnapshot failed for " + tenantId + ":", snapErr?.message);
    }

    const [recentCalls, supportConversations, totalCalls, activeCalls] = await Promise.all([
      Call.find({ tenantId })
        .select("number to status agent createdAt updatedAt duration callId metadata")
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(8)
        .lean(),
      SupportConversation.find({ tenantId })
        .sort({ lastMessageAt: -1, updatedAt: -1 })
        .limit(8)
        .lean(),
      Call.countDocuments({ tenantId }),
      Call.countDocuments({
        tenantId,
        status: {
          $in: ["queued", "initiated", "ringing", "in-progress", "in_progress", "active"],
        },
      }),
    ]);

    const completedCalls = recentCalls.filter(
      (call) => String(call.status || "").toLowerCase() === "completed"
    ).length;
    const failedCalls = recentCalls.filter((call) =>
      ["failed", "busy", "no-answer", "no_answer", "canceled"].includes(
        String(call.status || "").toLowerCase()
      )
    ).length;
    const openSupport = supportConversations.filter((item) =>
      ["open", "pending_ai", "waiting_human"].includes(String(item.status || "").toLowerCase())
    );
    const waitingHuman = supportConversations.filter(
      (item) => String(item.status || "").toLowerCase() === "waiting_human"
    );
    const lastCallAt = recentCalls[0]?.updatedAt || recentCalls[0]?.createdAt || null;
    const lastSupportAt =
      supportConversations[0]?.lastMessageAt || supportConversations[0]?.updatedAt || null;

    return res.json({
      success: true,
      data: {
        tenant: {
          tenantId,
          companyName: license?.client?.companyName || seats?.companyName || "Unknown",
          contactEmail: license?.client?.contactEmail || "",
          licenseId: license?.client?.licenseId || `vynce-${tenantId}`,
          plan: license?.plan || seats?.plan || "professional",
          status: getTenantLicenseStatus(license),
          isEnabled: !!license?.isEnabled,
          createdAt: license?.createdAt || null,
          updatedAt: license?.updatedAt || null,
        },
        commercial: accessState?.commercial || null,
        effectiveAccess: accessState?.effectiveAccess || null,
        onboardingOverride:
          accessState?.operational?.onboardingOverride ||
          getOnboardingOverrideState(license),
        onboarding,
        seats,
        telephony: {
          verification: telephonySettings?.verification || null,
          connected: telephonySettings?.verification?.status === "verified",
          checkedAt: telephonySettings?.verification?.checkedAt || null,
        },
        callMetrics: {
          totalCalls,
          activeCalls,
          recentCompletedCalls: completedCalls,
          recentFailedCalls: failedCalls,
          lastCallAt,
        },
        supportMetrics: {
          totalThreads: supportConversations.length,
          openThreads: openSupport.length,
          waitingHuman: waitingHuman.length,
          lastMessageAt: lastSupportAt,
        },
        recentCalls: recentCalls.map((call) => ({
          id: call._id?.toString?.() || call.callId || "",
          number: call.number || call.to || "",
          status: call.status || "unknown",
          agent: call.agent || call.metadata?.agentName || "",
          createdAt: call.createdAt || null,
          updatedAt: call.updatedAt || null,
          duration: call.duration || 0,
        })),
        supportThreads: supportConversations.map((conversation) =>
          buildSupportInboxPreview(conversation)
        ),
      },
    });
  } catch (err) {
    console.error("Tenant monitoring error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load tenant monitoring data",
    });
  }
});

app.post(
  "/api/admin/tenant-users",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (req, res) => {
    try {
      if (!req.user?.isSuperAdmin) {
        return res.status(403).json({
          success: false,
          message: "Only superadmin can add users to an existing tenant.",
        });
      }

      const tenantId = String(req.body?.tenantId || "").trim();
      const firstName = String(req.body?.firstName || "").trim();
      const lastName = String(req.body?.lastName || "").trim();
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = String(req.body?.password || "").trim();
      const requestedRole = String(req.body?.role || "customer").trim().toLowerCase();
      const grantAdditionalSeat = Boolean(req.body?.grantAdditionalSeat);

      if (!tenantId || !firstName || !lastName || !email || !password) {
        return res.status(400).json({
          success: false,
          message: "tenantId, firstName, lastName, email, and password are required.",
        });
      }

      if (!["customer", "admin"].includes(requestedRole)) {
        return res.status(400).json({
          success: false,
          message: "Only customer or admin roles can be provisioned for tenant users.",
        });
      }

      const existing = await User.findOne({ email }).select("_id");
      if (existing) {
        return res.status(400).json({
          success: false,
          message: "Email is already in use.",
        });
      }

      const tenantUsers = await User.find({ tenantId }).select("_id subscription company");
      if (!tenantUsers.length) {
        return res.status(404).json({
          success: false,
          message: "Tenant not found or has no existing owner account.",
        });
      }

      const license = await getOrCreateLicenseSettings(tenantId);
      const basePlan = normalizePlanKey(
        license?.plan || tenantUsers[0]?.subscription?.plan || "professional"
      );
      const ownerUserId = tenantUsers[0]._id;
      const subscription = await getOrCreateSubscription(tenantId, ownerUserId, basePlan);

      const includedActiveUsers =
        Number(subscription?.limits?.includedActiveUsers) || getIncludedActiveUsers(basePlan);
      let additionalAgentSeats = Math.max(
        0,
        Number(subscription?.billing?.additionalAgentSeats ?? 0)
      );
      let seatSnapshot = await getTenantSeatSnapshot(tenantId);

      if (!seatSnapshot.canProvisionUser || !seatSnapshot.canAddUser) {
        if (!grantAdditionalSeat) {
          return res.status(409).json({
            success: false,
            code: "SEAT_LIMIT_REACHED",
            message:
              "This tenant has reached its active user limit. A superadmin must explicitly grant an additional seat before another user can be added.",
            data: seatSnapshot,
          });
        }

        additionalAgentSeats += 1;
        subscription.plan = basePlan;
        subscription.limits = {
          ...(subscription.limits || {}),
          includedActiveUsers,
        };
        subscription.billing = {
          ...(subscription.billing || {}),
          unlimitedCalls: true,
          monthlyPrice: Number(getPlanDefinition(basePlan).billing?.monthlyPrice ?? 0),
          additionalAgentSeats,
          additionalActiveUserPrice: getAdditionalActiveUserPrice(basePlan),
        };
        await subscription.save();
        await syncTenantUserSubscriptions(tenantId, basePlan, additionalAgentSeats);
        await syncTenantSeatEntitlement(tenantId, {
          includedUsers: includedActiveUsers,
          extraSeats: additionalAgentSeats,
        });
        seatSnapshot = await getTenantSeatSnapshot(tenantId);
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await User.create({
        firstName,
        lastName,
        email,
        passwordHash,
        company: license?.client?.companyName || tenantUsers[0]?.company || "Unknown",
        tenantId,
        subscription: buildUserSubscription(basePlan, {
          additionalAgentSeats,
        }),
        role: requestedRole,
        isSuperAdmin: false,
      });

      try {
        await updateOnboardingSteps({
          tenantId,
          userId: user._id,
          updates: {
            agentAdded: true,
          },
        });
      } catch (e) {
        logErrorDebug("Tenant user onboarding sync failed:", e.message);
      }

      const updatedSeats = await getTenantSeatSnapshot(tenantId);

      return res.status(201).json({
        success: true,
        message: "Tenant user created successfully.",
        user: userToSafeObject(user),
        data: updatedSeats,
      });
    } catch (err) {
      console.error("Tenant user create error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to create tenant user.",
      });
    }
  }
);

// Clear calls (admin+ only)
app.post(
  "/api/admin/clear-calls",
  authMiddleware,
  requireRole("admin", "superadmin"),
  (req, res) => {
    allCalls = [];
    logDebug("🧹 Admin cleared in-memory call history");

    return res.json({
      success: true,
      message: "In-memory call history cleared",
    });
  }
);



/* =========================================================
   SETTINGS
========================================================= */

// GET SETTINGS
app.get(
  "/api/settings",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (req, res) => {
    try {
      let settings = await Settings.findOne({ singleton: true });
      const telephonySettings = await TelephonySettings.findOne({
        $or: [{ userId: req.user._id }, { tenantId: req.user.tenantId }],
      })
        .sort({ updatedAt: -1 })
        .lean();

      if (!settings) {
        settings = await Settings.create({
          singleton: true,
          bulkDelayMs: dialerSettings.bulkDelayMs,
          enableVoicemailDrop: dialerSettings.enableVoicemailDrop,
          timeZone: dialerSettings.timeZone,
          callerId,
          vonageApplicationId,
          forwardTo,
          publicWebhookUrl,
        });
      }

      return res.json({
        success: true,
        settings: {
          callerId: settings.callerId ?? callerId,
          vonageApplicationId:
            settings.vonageApplicationId ?? vonageApplicationId,
          forwardTo: settings.forwardTo ?? forwardTo,
          publicWebhookUrl:
            settings.publicWebhookUrl ?? publicWebhookUrl,
          bulkDelayMs:
            settings.bulkDelayMs ?? dialerSettings.bulkDelayMs,
          enableVoicemailDrop:
            typeof settings.enableVoicemailDrop === "boolean"
              ? settings.enableVoicemailDrop
              : dialerSettings.enableVoicemailDrop,
          timeZone: settings.timeZone ?? dialerSettings.timeZone,
        },
        vonageStatus: telephonySettings?.verification
          ? {
              ok: telephonySettings.verification.status === "verified",
              message: telephonySettings.verification.message || "",
              code: telephonySettings.verification.code || "",
            }
          : null,
        vonageAccount: telephonySettings?.verification?.account || null,
        vonageVerification: telephonySettings?.verification || null,
      });
    } catch (err) {
      console.error("Settings load error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load settings",
      });
    }
  }
);

// UPDATE SETTINGS
app.post(
  "/api/settings",
  authMiddleware,
  requireRole("admin", "superadmin"),
  async (req, res) => {
    try {
      const {
        callerId: newCallerId,
        vonageApplicationId: newVonageApplicationId,
        bulkDelayMs,
        enableVoicemailDrop,
        forwardTo: newForwardTo,
        publicWebhookUrl: newPublicWebhookUrl,
        timeZone,
      } = req.body;

      let settings = await Settings.findOne({ singleton: true });
      if (!settings) settings = new Settings({ singleton: true });

      if (typeof newCallerId === "string" && newCallerId.trim()) {
        const normalizedCallerId = normalizeDialerPhoneSetting(newCallerId);
        if (!normalizedCallerId) {
          return res.status(400).json({
            success: false,
            message: "Invalid caller ID format",
          });
        }

        callerId = normalizedCallerId;
        settings.callerId = normalizedCallerId;
      }

      if (
        typeof newVonageApplicationId === "string" &&
        newVonageApplicationId.trim()
      ) {
        const normalizedVonageApplicationId = normalizeVonageApplicationIdSetting(
          newVonageApplicationId
        );
        if (!normalizedVonageApplicationId) {
          return res.status(400).json({
            success: false,
            message: "Invalid Vonage application ID format",
          });
        }

        vonageApplicationId = normalizedVonageApplicationId;
        settings.vonageApplicationId = normalizedVonageApplicationId;
      }

      if (
        typeof bulkDelayMs === "number" &&
        !Number.isNaN(bulkDelayMs) &&
        bulkDelayMs >= 0 &&
        bulkDelayMs <= 60000
      ) {
        dialerSettings.bulkDelayMs = bulkDelayMs;
        settings.bulkDelayMs = bulkDelayMs;
      }

      if (typeof enableVoicemailDrop === "boolean") {
        dialerSettings.enableVoicemailDrop = enableVoicemailDrop;
        settings.enableVoicemailDrop = enableVoicemailDrop;
      }

      if (typeof newForwardTo === "string" && newForwardTo.trim()) {
        let num = newForwardTo.trim();
        const digits = num.replace(/\D/g, "");

        if (digits.length === 10) num = `+1${digits}`;
        else if (digits.length === 11 && digits.startsWith("1")) num = `+${digits}`;
        else if (digits && num[0] !== "+") num = `+${digits}`;

        forwardTo = num;
        settings.forwardTo = num;
      }

      if (typeof timeZone === "string" && timeZone.trim()) {
        dialerSettings.timeZone = timeZone.trim();
        settings.timeZone = dialerSettings.timeZone;
      }

      if (typeof newPublicWebhookUrl === "string" && newPublicWebhookUrl.trim()) {
        const normalizedWebhookUrl = normalizeWebhookUrlSetting(newPublicWebhookUrl);
        if (!normalizedWebhookUrl) {
          return res.status(400).json({
            success: false,
            message: IS_PRODUCTION
              ? "Invalid public webhook URL. Production requires a public HTTPS URL."
              : "Invalid public webhook URL",
          });
        }

        publicWebhookUrl = normalizedWebhookUrl;
        settings.publicWebhookUrl = normalizedWebhookUrl;
      }

      settings.callerId = callerId;
      settings.vonageApplicationId = vonageApplicationId;
      settings.publicWebhookUrl = publicWebhookUrl;

      await settings.save();

      if (!OFFLINE_MODE && VONAGE_ENV_CREDS_PRESENT) {
        // Only rebuild the global client when env creds are configured.
        // When per-tenant TelephonySettings are used, calls load credentials
        // dynamically via buildVonageClientForTenant() at call time.
        vonage = new Vonage({
          apiKey: process.env.VONAGE_API_KEY,
          apiSecret: process.env.VONAGE_API_SECRET,
          applicationId: vonageApplicationId,
          privateKey: VONAGE_PRIVATE_KEY,
          debug: !IS_PRODUCTION,
        });
      }

      try {
        await updateOnboardingSteps({
          tenantId: req.user.tenantId,
          userId: req.user._id,
          updates: {
            companyInfo: true,
            settingsConfigured: true,
          },
        });
      } catch (e) {
        logErrorDebug("Onboarding settings update failed:", e.message);
      }

      return res.json({
        success: true,
        message: "Settings updated",
        settings: {
          callerId,
          vonageApplicationId,
          forwardTo,
          publicWebhookUrl,
          bulkDelayMs: dialerSettings.bulkDelayMs,
          enableVoicemailDrop: dialerSettings.enableVoicemailDrop,
          timeZone: dialerSettings.timeZone,
        },
      });
    } catch (err) {
      console.error("Settings update error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to update settings",
      });
    }
  }
);



/* =========================================================
   LICENSE AUDIT LOG (MODEL SAFE)
========================================================= */

const LicenseAuditSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: [
        "TENANT_CREATED",
        "LICENSE_ISSUED",
        "LICENSE_ENABLED",
        "LICENSE_DISABLED",
        "TEMPORARY_DISABLED",
        "AUTO_REENABLED",
        "PLAN_CHANGED",
        "LIMITS_CHANGED",
        "LICENSE_UPDATED",
        "TENANT_SUSPENDED",
        "TENANT_REENABLED",
        "TENANT_TEMP_SUSPENDED",
      ],
      required: true,
    },
    performedBy: {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      email: String,
      role: String,
    },
    target: {
      companyName: String,
      tenantId: { type: String, index: true },
      licenseId: String,
    },
    before: { type: Object, default: {} },
    after: { type: Object, default: {} },
  },
  { timestamps: true }
);

const LicenseAuditLog =
  mongoose.models.LicenseAuditLog ||
  mongoose.model("LicenseAuditLog", LicenseAuditSchema);

function normalizeIssueErrorMessage(result) {
  const status = Number(result?.statusCode || 500);

  if (status === 401 || status === 403) {
    return "Control plane authorization failed for license issuance.";
  }

  if (status === 409) {
    return "Control plane rejected issuance because the tenant already has an active commercial license.";
  }

  if (status === 429) {
    return "Control plane rate limit reached. Retry in a moment.";
  }

  if (status >= 500) {
    return "Control plane is currently unavailable. License issuance was not completed.";
  }

  return result?.message || "Failed to issue tenant license key";
}

/* =========================================================
   ADMIN LICENSE CONTROL (TENANT-AWARE) — SINGLE SOURCE
========================================================= */

/* ---------------- UPDATE LICENSE + AUDIT ---------------- */
app.post("/api/admin/license/issue", authMiddleware, adminOnly, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const settings = await ensureTenantSuspensionState(
      await getExistingLicenseSettingsOrThrow(tenantId)
    );

    const {
      plan,
      maxActivations,
      includedUsers,
      extraSeats,
      expiresAt,
      performedBy,
      reason,
    } = req.body || {};

    const normalizedPlan = String(plan || settings.plan || "professional").trim() || "professional";
    const normalizedMaxActivations = Number.isFinite(Number(maxActivations))
      ? Math.max(1, Math.floor(Number(maxActivations)))
      : 1;
    const normalizedIncludedUsers = Number.isFinite(Number(includedUsers))
      ? Math.max(1, Math.floor(Number(includedUsers)))
      : 1;
    const normalizedExtraSeats = Number.isFinite(Number(extraSeats))
      ? Math.max(0, Math.floor(Number(extraSeats)))
      : 0;
    const normalizedReason = String(reason || "issued_from_vynce_admin").trim() || "issued_from_vynce_admin";
    const normalizedPerformedBy =
      String(performedBy || req.user?.email || "vynce-admin").trim() || "vynce-admin";

    let normalizedExpiresAt = null;
    if (expiresAt) {
      const parsed = new Date(expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        return res.status(400).json({
          success: false,
          message: "expiresAt must be a valid ISO date when provided.",
        });
      }
      normalizedExpiresAt = parsed.toISOString();
    }

    const issueResult = await issueTenantLicenseKey(tenantId, {
      plan: normalizedPlan,
      maxActivations: normalizedMaxActivations,
      includedUsers: normalizedIncludedUsers,
      extraSeats: normalizedExtraSeats,
      expiresAt: normalizedExpiresAt,
      performedBy: normalizedPerformedBy,
      reason: normalizedReason,
      source: "vynce-admin-license",
    });

    if (!issueResult.success) {
      const statusCode = Number(issueResult.statusCode || 500);
      return res.status(statusCode).json({
        success: false,
        code: issueResult.code || "LICENSE_ISSUE_FAILED",
        message: normalizeIssueErrorMessage(issueResult),
      });
    }

    if (settings.plan !== normalizedPlan) {
      settings.plan = normalizedPlan;
      settings.updatedBy = {
        userId: req.user._id,
        email: req.user.email,
        role: req.user.role,
      };
      await settings.save();
    }

    await LicenseAuditLog.create({
      action: "LICENSE_ISSUED",
      performedBy: {
        userId: req.user._id,
        email: req.user.email,
        role: req.user.role,
      },
      target: {
        companyName: settings.client?.companyName || "Unknown",
        tenantId,
        licenseId: issueResult.licenseId || settings.client?.licenseId || `vynce-${tenantId}`,
      },
      before: {
        plan: settings.plan,
      },
      after: {
        plan: normalizedPlan,
        maxActivations: normalizedMaxActivations,
        includedUsers: normalizedIncludedUsers,
        extraSeats: normalizedExtraSeats,
        expiresAt: normalizedExpiresAt,
        reason: normalizedReason,
      },
    });

    return res.json({
      success: true,
      message: "License key issued. This key is displayed once and should be shared securely.",
      data: {
        tenantId,
        licenseId: issueResult.licenseId,
        licenseKey: issueResult.licenseKey,
        oneTimeDisplay: true,
        issuedAt: new Date().toISOString(),
        plan: normalizedPlan,
        maxActivations: normalizedMaxActivations,
        includedUsers: normalizedIncludedUsers,
        extraSeats: normalizedExtraSeats,
        expiresAt: normalizedExpiresAt,
      },
    });
  } catch (err) {
    console.error("Admin license issue error:", err);
    return res.status(err?.statusCode || 500).json({
      success: false,
      code: err?.code || "LICENSE_ISSUE_FAILED",
      message: err?.message || "Failed to issue license key",
    });
  }
});

app.post("/api/admin/license", authMiddleware, adminOnly, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const settings = await ensureTenantSuspensionState(
      await getExistingLicenseSettingsOrThrow(tenantId)
    );

    const before = settings.toObject();

    const {
      action,
      isEnabled,
      suspendReason,
      suspendReasonCode,
      suspendReasonText,
      reasonCode,
      reasonText,
      overrideMinutes,
      overrideExpiresAt,
      overridePermanent,
      disabledUntil,
      plan,
      limits,
    } = req.body;

    const normalizedAction =
      typeof action === "string" && action.trim()
        ? action.trim().toLowerCase()
        : "";

    const normalizedReasonCode = normalizeSuspendReasonCode(
      reasonCode || suspendReasonCode
    );
    const normalizedReasonText = String(
      reasonText || suspendReasonText || suspendReason || ""
    ).trim();

    if (normalizedAction) {
      if (normalizedAction === "suspend") {
        if (!normalizedReasonCode) {
          return res.status(400).json({
            success: false,
            message: "Suspension requires a valid reason code",
          });
        }

        settings.isEnabled = false;
        settings.disabledUntil = null;
        settings.suspendReasonCode = normalizedReasonCode;
        settings.suspendReasonText = normalizedReasonText;
        settings.suspendReason = normalizedReasonText || normalizedReasonCode;
      } else if (normalizedAction === "reenable") {
        settings.isEnabled = true;
        settings.disabledUntil = null;
        settings.suspendReason = "";
        settings.suspendReasonCode = "";
        settings.suspendReasonText = "";
      } else if (normalizedAction === "temporary_suspend") {
        if (!normalizedReasonCode) {
          return res.status(400).json({
            success: false,
            message: "Temporary suspension requires a valid reason code",
          });
        }

        const parsedDisabledUntil = new Date(disabledUntil);
        if (
          !disabledUntil ||
          Number.isNaN(parsedDisabledUntil.getTime()) ||
          parsedDisabledUntil.getTime() <= Date.now()
        ) {
          return res.status(400).json({
            success: false,
            message: "Temporary suspension requires a future end date",
          });
        }

        settings.isEnabled = false;
        settings.disabledUntil = parsedDisabledUntil;
        settings.suspendReasonCode = normalizedReasonCode;
        settings.suspendReasonText = normalizedReasonText;
        settings.suspendReason = normalizedReasonText || normalizedReasonCode;
      } else if (normalizedAction === "override_onboarding") {
        const minutes = Number.isFinite(Number(overrideMinutes))
          ? Math.max(5, Math.min(1440, Math.floor(Number(overrideMinutes))))
          : 60;
        let expiresAt = null;

        if (overridePermanent === true) {
          expiresAt = null;
        } else if (overrideExpiresAt) {
          const parsedOverrideExpiry = new Date(overrideExpiresAt);
          if (!Number.isNaN(parsedOverrideExpiry.getTime())) {
            expiresAt = parsedOverrideExpiry;
          } else {
            expiresAt = new Date(Date.now() + minutes * 60 * 1000);
          }
        } else {
          expiresAt = new Date(Date.now() + minutes * 60 * 1000);
        }

        settings.onboardingOverride = settings.onboardingOverride || {};
        settings.onboardingOverride.enabled = true;
        settings.onboardingOverride.enabledAt = new Date();
        settings.onboardingOverride.expiresAt = expiresAt;
        settings.onboardingOverride.reason =
          normalizedReasonText || "Admin override for dashboard validation";
        settings.onboardingOverride.enabledBy = {
          userId: req.user._id,
          email: req.user.email,
          role: req.user.role,
        };
      } else if (normalizedAction === "clear_onboarding_override") {
        settings.onboardingOverride = settings.onboardingOverride || {};
        settings.onboardingOverride.enabled = false;
        settings.onboardingOverride.expiresAt = null;
        settings.onboardingOverride.reason = "";
      } else {
        return res.status(400).json({
          success: false,
          message: "Unknown tenant license action",
        });
      }
    }

    if (typeof isEnabled === "boolean") {
      settings.isEnabled = isEnabled;
      if (!isEnabled && typeof suspendReason === "string") {
        settings.suspendReason = suspendReason;
      }
      if (isEnabled) {
        settings.suspendReason = "";
        settings.suspendReasonCode = "";
        settings.suspendReasonText = "";
        settings.disabledUntil = null;
      }
    }

    if (typeof plan === "string" && plan !== settings.plan) {
      settings.plan = plan;
    }

    if (limits?.maxCallsPerDay !== undefined) {
      settings.limits = settings.limits || {};
      settings.limits.maxCallsPerDay = Number(limits.maxCallsPerDay);
    }

    settings.updatedBy = {
      userId: req.user._id,
      email: req.user.email,
      role: req.user.role,
    };

    await settings.save();

    const requiresCommercialSync =
      Boolean(typeof isEnabled === "boolean") ||
      Boolean(typeof plan === "string") ||
      Boolean(limits?.maxCallsPerDay !== undefined) ||
      ["suspend", "temporary_suspend", "reenable"].includes(normalizedAction);

    if (requiresCommercialSync) {
      const licenseSyncResult = await syncTenantLicenseState(settings.tenantId, {
        plan: settings.plan,
        isEnabled: settings.isEnabled,
        reasonCode: settings.suspendReasonCode || "",
        reasonText: settings.suspendReasonText || "",
        disabledUntil: settings.disabledUntil || null,
        source: "vynce-admin-license",
      });

      if (licenseSyncResult?.success === false) {
        await LicenseSettings.findByIdAndUpdate(settings._id, {
          isEnabled: before.isEnabled,
          disabledUntil: before.disabledUntil || null,
          suspendReason: before.suspendReason || "",
          suspendReasonCode: before.suspendReasonCode || "",
          suspendReasonText: before.suspendReasonText || "",
          plan: before.plan,
          limits: before.limits || {},
          onboardingOverride: before.onboardingOverride || {},
          updatedBy: before.updatedBy || null,
        });

        return res.status(Number(licenseSyncResult.statusCode || 503)).json({
          success: false,
          code: licenseSyncResult.code || "CONTROL_PLANE_SYNC_FAILED",
          message:
            licenseSyncResult.message ||
            "Control plane rejected the tenant license change. No local changes were kept.",
        });
      }
    }

    if (["suspend", "temporary_suspend", "reenable"].includes(normalizedAction)) {
        const activationSyncResult = await syncTenantActivationState(settings.tenantId, {
          action: normalizedAction,
          reasonCode: settings.suspendReasonCode || "",
          reasonText: settings.suspendReasonText || "",
          disabledUntil: settings.disabledUntil || null,
          source: "vynce-admin-license",
        });

        if (activationSyncResult?.success === false) {
          await LicenseSettings.findByIdAndUpdate(settings._id, {
            isEnabled: before.isEnabled,
            disabledUntil: before.disabledUntil || null,
            suspendReason: before.suspendReason || "",
            suspendReasonCode: before.suspendReasonCode || "",
            suspendReasonText: before.suspendReasonText || "",
            plan: before.plan,
            limits: before.limits || {},
            onboardingOverride: before.onboardingOverride || {},
            updatedBy: before.updatedBy || null,
          });

          return res.status(Number(activationSyncResult.statusCode || 503)).json({
            success: false,
            code: activationSyncResult.code || "CONTROL_PLANE_SYNC_FAILED",
            message:
              activationSyncResult.message ||
              "Control plane rejected the activation change. No local changes were kept.",
          });
        }
    }

    const after = settings.toObject();

    // ✅ BROADCAST AFTER SAVE
    broadcastLicenseUpdate(after);

    // 🔍 Determine audit action
    let auditAction = "LICENSE_UPDATED";
    if (normalizedAction) {
      if (normalizedAction === "suspend") auditAction = "TENANT_SUSPENDED";
      if (normalizedAction === "reenable") auditAction = "TENANT_REENABLED";
      if (normalizedAction === "temporary_suspend") {
        auditAction = "TENANT_TEMP_SUSPENDED";
      }
      if (normalizedAction === "override_onboarding") {
        auditAction = "TENANT_ONBOARDING_OVERRIDE_ENABLED";
      }
      if (normalizedAction === "clear_onboarding_override") {
        auditAction = "TENANT_ONBOARDING_OVERRIDE_CLEARED";
      }
    } else if (before.isEnabled !== after.isEnabled) {
      auditAction = after.isEnabled ? "LICENSE_ENABLED" : "LICENSE_DISABLED";
    } else if (before.plan !== after.plan) {
      auditAction = "PLAN_CHANGED";
    } else if (
      before.limits?.maxCallsPerDay !== after.limits?.maxCallsPerDay
    ) {
      auditAction = "LIMITS_CHANGED";
    }

    await LicenseAuditLog.create({
      action: auditAction,
      performedBy: {
        userId: req.user._id,
        email: req.user.email,
        role: req.user.role,
      },
      target: {
        companyName: settings.client?.companyName || "Unknown",
        tenantId: settings.tenantId,
        licenseId:
          settings.client?.licenseId || `vynce-${settings.tenantId}`,
      },
      before,
      after,
    });

    return res.json({
      success: true,
      message:
        auditAction === "TENANT_SUSPENDED"
          ? "Tenant suspended"
          : auditAction === "TENANT_REENABLED"
            ? "Tenant re-enabled"
            : auditAction === "TENANT_TEMP_SUSPENDED"
              ? "Tenant temporarily suspended"
              : auditAction === "TENANT_ONBOARDING_OVERRIDE_ENABLED"
                ? "Onboarding override enabled"
                : auditAction === "TENANT_ONBOARDING_OVERRIDE_CLEARED"
                  ? "Onboarding override cleared"
              : "License settings updated",
      data: buildTenantLicenseResponse(settings),
    });
  } catch (err) {
    console.error("Admin license update error:", err);
    return res.status(err?.statusCode || 500).json({
      success: false,
      code: err?.code || "LICENSE_UPDATE_FAILED",
      message: err?.message || "Failed to update license",
    });
  }
});

// READ LICENSE (ADMIN)
app.get("/api/admin/license", authMiddleware, adminOnly, async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const settings = await ensureTenantSuspensionState(
      await getExistingLicenseSettingsOrThrow(tenantId)
    );

    return res.json({
      success: true,
      data: buildTenantLicenseResponse(settings),
    });
  } catch (err) {
    console.error("Admin license fetch error:", err);
    return res.status(err?.statusCode || 500).json({
      success: false,
      code: err?.code || "LICENSE_FETCH_FAILED",
      message: err?.message || "Failed to load license",
    });
  }
});

/* ---------------- AUDIT LOG ---------------- */
app.get(
  "/api/admin/license/audit",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    try {
      const tenantId = String(req.query?.tenantId || "").trim();

      const filter = tenantId
        ? { "target.tenantId": tenantId }
        : {};

      const logs = await LicenseAuditLog.find(filter)
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      return res.json({
        success: true,
        data: logs,
      });
    } catch (err) {
      console.error("Audit log fetch error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load audit logs",
      });
    }
  }
);

app.get(
  "/api/admin/vonage/webhook-audit",
  authMiddleware,
  adminOnly,
  async (req, res) => {
    if (!VONAGE_WEBHOOK_AUDIT_ENABLED) {
      return res.status(404).json({
        success: false,
        message: "Vonage webhook audit logging is disabled.",
      });
    }

    try {
      const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
      const eventType = String(req.query.eventType || "").trim();
      const matchedAs = String(req.query.matchedAs || "").trim();
      const callUuid = String(req.query.callUuid || "").trim();
      const callId = String(req.query.callId || "").trim();

      const filter = {};
      if (eventType) filter.eventType = eventType;
      if (matchedAs) filter.matchedAs = matchedAs;
      if (callUuid) filter.callUuid = callUuid;
      if (callId) filter.callId = callId;

      const logs = await VonageWebhookAudit.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();

      return res.json({
        success: true,
        data: logs,
      });
    } catch (err) {
      console.error("Vonage webhook audit fetch error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to load Vonage webhook audit logs.",
      });
    }
  }
);

/* =========================================================
   BULK CONTROL
========================================================= */
app.get("/api/debug/calls-count", authMiddleware, adminOnly, async (req, res) => {
  const count = await Call.countDocuments();
  res.json({ count });
});

// In dialer.js, replace the /api/bulk/... routes with these

// PAUSE
app.post("/api/bulk/pause", authMiddleware, (req, res) => {
  if (isBulkCampaignActive) {
    bulkPaused = true;
    logDebug("⏸️ PAUSE signal received.");
    io.emit("bulkStatusUpdate", { running: true, paused: true });
  }
  res.json({ success: true });
});

// And RESUME:
app.post("/api/bulk/resume", authMiddleware, (req, res) => {
  if (isBulkCampaignActive) {
    bulkPaused = false;
    logDebug("▶️ RESUME signal received.");
    io.emit("bulkStatusUpdate", { running: true, paused: false });
  }
  res.json({ success: true });
});

// STOP
app.post("/api/bulk/stop", authMiddleware, (req, res) => {
  if (isBulkCampaignActive) {
    bulkStopped = true; // This will be caught by the loop to trigger a graceful shutdown
    logDebug("⛔ Bulk campaign STOP requested.");
    // The `finally` block in `processBulkQueue` will send the final "stopped" status.
  }
  res.json({ success: true });
});

// STATUS CHECK
app.get("/api/bulk/status", authMiddleware, (req, res) => {
  res.json({
    running: isBulkCampaignActive,
    paused: bulkPaused,
    stopped: bulkStopped,
  });
});
app.get("/api/debug/vonage-test", async (req, res) => {
  try {
    const balance = await vonage.account.getBalance();
    res.json({ success: true, balance });
  } catch (err) {
    console.error("Vonage test failed:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
/* =========================================================
   BULK STATUS
========================================================= */



app.post("/api/make-call", authMiddleware, async (req, res) => {
  let callDoc = null;

  try {
    const tenantId = req.user?.tenantId || req.user?._id?.toString();
    const tenantSettings = await ensureTenantSuspensionState(
      await getOrCreateLicenseSettings(tenantId)
    );
    const tenantMode = getTenantCallingModeState(tenantSettings);

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "Tenant not resolved",
      });
    }

    let accessState;
    try {
      await assertCommercialAccessAllowed(tenantId);
      accessState = await getTenantAccessSnapshot({
        tenantId,
        userId: req.user?._id,
      });
    } catch (commercialErr) {
      return res.status(commercialErr.statusCode || 503).json({
        success: false,
        code: commercialErr.code || "COMMERCIAL_ACCESS_BLOCKED",
        message: commercialErr.message || "Commercial access is blocked",
      });
    }

    if (!accessState.effectiveAccess.canSingleCall) {
      return res.status(403).json({
        success: false,
        code: "TENANT_CALL_BLOCKED",
        message: "Single call is blocked by tenant commercial or operational policy.",
        data: accessState,
      });
    }

    if (tenantMode.effective === "live" && !USE_CONTROL_PLANE_SOURCE) {
      try {
        await enforceLicenseOrThrow(req);
      } catch (licenseErr) {
        return res.status(403).json({
          success: false,
          message: licenseErr.message || "Calling is not allowed for this tenant",
        });
      }
    }

    let callMode;
    try {
      callMode = await enforceOnboardingForCalling({
        tenantId,
        userId: req.user._id,
        mode: "single",
      });
    } catch (onboardingErr) {
      return res
        .status(onboardingErr.statusCode || 403)
        .json(onboardingErr.payload || {
          success: false,
          message: onboardingErr.message || "Calling is blocked until onboarding approval",
        });
    }

    const { to, agent } = req.body;

    if (!to) {
      return res.status(400).json({
        success: false,
        message: "Missing 'to' number in request body",
      });
    }

    // -----------------------------
    // TENANT (OFFLINE SAFE)
    // -----------------------------
   

    // -----------------------------
    // METADATA
    // -----------------------------
    const metadata = {
      agent: agent || null,
      source: "single_call",
    };

    // -----------------------------
    // 1️⃣ CREATE MONGO RECORD FIRST
    // -----------------------------
    // -----------------------------
// TENANT (OFFLINE SAFE)
// -----------------------------
// -----------------------------
// CREATE MONGO RECORD FIRST
// -----------------------------
callDoc = await Call.create({
  tenantId,                // ✅ REQUIRED (FIX)
  number: to,
  to,
  status: "queued",
  direction: "outbound",
  callType: "single",
  agent: agent || null,
  metadata,
  createdAt: new Date(),
  updatedAt: new Date(),
});


    // Notify UI immediately (queued)
    io.emit("callUpdate", {
      _id: callDoc._id,
      status: "queued",
      callType: "single",
    });

    // -----------------------------
    // 2️⃣ INITIATE CALL (GUARDED)
    // -----------------------------
    let call;
    if (tenantMode.effective === "offline") {
      call = { uuid: `offline-${callDoc._id.toString()}` };
      scheduleTenantOfflineCallLifecycle({
        _id: callDoc._id,
        uuid: call.uuid,
      });
    } else {
      try {
        call = await initiateCall(to, {
          type: "single",
          callId: callDoc._id.toString(),
          tenantId,
          ...metadata,
        });
      } catch (dialErr) {
        console.error("❌ initiateCall failed:", dialErr);

        await Call.findByIdAndUpdate(callDoc._id, {
          status: "failed",
          failReason: dialErr.message || "initiate_failed",
          updatedAt: new Date(),
        });

        const failed = await Call.findById(callDoc._id).lean();
        io.emit("callUpdate", failed);

        return res.json({
          success: false,
          message: "Call failed to initiate",
          data: failed,
        });
      }
    }

    // -----------------------------
    // 3️⃣ UPDATE MONGO AFTER DIALER
    // -----------------------------
    const uuid = call?.uuid || call?.callUuid || call?.data?.uuid || null;

    await Call.findByIdAndUpdate(callDoc._id, {
      uuid,
      status: "initiated",
      updatedAt: new Date(),
    });

    // -----------------------------
    // 4️⃣ RE-FETCH + EMIT (TRUTH)
    // -----------------------------
    const updated = await Call.findById(callDoc._id).lean();
    if (callMode?.isTestCall) {
      await updateOnboardingSteps({
        tenantId,
        userId: req.user._id,
        updates: {
          testCallCompleted: true,
        },
      });
    }
    io.emit("callUpdate", updated);

    // -----------------------------
    // 5️⃣ RESPOND
    // -----------------------------
    return res.json({
      success: true,
      mode: tenantMode.effective,
      data: updated,
    });
  } catch (err) {
    console.error("❌ /api/make-call fatal error:", err);

    // LAST-RESORT SAFETY: never leave queued forever
    if (callDoc?._id) {
      try {
        await Call.findByIdAndUpdate(callDoc._id, {
          status: "failed",
          failReason: err.message || "internal_error",
          updatedAt: new Date(),
        });

        const failed = await Call.findById(callDoc._id).lean();
        io.emit("callUpdate", failed);
      } catch (_) {}
    }

    return res.status(500).json({
      success: false,
      message: "Failed to initiate call",
    });
  }
});



// ----------------------------------
// 🔔 OFFLINE CALL UPDATE EMITTER
// ----------------------------------
function emitCallUpdate(call) {
  if (!call) return;

  try {
    logDebug(
      "📡 emitCallUpdate → sockets:",
      io?.engine?.clientsCount
    );

    io.emit("callUpdate", {
      ...call,
      updatedAt: call.updatedAt || new Date(),
    });
  } catch (err) {
    logErrorDebug("⚠️ emitCallUpdate failed:", err.message);
  }
}


function incrementCallsUsed(count = 1) {
  if (!global.currentLicensePayload) return;

  if (!global.currentLicensePayload.usage) {
    global.currentLicensePayload.usage = { callsUsed: 0 };
  }

  global.currentLicensePayload.usage.callsUsed += count;

  logDebug(
    `📈 License usage incremented: ${global.currentLicensePayload.usage.callsUsed}`
  );
}

async function seedOfflineAdmin() {
  if (!OFFLINE_MODE) return;

  const email = (process.env.OFFLINE_ADMIN_EMAIL || "admin@vynce.com")
    .toLowerCase()
    .trim();

  const password = process.env.OFFLINE_ADMIN_PASSWORD || "Password";
  const passwordHash = await bcrypt.hash(password, 10);

  logDebug("🧪 SEED DEBUG", {
    OFFLINE_MODE,
    email,
    password,
  });

  const existing = await User.findOne({ email });

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.role = "admin";
    await existing.save();

    logDebug("🔁 OFFLINE admin password RESET:", email);
    return;
  }

  await User.create({
    email,
    passwordHash,
    role: "admin",
    firstName: "Offline",
    lastName: "Admin",
    createdAt: new Date(),
  });

  logDebug("✅ Seeded OFFLINE admin:", email);
}



/* =========================================================
   LICENSE STATUS
========================================================= */
app.get(["/api/license/status", "/api/license/status-legacy"], authMiddleware, (req, res) => {
  (async () => {
  try {
    const tenantId = req.user?.tenantId || req.user?._id?.toString() || "default";
    const tenantSettings = await ensureTenantSuspensionState(
      await getOrCreateLicenseSettings(tenantId)
    );
    const onboarding = await getTenantOnboardingPayload({
      tenantId,
      userId: req.user?._id,
    });
    const accessState = await getTenantAccessSnapshot({
      tenantId,
      userId: req.user?._id,
      onboarding,
      tenantSettings,
    });
    const calling = buildCallingPermissions(onboarding, {
      onboardingOverrideActive: accessState?.operational?.onboardingOverride?.active,
    });

    return res.json({
      success: true,
      data: {
        tenantId,
        commercial: {
          licenseActive: accessState.commercial.licenseActive,
          commercialStatus: accessState.commercial.commercialStatus,
          activationValid: accessState.commercial.activationValid,
          plan: accessState.commercial.plan,
          includedUsers: accessState.commercial.includedUsers,
          extraSeats: accessState.commercial.extraSeats,
          maxActivations: accessState.commercial.maxActivations,
          activeActivations: accessState.commercial.activeActivations,
          canProvisionUser: accessState.commercial.canProvisionUser,
          degraded: accessState.commercial.degraded,
          degradedReason: accessState.commercial.degradedReason || "",
        },
        operational: {
          onboardingApproved: accessState.operational.onboardingApproved,
          tenantOperationalStatus: accessState.operational.tenantOperationalStatus,
          telephonyVerified: accessState.operational.telephonyVerified,
          canGoLive: accessState.operational.canGoLive,
          onboardingOverride: accessState.operational.onboardingOverride,
        },
        effectiveAccess: accessState.effectiveAccess,
        mode: getTenantCallingModeState(tenantSettings),
        onboarding: onboarding.review,
        calling,
      },
    });
  } catch (err) {
    console.error("License status error:", err);
    return res
      .status(500)
      .json({ ok: false, message: "License status check failed" });
  }
  })();
});

app.get("/api/system/mode", authMiddleware, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.user?._id?.toString() || "default";
    const settings = await ensureTenantSuspensionState(
      await getOrCreateLicenseSettings(tenantId)
    );

    return res.json({
      success: true,
      data: getTenantCallingModeState(settings),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to load system mode",
    });
  }
});

app.post("/api/system/mode", authMiddleware, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || req.user?._id?.toString() || "default";
    const requestedMode =
      String(req.body?.mode || "").trim().toLowerCase() === "live" ? "live" : "offline";
    const settings = await ensureTenantSuspensionState(
      await getOrCreateLicenseSettings(tenantId)
    );

    settings.callingMode = requestedMode;
    await settings.save();

    return res.json({
      success: true,
      message:
        requestedMode === "live"
          ? "Live calling requested for this tenant"
          : "Offline calling enabled for this tenant",
      data: getTenantCallingModeState(settings),
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: "Failed to update system mode",
    });
  }
});

/* =========================================================
   VONAGE TEST
========================================================= */
app.get("/api/vonage/test", authMiddleware, requireRole("admin", "superadmin"), async (req, res) => {
  try {
    const auth = Buffer
      .from(`${process.env.VONAGE_API_KEY}:${process.env.VONAGE_API_SECRET}`)
      .toString("base64");

    const resp = await fetch("https://rest.nexmo.com/account/get-balance", {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });
    if (!resp.ok) throw new Error(`Vonage HTTP ${resp.status} ${resp.statusText}`);

    const data = await resp.json();
    const verification = buildVonageVerificationPayload({
      ok: true,
      code: "VERIFIED",
      message: "Vonage credentials verified successfully.",
      account: {
        apiKeyMasked: maskValue(process.env.VONAGE_API_KEY),
        applicationId: vonageApplicationId || "",
        dashboardUrl: process.env.VONAGE_DASHBOARD_URL || "https://dashboard.vonage.com",
        balance: data.value,
        currency: data.currency || "EUR",
        label: process.env.VONAGE_PLAN_NAME || "Vonage Voice Account",
      },
      checks: {
        credentials: true,
        application: true,
        numbers: true,
        preferredNumber: true,
      },
    });

    res.json({
      success: true,
      balance: data.value,
      currency: "EUR",
      account: verification.account,
      verification,
    });
  } catch (err) {
    console.error("Vonage test failed:", err);
    const verification = buildVonageVerificationPayload({
      ok: false,
      code: "AUTH_FAILED",
      message: err.message || "Failed to connect to Vonage",
      context: {
        httpStatus: /HTTP\s+(\d+)/i.exec(String(err?.message || ""))?.[1] || "",
      },
      account: {
        apiKeyMasked: maskValue(process.env.VONAGE_API_KEY),
        applicationId: vonageApplicationId || "",
      },
    });
    res.status(500).json({
      success: false,
      message: err.message || "Failed to connect to Vonage",
      verification,
    });
  }
});

/* =========================================================
   SUPPORT INBOX
========================================================= */
app.post("/api/support-ticket", authMiddleware, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || "default";
    const name = String(req.body?.name || "").trim();
    const email = normalizeSupportEmail(req.body?.email || req.user?.email || "");
    const phone = normalizeSupportPhone(req.body?.phone || "");
    const subject = String(req.body?.subject || "").trim();
    const category = String(req.body?.category || "general").trim() || "general";
    const priority = String(req.body?.priority || "normal").trim() || "normal";
    const message = String(req.body?.message || "").trim();

    if (!email || !message) {
      return res.status(400).json({
        success: false,
        message: "Email and message are required.",
      });
    }

    const conversation = await SupportConversation.create({
      tenantId,
      userId: req.user?._id || null,
      subject: subject || "Support request",
      category,
      priority,
      status: "open",
      source: "web",
      provider: "",
      customer: {
        name: name || `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim(),
        email,
        phone,
      },
      lastMessageAt: new Date(),
    });

    const firstMessage = await appendSupportMessage(conversation, {
      direction: "inbound",
      authorType: "customer",
      authorName: conversation.customer?.name || "Customer",
      channel: "web",
      content: message,
      metadata: {
        category,
        priority,
      },
    });

    return res.status(201).json({
      success: true,
      message: "Support request submitted.",
      conversation: buildSupportInboxPreview(conversation, firstMessage),
    });
  } catch (err) {
    console.error("Support ticket error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to submit support request.",
    });
  }
});

app.get("/api/support/conversations", authMiddleware, async (req, res) => {
  try {
    const isAdmin = req.user?.isSuperAdmin || req.user?.role === "admin";
    const filter = {};

    if (!isAdmin) {
      filter.tenantId = req.user?.tenantId || "default";
    } else if (req.query?.tenantId) {
      filter.tenantId = String(req.query.tenantId).trim();
    }

    if (req.query?.status) {
      filter.status = String(req.query.status).trim();
    }

    const conversations = await SupportConversation.find(filter)
      .sort({ lastMessageAt: -1, updatedAt: -1 })
      .limit(100)
      .lean();

    const ids = conversations.map((item) => item._id);
    const lastMessages = await SupportMessage.aggregate([
      { $match: { conversationId: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$conversationId",
          doc: { $first: "$$ROOT" },
        },
      },
    ]);

    const messageMap = new Map(
      lastMessages.map((item) => [String(item._id), item.doc])
    );

    return res.json({
      success: true,
      conversations: conversations.map((conversation) =>
        buildSupportInboxPreview(
          conversation,
          messageMap.get(String(conversation._id)) || null
        )
      ),
    });
  } catch (err) {
    console.error("Support inbox load error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load support conversations.",
    });
  }
});

app.get("/api/support/conversations/:id/messages", authMiddleware, async (req, res) => {
  try {
    const conversation = await findSupportConversationByAccess(req.params.id, req);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Support conversation not found.",
      });
    }

    const messages = await SupportMessage.find({
      conversationId: conversation._id,
    })
      .sort({ createdAt: 1 })
      .lean();

    return res.json({
      success: true,
      conversation: buildSupportInboxPreview(conversation),
      messages,
    });
  } catch (err) {
    console.error("Support thread load error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load support conversation.",
    });
  }
});

app.post("/api/support/conversations/:id/messages", authMiddleware, async (req, res) => {
  try {
    const conversation = await findSupportConversationByAccess(req.params.id, req);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Support conversation not found.",
      });
    }

    const content = String(req.body?.content || "").trim();
    if (!content) {
      return res.status(400).json({
        success: false,
        message: "Message content is required.",
      });
    }

    const isAdmin = req.user?.isSuperAdmin || req.user?.role === "admin";
    const message = await appendSupportMessage(conversation, {
      direction: "outbound",
      authorType: isAdmin ? "admin" : "customer",
      authorName:
        `${req.user?.firstName || ""} ${req.user?.lastName || ""}`.trim() ||
        req.user?.email ||
        "User",
      channel: "internal",
      content,
      metadata: {
        sentByUserId: req.user?._id || null,
      },
    });

    if (isAdmin) {
      conversation.status = "open";
      conversation.aiHandoff = {
        ...conversation.aiHandoff,
        requested: false,
      };
      await conversation.save();
    }

    return res.json({
      success: true,
      message: "Support message sent.",
      data: message,
    });
  } catch (err) {
    console.error("Support message send error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to send support message.",
    });
  }
});

app.post("/api/support/conversations/:id/ai-handoff", authMiddleware, async (req, res) => {
  try {
    const conversation = await findSupportConversationByAccess(req.params.id, req);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Support conversation not found.",
      });
    }

    const reason = String(req.body?.reason || "").trim();
    const summary = String(req.body?.summary || "").trim();

    conversation.status = "waiting_human";
    conversation.aiHandoff = {
      requested: true,
      requestedAt: new Date(),
      requestedBy: String(req.body?.requestedBy || "ai").trim() || "ai",
      reason,
      summary,
    };
    await conversation.save();

    await appendSupportMessage(conversation, {
      direction: "system",
      authorType: "ai",
      authorName: "AI Assistant",
      channel: "internal",
      content:
        summary ||
        "AI requested a human follow-up for this support conversation.",
      metadata: {
        reason,
        handoff: true,
      },
    });

    return res.json({
      success: true,
      message: "AI handoff recorded.",
      conversation: buildSupportInboxPreview(conversation),
    });
  } catch (err) {
    console.error("AI handoff error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to record AI handoff.",
    });
  }
});

app.post("/api/support/provider/webhook", verifySupportProviderWebhook, async (req, res) => {
  try {
    const tenantId = String(
      req.body?.tenantId || req.query?.tenantId || req.headers["x-tenant-id"] || ""
    ).trim();
    const provider = String(req.body?.provider || "generic").trim();
    const externalThreadId = String(
      req.body?.externalThreadId || req.body?.threadId || req.body?.conversationId || ""
    ).trim();
    const email = normalizeSupportEmail(
      req.body?.email || req.body?.fromEmail || req.body?.contactEmail || ""
    );
    const phone = normalizeSupportPhone(
      req.body?.phone || req.body?.from || req.body?.fromNumber || ""
    );
    const content = String(
      req.body?.message || req.body?.text || req.body?.body || ""
    ).trim();

    if (!tenantId || !content) {
      return res.status(400).json({
        success: false,
        message: "tenantId and message content are required.",
      });
    }

    let conversation = null;
    if (externalThreadId) {
      conversation = await SupportConversation.findOne({
        tenantId,
        externalThreadId,
      });
    }

    if (!conversation && (email || phone)) {
      conversation = await SupportConversation.findOne({
        tenantId,
        $or: [
          ...(email ? [{ "customer.email": email }] : []),
          ...(phone ? [{ "customer.phone": phone }] : []),
        ],
        status: { $in: ["open", "pending_ai", "waiting_human"] },
      }).sort({ updatedAt: -1 });
    }

    if (!conversation) {
      conversation = await SupportConversation.create({
        tenantId,
        subject: String(req.body?.subject || "Provider message").trim(),
        category: String(req.body?.category || "provider").trim(),
        priority: String(req.body?.priority || "normal").trim(),
        status: "open",
        source: "provider_webhook",
        provider,
        externalThreadId,
        customer: {
          name: String(req.body?.name || req.body?.fromName || "").trim(),
          email,
          phone,
        },
        lastMessageAt: new Date(),
      });
    } else {
      conversation.status = "open";
      conversation.provider = provider || conversation.provider;
      if (externalThreadId && !conversation.externalThreadId) {
        conversation.externalThreadId = externalThreadId;
      }
      await conversation.save();
    }

    const message = await appendSupportMessage(conversation, {
      direction: "inbound",
      authorType: "provider",
      authorName:
        String(req.body?.name || req.body?.fromName || "Provider Contact").trim(),
      channel: String(req.body?.channel || "email").trim(),
      content,
      providerMessageId: String(req.body?.providerMessageId || req.body?.messageId || "").trim(),
      metadata: req.body || {},
    });

    return res.json({
      success: true,
      conversation: buildSupportInboxPreview(conversation, message),
      messageId: message._id.toString(),
    });
  } catch (err) {
    console.error("Support provider webhook error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to process support provider webhook.",
    });
  }
});

/* =========================================================
   WEBHOOKS
========================================================= */
// 📍 LANDMARK 3: ENSURE YOUR STATUS WEBHOOK IS CORRECT

/* =========================================================
   WEBHOOKS
========================================================= */
// Note: This route MUST be /api/status to match the event_url


// 📍 END OF LANDMARK 3

// =========================================================
// END CALL (FIXED - Robust Validation)
// =========================================================
app.post("/api/end-call", authMiddleware, async (req, res) => {
  // ✅ VALIDATE UUID
  const { uuid } = req.body;
  
  if (!uuid || typeof uuid !== "string" || uuid.trim() === "") {
    return res.status(400).json({ 
      success: false, 
      message: "Missing or invalid call UUID" 
    });
  }

  try {
    // 1️⃣ Find call in DB (source of truth)
    let call = await Call.findOne({ uuid });

    // If not in DB, try memory (rare case)
    if (!call) {
      call = allCalls.find(c => c.uuid === uuid);
    }

    if (!call) {
      return res.status(404).json({
        success: false,
        message: "Call not found"
      });
    }

    // 🔒 Prevent ending already-ended calls
    const terminalStates = ["ended", "completed", "failed", "busy", "timeout", "rejected"];
    if (terminalStates.includes(call.status)) {
      return res.json({ 
        success: true, 
        message: "Call already ended" 
      });
    }

    // 2️⃣ Attempt Vonage hangup (non-blocking)
    try {
      if (vonage.voice?.updateCall) {
        await vonage.voice.updateCall(uuid, { action: "hangup" });
      }
    } catch (vonageErr) {
      logWarnDebug(`⚠️ Vonage hangup failed (non-blocking): ${vonageErr.message}`);
    }

    // 3️⃣ Calculate duration & update call
    const endTime = new Date();
    const startTime = new Date(call.createdAt);
    const durationSec = Math.floor((endTime - startTime) / 1000);
    const duration = `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, "0")}`;

    // Update call object
    call.status = "ended";
    call.endedAt = endTime;
    call.duration = duration;
    call.updatedAt = endTime;

    // 4️⃣ SAVE TO MONGODB (CRITICAL)
    await Call.findOneAndUpdate(
      { uuid },
      {
        status: "ended",
        endedAt: endTime,
        duration,
        updatedAt: endTime
      },
      { new: true }
    );

    // 5️⃣ Update in-memory array (if exists)
    const memIndex = allCalls.findIndex(c => c.uuid === uuid);
    if (memIndex !== -1) {
      allCalls[memIndex] = { ...call };
    }

    // 6️⃣ Broadcast update to ALL sockets
    io.emit("callUpdate", call);

    res.json({ 
      success: true, 
      message: "Call ended successfully",
      call 
    });

  } catch (err) {
    console.error("❌ End call error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to end call"
    });
  }
});


// 📍 LANDMARK 2: REPLACE THE OLD /voice ROUTE WITH THIS

// 📍 LANDMARK 2: REPLACE THE ENTIRE WEBHOOKS SECTION WITH THIS

/* =========================================================
   WEBHOOKS (CONSOLIDATED & CORRECTED)
========================================================= */

// THIS IS THE MAIN VOICE WEBHOOK FOR INSTRUCTIONS (NCCO)
// It MUST live at /api/voice to match the answer_url we build.
app.get("/api/voice", verifyVonageSignedWebhook, (req, res) => {
  const callId = req.query.callId || req.vonageWebhookContext?.callId;
  const targetNumber = req.query.target || req.vonageWebhookContext?.signedContext?.target;
  void writeVonageWebhookAudit("voice", req, {
    callId: String(callId || ""),
    targetNumber: String(targetNumber || ""),
  });
  logVonageDebug(`📞 VOICE WEBHOOK: Building NCCO to connect call to ${targetNumber}`);

  if (!targetNumber) {
    console.error("❌ VOICE WEBHOOK FAILED: No target number provided in URL.");
    return res.json([{ action: "talk", text: "We're sorry, an error occurred. The number to connect could not be found." }, { action: "hangup" }]);
  }

  const ncco = [
    { action: "talk", text: "Connecting..." },
    { action: "connect", endpoint: [{ type: "phone", number: targetNumber }] }
  ];
  return res.json(ncco);
});

// THIS IS THE MAIN STATUS WEBHOOK FOR CALL UPDATES
// It MUST live at /api/status to match the event_url we build.
app.post("/api/status", verifyVonageSignedWebhook, async (req, res) => {
  const {
    uuid,
    call_uuid,
    status,
    sub_state,
    detail,
    reason,
    conversation_uuid,
  } = req.body;
  const callUuid = call_uuid || uuid || conversation_uuid;
  const normalizedStatus = normalizeWebhookValue(status);
  const normalizedSubState = normalizeWebhookValue(sub_state);
  const humanMachineEvent = isHumanMachineEvent(req.body);

  logVonageDebug("🔔 STATUS WEBHOOK:", {
    uuid: callUuid,
    status,
    sub_state,
    reason,
    detail,
    raw: IS_PRODUCTION ? undefined : req.body,
  });
  void writeVonageWebhookAudit("status", req, {
    callUuid,
    callId: String(req.query.callId || ""),
    matchedAs: classifyWebhookMatch(req.body),
  });

  if (!callUuid) {
    logWarnDebug("⚠️ Status webhook received without a UUID.");
    return res.sendStatus(200);
  }

  const updatePayload = { updatedAt: new Date() };
  if (status && !humanMachineEvent) {
    updatePayload.status = status;
  }
  if (status === "failed" && detail) updatePayload.failReason = detail;
  if (normalizedStatus === "answered" || normalizedStatus === "human") {
    updatePayload.answeredAt = new Date();
  }
  if (normalizedStatus === "machine" && !normalizedSubState) {
    updatePayload.voicemailDetected = true;
  }

  const terminalStates = ["completed", "ended", "failed", "busy", "timeout", "rejected", "cancelled"];
  if (terminalStates.includes(status)) updatePayload.endedAt = new Date();

  try {
    const existingCall = await Call.findOne({ uuid: callUuid });

    if (existingCall && isVoicemailDetectionEvent(req.body)) {
      const voicemailCall = await handleDetectedVoicemail(existingCall);

      if (voicemailCall) {
        io.emit("callUpdate", voicemailCall);
      }

      return res.sendStatus(200);
    }

    if (existingCall && humanMachineEvent) {
      const machineUpdate = {
        ...updatePayload,
      };

      if (normalizedStatus === "human") {
        machineUpdate.status =
          existingCall.status === "voicemail" ? existingCall.status : "answered";
      }

      const updatedHumanMachineCall = await Call.findOneAndUpdate(
        { uuid: callUuid },
        { $set: machineUpdate },
        { new: true }
      ).lean();

      if (updatedHumanMachineCall) {
        io.emit("callUpdate", updatedHumanMachineCall);
      }

      return res.sendStatus(200);
    }

    const updatedCall = await Call.findOneAndUpdate({ uuid: callUuid }, { $set: updatePayload }, { new: true }).lean();
    if (updatedCall) {
      if (updatedCall.endedAt && updatedCall.createdAt && !updatedCall.duration) {
        const durationSec = Math.floor((new Date(updatedCall.endedAt) - new Date(updatedCall.createdAt)) / 1000);
        const mins = Math.floor(durationSec / 60);
        const secs = durationSec % 60;
        updatedCall.duration = `${mins}:${String(secs).padStart(2, "0")}`;
        await Call.findByIdAndUpdate(updatedCall._id, { duration: updatedCall.duration });
      }
      logVonageDebug(`   > DB updated for ${callUuid}. Emitting 'callUpdate'.`);
      io.emit("callUpdate", updatedCall);
    } else {
      logWarnDebug(`   > Could not find call with UUID ${callUuid} in the database.`);
    }
  } catch (dbErr) {
    console.error("⚠️ Mongo status update failed:", dbErr.message);
  }
  res.sendStatus(200);
});

// -----------------------------
// CSV NORMALIZATION HELPERS
// -----------------------------
function normalizeHeader(h = "") {
  return h
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/#/g, "number");
}

function normalizePhone(value) {
  if (!value) return null;

  let num = value.toString().replace(/\D/g, "").replace(/^0+/, "");

  if (num.length === 10) num = "1" + num;
  if (num.length === 11 && num.startsWith("1")) return `+${num}`;

  return null;
}

function normalizeDialerPhoneSetting(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  const digits = value.trim().replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (value.trim().startsWith("+")) return `+${digits}`;
  return `+${digits}`;
}

function normalizeWebhookUrlSetting(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }

  const isLocalhost = /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname);
  if (IS_PRODUCTION) {
    if (parsed.protocol !== "https:") return null;
    if (isLocalhost) return null;
  }

  return parsed.toString().replace(/\/+$/, "");
}

function normalizeVonageApplicationIdSetting(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  const normalized = value.trim().toLowerCase();
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return uuidPattern.test(normalized) ? normalized : null;
}

// =========================================================
// 🔁 BULK QUEUE WORKER (SAFE)
// Only starts processing when there is work to do
// =========================================================
const BULK_POLL_INTERVAL_MS = 10000;

setInterval(() => {
  try {
    // don't run before Vonage init
    if (!vonage) return;

    // don't run if already running
    if (isBulkCallRunning) return;

    // don't run if nothing queued
    if (!bulkCallQueue || bulkCallQueue.length === 0) return;

    processBulkQueue();
  } catch (err) {
    console.error("❌ Bulk worker crashed:", err?.message || err);
  }
}, BULK_POLL_INTERVAL_MS);

logDebug("🔁 Bulk queue worker started (safe)");
/* =========================================================
   CSV UPLOAD (UNIFIED, OFFLINE SAFE, SCHEMA CORRECT)
========================================================= */

const upload = multer({ dest: uploadDir });

app.post(
  "/api/upload-csv",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      logDebug("📥 CSV UPLOAD", {
        tenantId: req.user?.tenantId,
        userId: req.user?._id,
        hasFile: !!req.file,
      });

      // ----------------------------------
      // TENANT
      // ----------------------------------
      const tenantId =
        req.user?.tenantId || req.user?._id?.toString();

      if (!tenantId) {
        return res.status(400).json({
          success: false,
          message: "Tenant not resolved",
        });
      }

      let accessState;
      try {
        await assertCommercialAccessAllowed(tenantId);
        accessState = await getTenantAccessSnapshot({
          tenantId,
          userId: req.user?._id,
        });
      } catch (commercialErr) {
        return res.status(commercialErr.statusCode || 503).json({
          success: false,
          code: commercialErr.code || "COMMERCIAL_ACCESS_BLOCKED",
          message: commercialErr.message || "Commercial access is blocked",
        });
      }

      if (!accessState.effectiveAccess.canBulkCall) {
        return res.status(403).json({
          success: false,
          code: "TENANT_BULK_CALL_BLOCKED",
          message: "Bulk calling is blocked by tenant commercial or operational policy.",
          data: accessState,
        });
      }

      // ----------------------------------
      // MONGO MASTER SWITCH (SOURCE OF TRUTH)
      // ----------------------------------
      const settings = await ensureTenantSuspensionState(
        await getOrCreateLicenseSettings(tenantId)
      );
      const tenantMode = getTenantCallingModeState(settings);
      if (!settings.isEnabled) {
        return res.status(403).json({
          success: false,
          code: "TENANT_DISABLED",
          status: getTenantLicenseStatus(settings),
          reasonCode: settings.suspendReasonCode || "",
          reasonText: settings.suspendReasonText || "",
          disabledUntil: settings.disabledUntil || null,
          message: settings.suspendReason || "Account disabled",
        });
      }

      // ----------------------------------
      // LICENSE (ONLINE ONLY)
      // ----------------------------------
      if (tenantMode.effective === "live" && !USE_CONTROL_PLANE_SOURCE) {
        await enforceLicenseOrThrow(req);
      }

      // ----------------------------------
      // ONBOARDING / TEST MODE
      // ----------------------------------
      let onboardingState;
      try {
        onboardingState = await enforceOnboardingForCalling({
          tenantId,
          userId: req.user._id,
          mode: "bulk",
        });
      } catch (onboardingErr) {
        return res
          .status(onboardingErr.statusCode || 403)
          .json(onboardingErr.payload || {
            success: false,
            message:
              onboardingErr.message ||
              "Bulk calling is blocked until onboarding approval",
          });
      }
      const isTestMode = !!onboardingState?.isTestCall;

      // ----------------------------------
      // FILE CHECK
      // ----------------------------------
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }

      const filePath = req.file.path;
      const numbers = [];
      const headersMap = {};
      let phoneKey = null;

            // ----------------------------------
      // FIXED CSV PARSING LOGIC
      // ----------------------------------
      fs.createReadStream(filePath)
        .pipe(csv())
        .on("headers", (headers) => {
          headers.forEach((h) => {
            headersMap[normalizeHeader(h)] = h;
          });

          // Detect which column has the phone number
          phoneKey =
            headersMap["phone"] ||
            headersMap["number"] ||
            headersMap["phone number"] ||
            headersMap["mobile"] ||
            headersMap["to"];
        })
        .on("data", (row) => {
          // 1. Ensure we found a phone column
          if (!phoneKey) return;

          // 2. Normalize the phone number
          const phone = normalizePhone(row[phoneKey]);
          if (!phone) return;

          // 3. Extract Name & Address (Safe Method)
          let name = "Unknown";
          let address = "";
          let city = "";
          let state = "";
          let zip = "";

          // Scan all columns in this specific row
          Object.keys(row).forEach((rawHeader) => {
            const header = normalizeHeader(rawHeader);
            const value = String(row[rawHeader] || "").trim();

            if (!value) return;

            // Name Detection
            if (header.includes("name") || header.includes("first") || header.includes("contact")) {
              // Avoid "filename", "campaign name", etc.
              if (!header.includes("file") && !header.includes("campaign")) {
                name = value;
              }
            }

            // Address Detection
            if (header.includes("address") || header.includes("street")) address = value;
            if (header.includes("city")) city = value;
            if (header.includes("state") || header === "st") state = value;
            if (header.includes("zip") || header.includes("postal")) zip = value;
          });

          // 4. Push to array with metadata
          numbers.push({
            to: phone,
            number: phone,
            tenantId,
            metadata: {
              source: req.file.originalname,
              uploadedBy: req.user.email,
              isTestCall: isTestMode,
              // ✅ Save extracted data explicitly
              name: name,
              address: address,
              city: city,
              state: state,
              zip: zip
            },
          });
        })
        .on("end", async () => {
          fs.unlink(filePath, () => {}); // Clean up temp file

          if (!numbers.length) {
            return res.status(400).json({
              success: false,
              message: "No valid phone numbers found",
            });
          }

          try {
            // ----------------------------------
            // CREATE CALL RECORDS (MONGO = TRUTH)
            // ----------------------------------
            const callDocs = await Call.insertMany(
              numbers.map((n) => ({
                uuid: null,
                to: n.to,
                number: n.number,
                status: "queued",
                direction: "outbound",
                callType: "bulk", // ✅ Ensure type is bulk
                tenantId: n.tenantId,
                metadata: n.metadata || {},
                createdAt: new Date(),
                updatedAt: new Date(),
              }))
            );

            // Link analytics IDs
            callDocs.forEach((doc, i) => {
              numbers[i].analyticsId = doc._id.toString();
            });

            if (tenantMode.effective === "offline") {
              callDocs.forEach((doc, index) => {
                io.emit("callUpdate", doc);
                setTimeout(() => {
                  Call.findByIdAndUpdate(
                    doc._id,
                    {
                      $set: {
                        uuid: `offline-${doc._id.toString()}`,
                        status: "initiated",
                        updatedAt: new Date(),
                      },
                    },
                    { new: true }
                  )
                    .lean()
                    .then((updated) => {
                      if (updated) io.emit("callUpdate", updated);
                    })
                    .catch(() => {});
                }, 200 + index * 100);
              });

              return res.json({
                success: true,
                queued: numbers.length,
                count: numbers.length,
                mode: tenantMode.effective,
                testMode: isTestMode,
              });
            }

            // ----------------------------------
            // QUEUE & START PROCESSOR
            // ----------------------------------
            bulkCallQueue.push(...numbers);

            if (!isBulkCallRunning) {
              logDebug("🚀 Starting bulk call processor");
              processBulkQueue();
            }

            return res.json({
              success: true,
              queued: numbers.length,
              count: numbers.length, // Ensure count is sent back
              testMode: isTestMode,
            });
          } catch (err) {
            console.error("❌ Bulk CSV processing failed:", err);
            return res.status(500).json({
              success: false,
              message: "Failed to queue bulk calls",
            });
          }
        });

    } catch (err) {
      console.error("❌ CSV upload failed:", err);
      return res.status(500).json({
        success: false,
        message: err.message || "CSV upload failed",
      });
    }
  }
);


app.get("/api/scripts", authMiddleware, (req, res) => {
  res.json({ success: true, scripts: callScripts.filter((s) => s.isActive) });
});

app.post("/api/scripts", authMiddleware, async (req, res) => {
  const { name, content, category } = req.body;
  if (!name || !content) {
    return res.status(400).json({ success: false, message: "Name and content are required" });
  }

  const newScript = {
    id: uuidv4(),
    name,
    content,
    category: category || "general",
    isActive: true,
    createdAt: new Date(),
  };

  callScripts.push(newScript);
  try {
    await updateOnboardingSteps({
      tenantId: req.user.tenantId || "default",
      userId: req.user._id,
      updates: {
        scriptUploaded: true,
      },
    });
  } catch (e) {
    logErrorDebug("Onboarding script create update failed:", e.message);
  }
  res.status(201).json({ success: true, message: "Script created successfully", script: newScript });
});

app.put("/api/scripts/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, content, category } = req.body;

  const index = callScripts.findIndex((s) => s.id === id);
  if (index === -1) return res.status(404).json({ success: false, message: "Script not found" });
  if (!name || !content) return res.status(400).json({ success: false, message: "Name and content are required" });

  callScripts[index] = {
    ...callScripts[index],
    name,
    content,
    category: category || callScripts[index].category,
    updatedAt: new Date(),
  };
  try {
    await updateOnboardingSteps({
      tenantId: req.user.tenantId || "default",
      userId: req.user._id,
      updates: {
        scriptUploaded: true,
      },
    });
  } catch (e) {
    logErrorDebug("Onboarding script update failed:", e.message);
  }
  res.json({ success: true, message: "Script updated successfully", script: callScripts[index] });
});

app.delete("/api/scripts/:id", authMiddleware, (req, res) => {
  const { id } = req.params;
  const before = callScripts.length;
  callScripts = callScripts.filter((s) => s.id !== id);
  if (callScripts.length === before) return res.status(404).json({ success: false, message: "Script not found" });
  res.json({ success: true, message: "Script deleted successfully" });
});

/* =========================================================
   VOICEMAIL
========================================================= */
app.get("/api/voicemail-messages", authMiddleware, async (req, res) => {
  try {
    const { settings, activeMessage } = await getVoicemailRuntimeConfig();
    const messages = await VoicemailMessage.find({}).sort({ createdAt: -1 }).lean();

    res.json({
      success: true,
      messages,
      activeId: activeMessage?._id?.toString() || "",
      voices: TTS_VOICES,
      enabled:
        typeof settings.enableVoicemailDrop === "boolean"
          ? settings.enableVoicemailDrop
          : true,
    });
  } catch (err) {
    console.error("GET /api/voicemail-messages error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to load voicemail messages.",
    });
  }
});

function buildVonageSuggestedActions(code, context = {}) {
  switch (code) {
    case "MISSING_CREDENTIALS":
      return [
        "Enter the Vonage API key, API secret, application ID, and private key.",
        "Paste the private key exactly as downloaded from the Vonage dashboard.",
      ];
    case "AUTH_FAILED":
      return [
        "Confirm the API key and API secret belong to the same Vonage account.",
        "Check for copied whitespace or truncated values in the credentials.",
      ];
    case "APPLICATION_INVALID":
      return [
        "Confirm the application ID is a valid Vonage Voice application UUID.",
        "Make sure the private key belongs to that same application.",
      ];
    case "NO_NUMBERS":
      return [
        "Buy or assign at least one voice-capable Vonage number to this account.",
        "Verify the account has Voice API access enabled.",
      ];
    case "PREFERRED_NUMBER_NOT_FOUND":
      return [
        "Choose a number that exists in the account's owned numbers list.",
        `The requested number ${context.preferredNumber || ""} was not found in this account.`,
      ];
    default:
      return [
        "Retry verification after confirming the credentials in the Vonage dashboard.",
        "If the issue persists, review account permissions and Voice API setup.",
      ];
  }
}

function buildVonageAiExplanation(code, context = {}) {
  switch (code) {
    case "MISSING_CREDENTIALS":
      return "The verification request was incomplete, so Vynce could not prove the Vonage setup belongs to this tenant yet.";
    case "AUTH_FAILED":
      return "Vonage rejected the account authentication step, which usually means the API key and secret do not match or the credentials are no longer valid.";
    case "APPLICATION_INVALID":
      return "The account credentials may be valid, but the Voice application pairing is not. This often happens when the application ID and private key come from different Vonage apps.";
    case "NO_NUMBERS":
      return "The account authenticated successfully, but there are no owned voice numbers available for outbound calling, so onboarding should stay blocked.";
    case "PREFERRED_NUMBER_NOT_FOUND":
      return "The account is reachable, but the selected outbound number is not part of the tenant's Vonage inventory, so Vynce cannot safely use it.";
    default:
      if (context.httpStatus) {
        return `Vonage returned an unexpected response during verification (HTTP ${context.httpStatus}). This should be treated as a real connectivity or credential issue until rechecked.`;
      }
      return "Vonage verification failed in a way that Vynce could not classify cleanly, so the tenant should remain unverified until a successful retry completes.";
  }
}

function buildVonageVerificationPayload({
  ok,
  code,
  message,
  checkedAt = new Date(),
  account = {},
  checks = {},
  context = {},
}) {
  const checkedAtIso =
    checkedAt instanceof Date ? checkedAt.toISOString() : new Date(checkedAt).toISOString();
  const aiExplanation = ok ? "" : buildVonageAiExplanation(code, context);

  return {
    status: ok ? "verified" : "failed",
    checkedAt: checkedAtIso,
    verifiedAt: ok ? checkedAtIso : null,
    code: code || (ok ? "VERIFIED" : "FAILED"),
    message,
    aiExplanation,
    suggestedActions: ok ? [] : buildVonageSuggestedActions(code, context),
    account: {
      apiKeyMasked: account.apiKeyMasked || "",
      applicationId: account.applicationId || "",
      outboundNumber: account.outboundNumber || "",
      dashboardUrl:
        account.dashboardUrl ||
        process.env.VONAGE_DASHBOARD_URL ||
        "https://dashboard.vonage.com",
      balance:
        account.balance === undefined || account.balance === null
          ? ""
          : String(account.balance),
      currency: account.currency || "",
      label: account.label || process.env.VONAGE_PLAN_NAME || "Vonage Voice Account",
    },
    checks: {
      credentials: !!checks.credentials,
      application: !!checks.application,
      numbers: !!checks.numbers,
      preferredNumber: !!checks.preferredNumber,
      webhookSignature: !!checks.webhookSignature,
    },
  };
}

function normalizeSupportPhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return value.startsWith("+") ? value : `+${digits}`;
}

function normalizeSupportEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function buildSupportInboxPreview(conversation, lastMessage = null) {
  return {
    id: conversation._id.toString(),
    tenantId: conversation.tenantId,
    subject: conversation.subject || "Support conversation",
    category: conversation.category || "general",
    priority: conversation.priority || "normal",
    status: conversation.status || "open",
    source: conversation.source || "web",
    provider: conversation.provider || "",
    externalThreadId: conversation.externalThreadId || "",
    customer: conversation.customer || {},
    aiHandoff: conversation.aiHandoff || {},
    updatedAt: conversation.updatedAt,
    lastMessageAt: conversation.lastMessageAt || conversation.updatedAt,
    lastMessage: lastMessage
      ? {
          content: lastMessage.content,
          authorType: lastMessage.authorType,
          direction: lastMessage.direction,
          createdAt: lastMessage.createdAt,
        }
      : null,
  };
}

async function appendSupportMessage(conversation, {
  direction = "inbound",
  authorType = "customer",
  authorName = "",
  channel = "web",
  content,
  providerMessageId = "",
  metadata = {},
}) {
  const message = await SupportMessage.create({
    conversationId: conversation._id,
    tenantId: conversation.tenantId,
    direction,
    authorType,
    authorName,
    channel,
    content,
    providerMessageId,
    metadata,
  });

  conversation.lastMessageAt = new Date();
  await conversation.save();

  return message;
}

async function findSupportConversationByAccess(id, req) {
  const filter = { _id: id };
  if (!(req.user?.isSuperAdmin || req.user?.role === "admin")) {
    filter.tenantId = req.user?.tenantId || "default";
  }

  return SupportConversation.findOne(filter);
}

function verifySupportProviderWebhook(req, res, next) {
  const expected = String(process.env.SUPPORT_PROVIDER_WEBHOOK_SECRET || "").trim();

  if (!expected) {
    if (IS_PRODUCTION) {
      return res.status(503).json({
        success: false,
        message: "Support provider webhook secret is not configured.",
      });
    }
    return next();
  }

  const provided = String(req.headers["x-support-webhook-secret"] || "").trim();
  if (!provided || provided !== expected) {
    return res.status(401).json({
      success: false,
      message: "Invalid support provider webhook secret.",
    });
  }

  return next();
}

app.post("/api/voicemail-messages", authMiddleware, async (req, res) => {
  try {
    const { id, name, content, voiceId, isActive = false } = req.body;

    if (!name || !content || !voiceId) {
      return res.status(400).json({
        success: false,
        message: "Name, content, and voice are required.",
      });
    }

    let settings = await Settings.findOne({ singleton: true });
    if (!settings) {
      settings = new Settings({ singleton: true });
    }

    let messageDoc;
    if (id) {
      messageDoc = await VoicemailMessage.findByIdAndUpdate(
        id,
        { name, content, voiceId },
        { new: true }
      );

      if (!messageDoc) {
        return res.status(404).json({
          success: false,
          message: "Voicemail message not found.",
        });
      }
    } else {
      messageDoc = await VoicemailMessage.create({
        name,
        content,
        voiceId,
        isActive: false,
      });
    }

    const shouldActivate =
      isActive || !(await VoicemailMessage.exists({ isActive: true }));

    if (shouldActivate) {
      await VoicemailMessage.updateMany({}, { $set: { isActive: false } });
      await VoicemailMessage.findByIdAndUpdate(messageDoc._id, {
        $set: { isActive: true },
      });
      settings.activeVoicemailId = messageDoc._id.toString();
      await settings.save();
    }

    const freshMessage = await VoicemailMessage.findById(messageDoc._id).lean();

    return res.status(id ? 200 : 201).json({
      success: true,
      message: id ? "Voicemail updated." : "Voicemail created.",
      data: freshMessage,
    });
  } catch (err) {
    console.error("POST /api/voicemail-messages error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to save voicemail message.",
    });
  }
});

app.post("/api/voicemail-messages/:id/activate", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const messageDoc = await VoicemailMessage.findById(id);

    if (!messageDoc) {
      return res.status(404).json({
        success: false,
        message: "Voicemail message not found.",
      });
    }

    await VoicemailMessage.updateMany({}, { $set: { isActive: false } });
    messageDoc.isActive = true;
    await messageDoc.save();

    let settings = await Settings.findOne({ singleton: true });
    if (!settings) {
      settings = new Settings({ singleton: true });
    }
    settings.activeVoicemailId = messageDoc._id.toString();
    await settings.save();

    activeVoicemailId = messageDoc._id.toString();

    res.json({
      success: true,
      message: "Active voicemail updated.",
      data: messageDoc.toObject(),
    });
  } catch (err) {
    console.error("POST /api/voicemail-messages/:id/activate error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to activate voicemail message.",
    });
  }
});

app.post("/api/voicemail-settings", authMiddleware, async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Enabled must be a boolean value.",
      });
    }

    let settings = await Settings.findOne({ singleton: true });
    if (!settings) {
      settings = new Settings({ singleton: true });
    }

    settings.enableVoicemailDrop = enabled;
    await settings.save();
    dialerSettings.enableVoicemailDrop = enabled;

    res.json({
      success: true,
      enabled,
      message: enabled
        ? "Voicemail drop enabled."
        : "Voicemail drop disabled.",
    });
  } catch (err) {
    console.error("POST /api/voicemail-settings error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to update voicemail settings.",
    });
  }
});

// Call notes
// =========================================
// ✅ SAVE CALL NOTES (NEW ROUTE)
// =========================================
app.post("/api/calls/:uuid/notes", authMiddleware, async (req, res) => {
  try {
    const { uuid } = req.params;
    const { content, outcome } = req.body;

    // Find the call in the database using the UUID
    const call = await Call.findOne({ uuid });

    if (!call) {
      return res.status(404).json({ success: false, message: "Call not found" });
    }

    // Update the call record with notes and outcome
    call.notes = content || "";
    call.outcome = outcome || "";
    call.updatedAt = new Date();

    await call.save();

    // Broadcast the update to all clients
    io.emit("callUpdate", call.toObject());

    res.json({ success: true, message: "Notes saved successfully", call: call.toObject() });
  } catch (err) {
    console.error("❌ Error saving call notes:", err);
    res.status(500).json({ success: false, message: "Failed to save notes" });
  }
});
/* =========================================================
   START SERVER + ROUTE LOGGING (SINGLE SOURCE OF TRUTH)
========================================================= */

/* =========================================================
   BULK CONTROL
========================================================= */
app.get("/api/debug/calls-count", authMiddleware, adminOnly, async (req, res) => {
  const count = await Call.countDocuments();
  res.json({ success: true, count });
});

app.post("/api/bulk/pause", authMiddleware, adminOnly, (req, res) => {
  bulkPaused = true;
  io.emit("bulkPaused");
  res.json({ success: true });
});

app.post("/api/bulk/resume", authMiddleware, adminOnly, (req, res) => {
  bulkPaused = false;
  io.emit("bulkResumed");
  res.json({ success: true });
});

app.post("/api/bulk/stop", authMiddleware, adminOnly, (req, res) => {
  bulkStopped = true;
  bulkPaused = false;
  bulkCallQueue = [];
  io.emit("bulkStopped");
  res.json({ success: true });
});

/* =========================================================
   CALLS LIST (OFFLINE + ONLINE SAFE)
========================================================= */
// =======================================================
// 📋 CALLS LIST (OFFLINE + ONLINE)
// =======================================================
// In dialer.js, confirm this route exists and uses authMiddleware
app.get("/api/calls", authMiddleware, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || "default";

    // Fetch ALL saved calls for this user/tenant
    const calls = await Call.find({ tenantId })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return res.json({
      success: true,
      calls: calls.map(c => ({ ...c, id: c._id.toString() })) // Ensure we have a stable ID
    });
  } catch (err) {
    console.error("Calls fetch error:", err);
    return res.status(500).json({ success: false, message: "Failed to load calls" });
  }
});


/* =========================================================
   ANALYTICS (MongoDB)
========================================================= */
app.get("/api/analytics", authMiddleware, async (req, res) => {
  try {
    const [
      totalCalls,
      completed,
      failed,
      voicemail,
      avgDurationAgg,
      callsPerDayAgg,
    ] = await Promise.all([
      Call.countDocuments(),
      Call.countDocuments({ status: "completed" }),
      Call.countDocuments({ status: "failed" }),
      Call.countDocuments({ voicemailDetected: true }),
      Call.aggregate([
        { $match: { answeredAt: { $exists: true }, endedAt: { $exists: true } } },
        {
          $project: {
            durationSeconds: {
              $divide: [{ $subtract: ["$endedAt", "$answeredAt"] }, 1000],
            },
          },
        },
        { $group: { _id: null, avgDurationSeconds: { $avg: "$durationSeconds" } } },
      ]),
      Call.aggregate([
        {
          $match: {
            createdAt: {
              $gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
            },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const avgDurationSeconds =
      avgDurationAgg.length > 0
        ? Math.floor(avgDurationAgg[0].avgDurationSeconds)
        : 0;

    res.json({
      success: true,
      metrics: {
        totalCalls,
        completed,
        failed,
        voicemail,
        avgDurationSeconds,
        callsPerDay: callsPerDayAgg.map((d) => ({
          date: d._id,
          count: d.count,
        })),
      },
    });
  } catch (err) {
    console.error("Mongo analytics error:", err);
    res.status(500).json({ success: false, message: "Failed to load analytics" });
  }
});

/* =========================================================
   BULK STATUS
========================================================= */
app.get("/api/bulk/status", authMiddleware, (req, res) => {
  res.json({
    success: true,
    running: !!isBulkCallRunning,
    paused: !!bulkPaused,
  });
});




/* =========================================================
   LICENSE STATUS
========================================================= */
app.get("/api/license/runtime-status", authMiddleware, (req, res) => {
  const payload = global.currentLicensePayload;

  if (!payload) {
    return res.status(403).json({
      ok: false,
      status: "invalid",
      message: "No license loaded",
    });
  }

  res.json({
    ok: true,
    status: String(payload.status || "active").toLowerCase(),
    license_id: payload.license_id || null,
    tenant_id: payload.tenant_id || null,
    plan: payload.plan || "standard",
    issued_at: payload.iat ? payload.iat * 1000 : null,
    expires_at: payload.exp ? payload.exp * 1000 : null,
    usage: {
      callLimit: Number(payload.limits?.calls ?? 0),
      callsUsed: Number(payload.usage?.callsUsed ?? 0),
    },
    features: payload.features || {},
  });
});
// Agent-safe license check
/* =========================================================
   AGENT LICENSE STATUS (SAFE)
========================================================= */
app.get("/api/agent/license", authMiddleware, async (req, res) => {
  try {
    const tenantId = req.user?.tenantId || "default";
    const settings = await ensureTenantSuspensionState(
      await getOrCreateLicenseSettings(tenantId)
    );

    return res.json({
      success: true,
      data: buildTenantLicenseResponse(settings),
    });
  } catch (err) {
    console.error("Agent license fetch error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to load license status",
    });
  }
});




