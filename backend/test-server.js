import "dotenv/config";
import http from "http";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://127.0.0.1:5174",
      "http://localhost:5174",
      "http://127.0.0.1:5175",
      "http://localhost:5175",
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ],
    credentials: true,
  },
});

app.use(
  cors({
    origin(origin, callback) {
      const allowedOrigins = new Set([
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
        "http://127.0.0.1:5175",
        "http://localhost:5175",
      ]);

      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const JWT_SECRET = "test-secret-key";
const ACCESS_TTL = "7d";

let users = [
  {
    id: "1",
    email: "admin@vynce.com",
    password: await bcrypt.hash("Password", 10),
    firstName: "Admin",
    lastName: "User",
    company: "Vynce Inc",
    role: "admin",
    isSuperAdmin: true,
    tenantId: "tenant-admin",
    subscription: buildSubscriptionSnapshot("professional"),
  },
];

let calls = [];
let bulkStatus = {
  running: false,
  paused: false,
  campaignName: "",
};
let appSettings = {
  callerId: "",
  timeZone: "America/Jamaica",
  forwardTo: "",
  publicWebhookUrl: "",
  bulkDelayMs: 1500,
  enableVoicemailDrop: true,
  activeVoicemailId: "default",
};
let vonageVerificationByTenant = {};

function buildSubscriptionSnapshot(plan = "professional", overrides = {}) {
  const normalizedPlan = String(plan || "professional").trim().toLowerCase();
  const includedActiveUsers =
    normalizedPlan === "team"
      ? 5
      : normalizedPlan === "enterprise"
        ? Number.MAX_SAFE_INTEGER
        : 1;
  const additionalAgentPrice = normalizedPlan === "professional" ? 250 : 0;
  const monthlyPrice =
    normalizedPlan === "team"
      ? 599
      : normalizedPlan === "enterprise"
        ? 0
        : normalizedPlan === "starter"
          ? 149
          : 199;

  return {
    plan: ["starter", "professional", "team", "enterprise"].includes(normalizedPlan)
      ? normalizedPlan
      : "professional",
    status: overrides.status || "active",
    maxCalls: 0,
    unlimitedCalls: true,
    includedActiveUsers,
    additionalAgentSeats: Number(overrides.additionalAgentSeats || 0),
    additionalAgentPrice,
    monthlyPrice,
  };
}

function getTenantSeatSnapshot(tenantId) {
  const tid = String(tenantId || "default").trim() || "default";
  const tenant = ensureTenant(tid);
  const tenantUsers = users.filter((user) => user.tenantId === tid);
  const activeUsers = tenantUsers.filter((user) => !user.isDisabled);
  const plan = String(tenant.plan || tenantUsers[0]?.subscription?.plan || "professional").trim().toLowerCase();
  const includedActiveUsers =
    Number(tenantUsers[0]?.subscription?.includedActiveUsers) ||
    buildSubscriptionSnapshot(plan).includedActiveUsers;
  const additionalAgentSeats = Math.max(
    0,
    Number(tenantUsers[0]?.subscription?.additionalAgentSeats || 0)
  );
  const totalSeats =
    includedActiveUsers >= Number.MAX_SAFE_INTEGER
      ? Number.MAX_SAFE_INTEGER
      : includedActiveUsers + additionalAgentSeats;
  const finiteSeats = totalSeats < Number.MAX_SAFE_INTEGER;

  return {
    tenantId: tid,
    plan,
    companyName: tenant.companyName || tenantUsers[0]?.company || "Unknown",
    includedActiveUsers,
    additionalAgentSeats,
    totalSeats: finiteSeats ? totalSeats : Infinity,
    activeUserCount: activeUsers.length,
    availableSeats: finiteSeats ? Math.max(totalSeats - activeUsers.length, 0) : Infinity,
    additionalAgentPrice: buildSubscriptionSnapshot(plan).additionalAgentPrice,
    canAddUser: !finiteSeats || activeUsers.length < totalSeats,
    users: tenantUsers.map((user) => ({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      isDisabled: !!user.isDisabled,
      createdAt: user.createdAt || null,
    })),
  };
}

function syncTenantSubscriptions(tenantId, plan, additionalAgentSeats = 0) {
  users = users.map((user) =>
    user.tenantId === tenantId
      ? {
          ...user,
          subscription: buildSubscriptionSnapshot(plan, { additionalAgentSeats }),
        }
      : user
  );
}

function buildOfflineVonageVerification({ ok, tenantId, preferredNumber = "", code, message }) {
  return {
    status: ok ? "verified" : "failed",
    checkedAt: new Date().toISOString(),
    verifiedAt: ok ? new Date().toISOString() : null,
    code: code || (ok ? "VERIFIED" : "FAILED"),
    message,
    aiExplanation: ok
      ? ""
      : "Offline mode cannot contact Vonage, so this result is only a local simulation of the real verification workflow.",
    suggestedActions: ok
      ? []
      : ["Use the real backend environment to run a live Vonage verification."],
    account: verification.account || {
      apiKeyMasked: "test••••••",
      applicationId: appSettings.vonageApplicationId || "",
      outboundNumber: preferredNumber || "",
      dashboardUrl: "https://dashboard.vonage.com",
      balance: "Offline",
      currency: "",
      label: "Offline Vonage Simulation",
    },
    checks: {
      credentials: ok,
      application: ok,
      numbers: ok,
      preferredNumber: ok,
    },
    tenantId,
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

function buildSupportConversationPreview(conversation, lastMessage = null) {
  return {
    id: conversation.id,
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

function appendSupportMessage(conversation, payload) {
  const message = {
    id: uuidv4(),
    conversationId: conversation.id,
    tenantId: conversation.tenantId,
    direction: payload.direction || "inbound",
    authorType: payload.authorType || "customer",
    authorName: payload.authorName || "",
    channel: payload.channel || "web",
    providerMessageId: payload.providerMessageId || "",
    content: payload.content,
    metadata: payload.metadata || {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  supportMessages.push(message);
  conversation.lastMessageAt = message.createdAt;
  conversation.updatedAt = message.updatedAt;
  return message;
}

function findSupportConversationByAccess(id, req) {
  const isAdmin = req.user?.isSuperAdmin || req.user?.role === "admin";
  return supportConversations.find(
    (conversation) =>
      conversation.id === id &&
      (isAdmin || conversation.tenantId === (req.user?.tenantId || "default"))
  );
}

function verifySupportProviderWebhook(req, res, next) {
  const expected = String(process.env.SUPPORT_PROVIDER_WEBHOOK_SECRET || "").trim();
  if (!expected) return next();

  const provided = String(req.headers["x-support-webhook-secret"] || "").trim();
  if (!provided || provided !== expected) {
    return res.status(401).json({
      success: false,
      message: "Invalid support provider webhook secret.",
    });
  }
  return next();
}

const TTS_VOICES = [
  { id: "Amy", label: "Amy (US Female)" },
  { id: "Joey", label: "Joey (US Male)" },
  { id: "Emma", label: "Emma (UK Female)" },
];

let voicemailMessages = [
  {
    id: "default",
    _id: "default",
    name: "Default Message",
    content: "Hello, this is [Agent] from [Company]. Please call us back at [Number].",
    voiceId: "Amy",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
];

let supportConversations = [];
let supportMessages = [];

let callScripts = [
  {
    id: "1",
    _id: "1",
    name: "Sales Introduction",
    content: "Hello [Name], this is [Agent] from Vynce. I wanted to quickly introduce our platform and see if this is a good time to talk.",
    category: "sales",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "2",
    _id: "2",
    name: "Follow-up Check-in",
    content: "Hi [Name], this is [Agent] following up on our previous conversation. I wanted to see if you had any questions before we move forward.",
    category: "followup",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
];

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    company: user.company,
    role: user.role,
    isSuperAdmin: !!user.isSuperAdmin,
    tenantId: user.tenantId,
    subscription: user.subscription,
  };
}

function signToken(user) {
  return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: ACCESS_TTL,
  });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ success: false, message: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = users.find((candidate) => candidate.id === payload.userId);

    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid session" });
    }

    req.user = user;
    req.user.tenantId = user.tenantId || `tenant-${user.id}`;
    return next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid session" });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role === "admin" || req.user?.isSuperAdmin === true) {
    return next();
  }

  return res.status(403).json({ success: false, message: "Admin only" });
}

let tenantSettings = {
  "tenant-admin": {
    tenantId: "tenant-admin",
    companyName: "Vynce Inc",
    contactEmail: "admin@vynce.com",
    licenseId: "vynce-tenant-admin",
    plan: "professional",
    isEnabled: true,
    status: "active",
    reasonCode: "",
    reasonText: "",
    suspendReason: "",
    disabledUntil: null,
    updatedAt: new Date().toISOString(),
    updatedBy: {
      email: "system@offline.local",
      role: "system",
    },
  },
};

let licenseAuditLogs = [];
let onboardingByTenant = {};
let onboardingReviewsByTenant = {};
const VONAGE_WEBHOOK_AUDIT_ENABLED =
  (process.env.VONAGE_WEBHOOK_AUDIT || "false").toLowerCase() === "true";
let vonageWebhookAuditLogs = [];

function normalizeReasonCode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  return ["non_payment", "abuse", "manual_review", "compliance", "other"].includes(
    normalized
  )
    ? normalized
    : "";
}

function getTenantStatus(tenant) {
  if (!tenant.isEnabled) {
    if (
      tenant.disabledUntil &&
      new Date(tenant.disabledUntil).getTime() > Date.now()
    ) {
      return "temporarily_suspended";
    }
    return "suspended";
  }

  return "active";
}

function ensureTenant(tenantId, overrides = {}) {
  const key = tenantId || "default";
  if (!tenantSettings[key]) {
    tenantSettings[key] = {
      tenantId: key,
      companyName: overrides.companyName || "Unknown",
      contactEmail: overrides.contactEmail || "",
      licenseId: `vynce-${key}`,
      plan: overrides.plan || "professional",
      callingMode: overrides.callingMode || "offline",
      isEnabled: true,
      status: "active",
      reasonCode: "",
      reasonText: "",
      suspendReason: "",
      disabledUntil: null,
      updatedAt: new Date().toISOString(),
      updatedBy: {
        email: "system@offline.local",
        role: "system",
      },
    };
  }

  const tenant = tenantSettings[key];
  if (
    tenant.isEnabled === false &&
    tenant.disabledUntil &&
    new Date(tenant.disabledUntil).getTime() <= Date.now()
  ) {
    tenant.isEnabled = true;
    tenant.disabledUntil = null;
    tenant.reasonCode = "";
    tenant.reasonText = "";
    tenant.suspendReason = "";
    tenant.updatedAt = new Date().toISOString();
  }

  tenant.status = getTenantStatus(tenant);
  return tenant;
}

function formatTenantLicenseData(tenant) {
  return {
    tenantId: tenant.tenantId,
    companyName: tenant.companyName,
    isEnabled: tenant.isEnabled,
    status: tenant.status,
    suspendReason: tenant.suspendReason || "",
    reasonCode: tenant.reasonCode || "",
    reasonText: tenant.reasonText || "",
    disabledUntil: tenant.disabledUntil || null,
    plan: tenant.plan || "professional",
    limits: { maxCallsPerDay: 5000 },
    updatedAt: tenant.updatedAt,
    updatedBy: tenant.updatedBy || null,
    licenseIdentity: {
      company: tenant.companyName,
      tenantId: tenant.tenantId,
      licenseId: tenant.licenseId,
      plan: tenant.plan || "professional",
    },
    mode: {
      requested: tenant.callingMode || "offline",
      effective: "offline",
      liveAvailable: false,
      reason:
        tenant.callingMode === "live"
          ? "Live provider calling is not available in the offline server."
          : null,
    },
  };
}

function defaultOnboardingSteps() {
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

function normalizeOnboardingSteps(steps = {}) {
  const defaults = defaultOnboardingSteps();
  const normalized = { ...defaults };

  Object.keys(defaults).forEach((key) => {
    if (key in steps) normalized[key] = Boolean(steps[key]);
  });

  return normalized;
}

function ensureOnboarding(tenantId, ownerUserId = "") {
  const key = String(tenantId || "default").trim() || "default";

  if (!onboardingByTenant[key]) {
    onboardingByTenant[key] = {
      tenantId: key,
      ownerUserId: ownerUserId || null,
      steps: defaultOnboardingSteps(),
      submittedForReviewAt: null,
      lastSubmittedBy: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  onboardingByTenant[key].steps = normalizeOnboardingSteps(onboardingByTenant[key].steps);
  if (ownerUserId && !onboardingByTenant[key].ownerUserId) {
    onboardingByTenant[key].ownerUserId = ownerUserId;
  }

  return onboardingByTenant[key];
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
  return {
    success: false,
    code: "ONBOARDING_INCOMPLETE",
    message:
      message ||
      "Complete all required onboarding steps before requesting admin approval.",
    missingSteps: Array.isArray(missingStepsOverride)
      ? missingStepsOverride
      : getMissingRequiredOnboardingSteps(steps),
    completion: getOnboardingCompletionSummary(steps),
  };
}

function ensureOnboardingReview(tenantId) {
  const key = String(tenantId || "default").trim() || "default";

  if (!onboardingReviewsByTenant[key]) {
    onboardingReviewsByTenant[key] = {
      tenantId: key,
      status: "draft",
      submittedAt: null,
      reviewedAt: null,
      reviewedBy: null,
      adminNotes: "",
      requiredChanges: [],
      approvedForLiveCalling: false,
      approvedForBilling: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  return onboardingReviewsByTenant[key];
}

function buildOnboardingPayload(tenantId, ownerUserId = "") {
  const onboarding = ensureOnboarding(tenantId, ownerUserId);
  const review = ensureOnboardingReview(tenantId);
  const missingRequiredSteps = getMissingRequiredOnboardingSteps(onboarding.steps);
  const missingReviewBlockingSteps = getReviewBlockingOnboardingSteps(onboarding.steps);

  return {
    tenantId,
    ownerUserId: onboarding.ownerUserId || null,
    steps: onboarding.steps,
    completion: getOnboardingCompletionSummary(onboarding.steps),
    requiredSteps: REQUIRED_ONBOARDING_STEP_KEYS,
    missingRequiredSteps,
    missingReviewBlockingSteps,
    canSubmitForReview: missingReviewBlockingSteps.length === 0,
    review: {
      status: review.status,
      submittedAt: review.submittedAt || onboarding.submittedForReviewAt || null,
      reviewedAt: review.reviewedAt,
      reviewedBy: review.reviewedBy,
      adminNotes: review.adminNotes || "",
      requiredChanges: review.requiredChanges || [],
      approvedForLiveCalling: !!review.approvedForLiveCalling,
      approvedForBilling: !!review.approvedForBilling,
    },
    submittedForReviewAt: onboarding.submittedForReviewAt,
    canGoLive:
      review.status === "approved" &&
      !!review.approvedForLiveCalling &&
      missingRequiredSteps.length === 0,
  };
}

function buildCallingPermissions(onboarding) {
  const reviewStatus = onboarding?.review?.status || "draft";
  const testCallCompleted = !!onboarding?.steps?.testCallCompleted;
  const canGoLive = !!onboarding?.canGoLive;

  return {
    canSingleCall: canGoLive || !testCallCompleted,
    canBulkCall: canGoLive,
    testCallAvailable: !canGoLive && !testCallCompleted,
    requiresApproval: !canGoLive,
    reviewStatus,
  };
}

function buildOnboardingBlockedPayload(payload, mode) {
  return {
    success: false,
    code: "ONBOARDING_APPROVAL_REQUIRED",
    onboarding: payload.review,
    canGoLive: !!payload.canGoLive,
    message:
      mode === "bulk"
        ? "Tenant onboarding is not approved yet. Bulk calling is blocked until admin approval."
        : "Tenant onboarding is not approved yet. You can complete one test call before approval, but additional live calling is blocked until admin approval.",
  };
}

function enforceOnboardingForCalling(tenantId, mode, ownerUserId = "") {
  const payload = buildOnboardingPayload(tenantId, ownerUserId);

  if (payload.canGoLive) {
    return { payload, isTestCall: false };
  }

  if (mode === "bulk") {
    const err = new Error("Bulk calling is blocked until onboarding approval.");
    err.statusCode = 403;
    err.payload = buildOnboardingBlockedPayload(payload, "bulk");
    throw err;
  }

  const priorSingleCalls = calls.filter(
    (call) => call.callType === "single" && call.tenantId === tenantId
  ).length;

  if (priorSingleCalls > 0 || payload.steps.testCallCompleted) {
    const err = new Error("Calling is blocked until onboarding approval.");
    err.statusCode = 403;
    err.payload = buildOnboardingBlockedPayload(payload, "single");
    throw err;
  }

  return { payload, isTestCall: true };
}

function emitCallUpdate(call) {
  io.emit("callUpdate", call);
}

function emitBulkStatus() {
  io.emit("bulkStatusUpdate", bulkStatus);
}

function parseCsvBuffer(buffer) {
  const text = buffer.toString("utf8");
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") i += 1;
      row.push(current);
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row.map((cell) => cell.trim()));
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((cell) => cell.trim() !== "")) {
    rows.push(row.map((cell) => cell.trim()));
  }

  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header) => header.toLowerCase());
  return rows.slice(1).map((values) => {
    const entry = {};
    headers.forEach((header, index) => {
      entry[header] = values[index] || "";
    });
    return entry;
  });
}

function createCall({
  number,
  callType = "single",
  agent = "Offline Agent",
  tenantId = "default",
  metadata = {},
}) {
  const now = new Date().toISOString();
  const call = {
    _id: uuidv4(),
    uuid: uuidv4(),
    to: number,
    number,
    tenantId,
    status: "initiated",
    callType,
    agent,
    metadata,
    notes: "",
    outcome: "",
    createdAt: now,
    updatedAt: now,
    duration: "0:00",
  };

  calls.unshift(call);
  emitCallUpdate(call);
  return call;
}

// Health endpoint
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Test server is running",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/ready", (req, res) => {
  res.json({
    success: true,
    status: "offline-ready",
    offlineMode: true,
    checks: {
      mockBackendRunning: true,
      webhookAuditAvailable: true,
      onboardingRoutesAvailable: true,
      adminRoutesAvailable: true,
    },
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/onboarding/status", authMiddleware, (req, res) => {
  const payload = buildOnboardingPayload(req.user.tenantId, req.user.id);
  res.json({
    success: true,
    steps: payload.steps,
    data: payload,
    review: payload.review,
    canGoLive: payload.canGoLive,
  });
});

app.post("/api/onboarding/steps", authMiddleware, (req, res) => {
  const tenantId = req.user.tenantId;
  const onboarding = ensureOnboarding(tenantId, req.user.id);
  const incoming = req.body?.steps && typeof req.body.steps === "object" ? req.body.steps : {};
  const invalidSteps = Object.keys(incoming).filter(
    (key) => !TENANT_EDITABLE_ONBOARDING_STEPS.includes(key)
  );

  if (invalidSteps.length > 0) {
    return res.status(400).json({
      success: false,
      message:
        "Those onboarding steps are system-managed and cannot be updated manually.",
      invalidSteps,
    });
  }

  onboarding.steps = {
    ...normalizeOnboardingSteps(onboarding.steps),
    ...Object.fromEntries(
      Object.entries(incoming)
        .filter(([key]) => key in defaultOnboardingSteps())
        .map(([key, value]) => [key, Boolean(value)])
    ),
  };
  onboarding.updatedAt = new Date().toISOString();

  return res.json({
    success: true,
    message: "Onboarding progress saved",
    data: buildOnboardingPayload(tenantId, req.user.id),
  });
});

app.post("/api/onboarding/submit", authMiddleware, (req, res) => {
  const tenantId = req.user.tenantId;
  const onboarding = ensureOnboarding(tenantId, req.user.id);
  const review = ensureOnboardingReview(tenantId);
  const payload = buildOnboardingPayload(tenantId, req.user.id);
  const now = new Date().toISOString();

  if (!payload.canSubmitForReview) {
    return res.status(400).json(
      buildOnboardingValidationError(
        payload.steps,
        "Complete the remaining required onboarding steps before submitting for admin review. Vonage can be connected after approval.",
        payload.missingReviewBlockingSteps
      )
    );
  }

  onboarding.submittedForReviewAt = now;
  onboarding.lastSubmittedBy = req.user.id;
  onboarding.updatedAt = now;

  if (review.status !== "approved") {
    review.status = "pending_review";
    review.submittedAt = now;
    review.reviewedAt = null;
    review.reviewedBy = null;
    review.adminNotes = "";
    review.requiredChanges = [];
    review.approvedForLiveCalling = false;
    review.approvedForBilling = false;
    review.updatedAt = now;
  }

  return res.json({
    success: true,
    message: "Onboarding submitted for review",
    data: buildOnboardingPayload(tenantId, req.user.id),
  });
});

// Register endpoint
app.post("/api/auth/register", async (req, res) => {
  const { email, password, firstName, lastName, company, plan } = req.body;

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ success: false, message: "All fields required" });
  }

  const existingUser = users.find((user) => user.email === email);
  if (existingUser) {
    return res.status(400).json({ success: false, message: "User exists" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: uuidv4(),
      email,
      password: hashedPassword,
      firstName,
      lastName,
      company: company || `${firstName}'s Company`,
      role: "user",
      tenantId: `tenant-${uuidv4()}`,
      subscription: buildSubscriptionSnapshot(plan || "professional", { status: "trial" }),
    };

    users.push(newUser);
    ensureTenant(newUser.tenantId, {
      companyName: newUser.company,
      contactEmail: newUser.email,
      plan: newUser.subscription?.plan || "professional",
    });
    const onboarding = ensureOnboarding(newUser.tenantId, newUser.id);
    onboarding.steps.companyInfo = true;
    onboarding.steps.agentAdded = true;
    onboarding.updatedAt = new Date().toISOString();
    ensureOnboardingReview(newUser.tenantId);

    return res.status(201).json({
      success: true,
      message: "User registered",
      user: sanitizeUser(newUser),
      token: signToken(newUser),
    });
  } catch {
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Login endpoint
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;

  const user = users.find((candidate) => candidate.email === email);
  if (!user) {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }

  return res.json({
    success: true,
    message: "Login successful",
    user: sanitizeUser(user),
    token: signToken(user),
  });
});

app.post("/api/auth/logout", (req, res) => {
  return res.json({ success: true, message: "Logged out" });
});

app.post("/api/auth/refresh", (req, res) => {
  const fallbackUser = users[0];
  return res.json({
    success: true,
    token: signToken(fallbackUser),
  });
});

app.get("/api/auth/me", authMiddleware, (req, res) => {
  return res.json({
    success: true,
    user: sanitizeUser(req.user),
  });
});

app.get("/api/calls", authMiddleware, (req, res) => {
  return res.json({ success: true, calls });
});

app.get("/api/settings", authMiddleware, (req, res) => {
  const verification = vonageVerificationByTenant[req.user.tenantId] || null;
  return res.json({
    success: true,
    settings: appSettings,
    vonageStatus: verification
      ? {
          ok: verification.status === "verified",
          message: verification.message,
          code: verification.code,
        }
      : {
          ok: true,
          message: "Offline mode is active",
          code: "OFFLINE",
        },
    vonageAccount: verification?.account || {
      apiKeyMasked: "test••••••",
      mode: "offline",
    },
    vonageVerification: verification,
  });
});

app.post("/api/settings", authMiddleware, (req, res) => {
  appSettings = {
    ...appSettings,
    ...req.body,
    bulkDelayMs:
      typeof req.body?.bulkDelayMs === "number"
        ? req.body.bulkDelayMs
        : appSettings.bulkDelayMs,
    enableVoicemailDrop:
      typeof req.body?.enableVoicemailDrop === "boolean"
        ? req.body.enableVoicemailDrop
        : appSettings.enableVoicemailDrop,
  };

  const onboarding = ensureOnboarding(req.user.tenantId, req.user.id);
  onboarding.steps.companyInfo = true;
  onboarding.steps.settingsConfigured = true;
  onboarding.updatedAt = new Date().toISOString();

  return res.json({
    success: true,
    message: "Settings updated",
    settings: appSettings,
  });
});

app.get("/api/vonage/test", authMiddleware, (req, res) => {
  const onboarding = ensureOnboarding(req.user.tenantId, req.user.id);
  onboarding.steps.vonageConnected = true;
  onboarding.updatedAt = new Date().toISOString();
  const verification = buildOfflineVonageVerification({
    ok: true,
    tenantId: req.user.tenantId,
    code: "OFFLINE",
    message: "Offline mode is active",
  });
  vonageVerificationByTenant[req.user.tenantId] = verification;

  return res.json({
    success: true,
    balance: "Offline",
    currency: "",
    account: {
      apiKeyMasked: "test••••••",
      mode: "offline",
    },
    verification,
  });
});

app.post("/api/telephony/vonage/verify", authMiddleware, (req, res) => {
  const { apiKey, apiSecret, applicationId, privateKey, preferredNumber } = req.body || {};

  if (!apiKey || !apiSecret || !applicationId || !privateKey) {
    const verification = buildOfflineVonageVerification({
      ok: false,
      tenantId: req.user.tenantId,
      preferredNumber,
      code: "MISSING_CREDENTIALS",
      message: "Missing Vonage credentials",
    });
    vonageVerificationByTenant[req.user.tenantId] = verification;
    return res.status(400).json({
      success: false,
      message: "Missing Vonage credentials",
      verification,
    });
  }

  const verification = buildOfflineVonageVerification({
    ok: true,
    tenantId: req.user.tenantId,
    preferredNumber,
    code: "VERIFIED",
    message: "Offline Vonage verification succeeded.",
  });
  verification.account.applicationId = applicationId;
  verification.account.apiKeyMasked = `${String(apiKey).slice(0, 4)}••••`;
  vonageVerificationByTenant[req.user.tenantId] = verification;

  const onboarding = ensureOnboarding(req.user.tenantId, req.user.id);
  onboarding.steps.vonageConnected = true;
  onboarding.steps.settingsConfigured = true;
  onboarding.updatedAt = new Date().toISOString();

  return res.json({
    success: true,
    verified: true,
    verification,
    account: verification.account,
    numbers: preferredNumber
      ? [{ number: preferredNumber, country: "Offline", features: ["voice"] }]
      : [],
  });
});

app.post("/api/support-ticket", authMiddleware, (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = normalizeSupportEmail(req.body?.email || req.user?.email || "");
  const phone = normalizeSupportPhone(req.body?.phone || "");
  const subject = String(req.body?.subject || "").trim();
  const category = String(req.body?.category || "general").trim() || "general";
  const priority = String(req.body?.priority || "normal").trim() || "normal";
  const content = String(req.body?.message || "").trim();

  if (!email || !content) {
    return res.status(400).json({
      success: false,
      message: "Email and message are required.",
    });
  }

  const conversation = {
    id: uuidv4(),
    tenantId: req.user.tenantId,
    userId: req.user.id,
    subject: subject || "Support request",
    category,
    priority,
    status: "open",
    source: "web",
    provider: "",
    externalThreadId: "",
    customer: {
      name: name || `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim(),
      email,
      phone,
    },
    aiHandoff: {
      requested: false,
      requestedAt: null,
      requestedBy: "",
      reason: "",
      summary: "",
    },
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  supportConversations.push(conversation);
  const firstMessage = appendSupportMessage(conversation, {
    direction: "inbound",
    authorType: "customer",
    authorName: conversation.customer.name || "Customer",
    channel: "web",
    content,
    metadata: { category, priority },
  });

  return res.status(201).json({
    success: true,
    message: "Support request submitted.",
    conversation: buildSupportConversationPreview(conversation, firstMessage),
  });
});

app.get("/api/support/conversations", authMiddleware, (req, res) => {
  const isAdmin = req.user?.isSuperAdmin || req.user?.role === "admin";
  let conversations = [...supportConversations];

  if (!isAdmin) {
    conversations = conversations.filter(
      (conversation) => conversation.tenantId === req.user.tenantId
    );
  } else if (req.query?.tenantId) {
    conversations = conversations.filter(
      (conversation) => conversation.tenantId === String(req.query.tenantId).trim()
    );
  }

  if (req.query?.status) {
    conversations = conversations.filter(
      (conversation) => conversation.status === String(req.query.status).trim()
    );
  }

  conversations.sort(
    (a, b) => new Date(b.lastMessageAt || b.updatedAt) - new Date(a.lastMessageAt || a.updatedAt)
  );

  return res.json({
    success: true,
    conversations: conversations.map((conversation) => {
      const lastMessage = [...supportMessages]
        .filter((message) => message.conversationId === conversation.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      return buildSupportConversationPreview(conversation, lastMessage || null);
    }),
  });
});

app.get("/api/support/conversations/:id/messages", authMiddleware, (req, res) => {
  const conversation = findSupportConversationByAccess(req.params.id, req);
  if (!conversation) {
    return res.status(404).json({
      success: false,
      message: "Support conversation not found.",
    });
  }

  const messages = supportMessages
    .filter((message) => message.conversationId === conversation.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  return res.json({
    success: true,
    conversation: buildSupportConversationPreview(conversation),
    messages,
  });
});

app.post("/api/support/conversations/:id/messages", authMiddleware, (req, res) => {
  const conversation = findSupportConversationByAccess(req.params.id, req);
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
  const message = appendSupportMessage(conversation, {
    direction: "outbound",
    authorType: isAdmin ? "admin" : "customer",
    authorName:
      `${req.user.firstName || ""} ${req.user.lastName || ""}`.trim() ||
      req.user.email ||
      "User",
    channel: "internal",
    content,
    metadata: { sentByUserId: req.user.id },
  });

  if (isAdmin) {
    conversation.status = "open";
    conversation.aiHandoff = {
      ...conversation.aiHandoff,
      requested: false,
    };
    conversation.updatedAt = new Date().toISOString();
  }

  return res.json({
    success: true,
    message: "Support message sent.",
    data: message,
  });
});

app.post("/api/support/conversations/:id/ai-handoff", authMiddleware, (req, res) => {
  const conversation = findSupportConversationByAccess(req.params.id, req);
  if (!conversation) {
    return res.status(404).json({
      success: false,
      message: "Support conversation not found.",
    });
  }

  conversation.status = "waiting_human";
  conversation.aiHandoff = {
    requested: true,
    requestedAt: new Date().toISOString(),
    requestedBy: String(req.body?.requestedBy || "ai").trim() || "ai",
    reason: String(req.body?.reason || "").trim(),
    summary: String(req.body?.summary || "").trim(),
  };
  conversation.updatedAt = new Date().toISOString();

  appendSupportMessage(conversation, {
    direction: "system",
    authorType: "ai",
    authorName: "AI Assistant",
    channel: "internal",
    content:
      conversation.aiHandoff.summary ||
      "AI requested a human follow-up for this support conversation.",
    metadata: {
      reason: conversation.aiHandoff.reason,
      handoff: true,
    },
  });

  return res.json({
    success: true,
    message: "AI handoff recorded.",
    conversation: buildSupportConversationPreview(conversation),
  });
});

app.post("/api/support/provider/webhook", verifySupportProviderWebhook, (req, res) => {
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
  const content = String(req.body?.message || req.body?.text || req.body?.body || "").trim();

  if (!tenantId || !content) {
    return res.status(400).json({
      success: false,
      message: "tenantId and message content are required.",
    });
  }

  let conversation =
    supportConversations.find(
      (item) => item.tenantId === tenantId && item.externalThreadId === externalThreadId
    ) || null;

  if (!conversation && (email || phone)) {
    conversation =
      supportConversations.find(
        (item) =>
          item.tenantId === tenantId &&
          ["open", "pending_ai", "waiting_human"].includes(item.status) &&
          (item.customer?.email === email || item.customer?.phone === phone)
      ) || null;
  }

  if (!conversation) {
    conversation = {
      id: uuidv4(),
      tenantId,
      userId: null,
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
      aiHandoff: {
        requested: false,
        requestedAt: null,
        requestedBy: "",
        reason: "",
        summary: "",
      },
      lastMessageAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    supportConversations.push(conversation);
  } else {
    conversation.status = "open";
    conversation.provider = provider || conversation.provider;
    if (externalThreadId && !conversation.externalThreadId) {
      conversation.externalThreadId = externalThreadId;
    }
    conversation.updatedAt = new Date().toISOString();
  }

  const message = appendSupportMessage(conversation, {
    direction: "inbound",
    authorType: "provider",
    authorName: String(req.body?.name || req.body?.fromName || "Provider Contact").trim(),
    channel: String(req.body?.channel || "email").trim(),
    content,
    providerMessageId: String(req.body?.providerMessageId || req.body?.messageId || "").trim(),
    metadata: req.body || {},
  });

  return res.json({
    success: true,
    conversation: buildSupportConversationPreview(conversation, message),
    messageId: message.id,
  });
});

app.get("/api/voicemail-messages", authMiddleware, (req, res) => {
  return res.json({
    success: true,
    messages: voicemailMessages,
    activeId: appSettings.activeVoicemailId,
    voices: TTS_VOICES,
    enabled: appSettings.enableVoicemailDrop,
  });
});

app.post("/api/voicemail-messages", authMiddleware, (req, res) => {
  const { id, name, content, voiceId, isActive = false } = req.body || {};

  if (!name || !content || !voiceId) {
    return res.status(400).json({
      success: false,
      message: "Name, content, and voice are required.",
    });
  }

  let message;
  if (id) {
    const index = voicemailMessages.findIndex(
      (entry) => entry.id === id || entry._id === id
    );

    if (index === -1) {
      return res.status(404).json({
        success: false,
        message: "Voicemail message not found.",
      });
    }

    voicemailMessages[index] = {
      ...voicemailMessages[index],
      name,
      content,
      voiceId,
      updatedAt: new Date().toISOString(),
    };
    message = voicemailMessages[index];
  } else {
    const newId = uuidv4();
    message = {
      id: newId,
      _id: newId,
      name,
      content,
      voiceId,
      isActive: false,
      createdAt: new Date().toISOString(),
    };
    voicemailMessages.unshift(message);
  }

  const shouldActivate =
    isActive || !voicemailMessages.some((entry) => entry.isActive);

  if (shouldActivate) {
    voicemailMessages = voicemailMessages.map((entry) => ({
      ...entry,
      isActive: entry.id === message.id || entry._id === message._id,
    }));
    appSettings.activeVoicemailId = message.id;
  }

  return res.status(id ? 200 : 201).json({
    success: true,
    message: id ? "Voicemail updated." : "Voicemail created.",
    data: voicemailMessages.find(
      (entry) => entry.id === message.id || entry._id === message._id
    ),
  });
});

app.post("/api/voicemail-messages/:id/activate", authMiddleware, (req, res) => {
  const { id } = req.params;
  const exists = voicemailMessages.some(
    (entry) => entry.id === id || entry._id === id
  );

  if (!exists) {
    return res.status(404).json({
      success: false,
      message: "Voicemail message not found.",
    });
  }

  voicemailMessages = voicemailMessages.map((entry) => ({
    ...entry,
    isActive: entry.id === id || entry._id === id,
  }));
  appSettings.activeVoicemailId = id;

  return res.json({
    success: true,
    message: "Active voicemail updated.",
    data: voicemailMessages.find(
      (entry) => entry.id === id || entry._id === id
    ),
  });
});

app.post("/api/voicemail-settings", authMiddleware, (req, res) => {
  const { enabled } = req.body || {};

  if (typeof enabled !== "boolean") {
    return res.status(400).json({
      success: false,
      message: "Enabled must be a boolean value.",
    });
  }

  appSettings.enableVoicemailDrop = enabled;
  return res.json({
    success: true,
    enabled,
    message: enabled
      ? "Voicemail drop enabled."
      : "Voicemail drop disabled.",
  });
});

app.post("/api/admin/clear-calls", authMiddleware, (req, res) => {
  calls = [];
  bulkStatus = {
    running: false,
    paused: false,
    campaignName: "",
  };
  emitBulkStatus();

  return res.json({
    success: true,
    message: "Call history cleared",
  });
});

app.get("/api/admin/tenants", authMiddleware, adminOnly, (req, res) => {
  const tenants = Object.values(tenantSettings)
    .map((tenant) => ensureTenant(tenant.tenantId))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .map((tenant) => ({
      tenantId: tenant.tenantId,
      companyName: tenant.companyName,
      licenseId: tenant.licenseId,
      contactEmail: tenant.contactEmail || "",
      plan: tenant.plan || "professional",
      isEnabled: tenant.isEnabled,
      status: tenant.status,
      reasonCode: tenant.reasonCode || "",
      reasonText: tenant.reasonText || "",
      disabledUntil: tenant.disabledUntil || null,
      updatedAt: tenant.updatedAt,
    }));

  return res.json({ success: true, tenants });
});

app.post("/api/admin/tenants", authMiddleware, adminOnly, async (req, res) => {
  if (!req.user?.isSuperAdmin) {
    return res.status(403).json({
      success: false,
      message: "Only superadmin can create tenants.",
    });
  }

  const companyName = String(req.body?.companyName || "").trim();
  const contactEmail = String(req.body?.contactEmail || "").trim().toLowerCase();
  const requestedTenantId = String(req.body?.tenantId || "").trim().toLowerCase();
  const plan = String(req.body?.plan || "professional").trim().toLowerCase();

  if (!companyName || !contactEmail) {
    return res.status(400).json({
      success: false,
      message: "companyName and contactEmail are required.",
    });
  }

  const tenantId = requestedTenantId || `tenant_${uuidv4()}`;
  if (tenantSettings[tenantId]) {
    return res.status(409).json({
      success: false,
      message: "A tenant with this ID already exists.",
    });
  }

  tenantSettings[tenantId] = ensureTenant(tenantId);
  tenantSettings[tenantId] = {
    ...tenantSettings[tenantId],
    tenantId,
    companyName,
    contactEmail,
    plan,
    updatedAt: new Date().toISOString(),
  };

  ensureOnboarding(tenantId);
  ensureOnboardingReview(tenantId);

  return res.status(201).json({
    success: true,
    message: "Tenant created successfully",
    data: {
      tenant: {
        tenantId,
        companyName,
        contactEmail,
        plan,
        licenseId: tenantSettings[tenantId].licenseId || `vynce-${tenantId}`,
        status: tenantSettings[tenantId].status || "active",
        isEnabled: tenantSettings[tenantId].isEnabled !== false,
      },
    },
  });
});

app.get("/api/admin/tenant-monitoring", authMiddleware, adminOnly, (req, res) => {
  const tenantId = String(req.query?.tenantId || "").trim();

  if (!tenantId) {
    return res.status(400).json({
      success: false,
      message: "tenantId is required",
    });
  }

  const tenant = ensureTenant(tenantId);
  const onboarding = buildOnboardingPayload(tenantId);
  const seats = getTenantSeatSnapshot(tenantId);
  const tenantCalls = calls
    .filter((call) => call.tenantId === tenantId)
    .sort(
      (a, b) =>
        new Date(b.updatedAt || b.createdAt || 0) -
        new Date(a.updatedAt || a.createdAt || 0)
    )
    .slice(0, 8);
  const tenantThreads = supportConversations
    .filter((conversation) => conversation.tenantId === tenantId)
    .sort(
      (a, b) =>
        new Date(b.lastMessageAt || b.updatedAt || 0) -
        new Date(a.lastMessageAt || a.updatedAt || 0)
    )
    .slice(0, 8);

  return res.json({
    success: true,
    data: {
      tenant: {
        tenantId,
        companyName: tenant.companyName || "Unknown",
        contactEmail: tenant.contactEmail || "",
        licenseId: tenant.licenseId || `vynce-${tenantId}`,
        plan: tenant.plan || "professional",
        status: tenant.status || "active",
        isEnabled: tenant.isEnabled !== false,
        createdAt: tenant.createdAt || null,
        updatedAt: tenant.updatedAt || null,
      },
      onboarding,
      seats,
      telephony: {
        verification: vonageVerificationByTenant[tenantId] || null,
        connected: vonageVerificationByTenant[tenantId]?.status === "verified",
        checkedAt: vonageVerificationByTenant[tenantId]?.checkedAt || null,
      },
      callMetrics: {
        totalCalls: calls.filter((call) => call.tenantId === tenantId).length,
        activeCalls: calls.filter(
          (call) =>
            call.tenantId === tenantId &&
            ["queued", "initiated", "ringing", "in-progress", "in_progress", "active"].includes(
              String(call.status || "").toLowerCase()
            )
        ).length,
        recentCompletedCalls: tenantCalls.filter(
          (call) => String(call.status || "").toLowerCase() === "completed"
        ).length,
        recentFailedCalls: tenantCalls.filter((call) =>
          ["failed", "busy", "no-answer", "no_answer", "canceled"].includes(
            String(call.status || "").toLowerCase()
          )
        ).length,
        lastCallAt: tenantCalls[0]?.updatedAt || tenantCalls[0]?.createdAt || null,
      },
      supportMetrics: {
        totalThreads: tenantThreads.length,
        openThreads: tenantThreads.filter((item) =>
          ["open", "pending_ai", "waiting_human"].includes(
            String(item.status || "").toLowerCase()
          )
        ).length,
        waitingHuman: tenantThreads.filter(
          (item) => String(item.status || "").toLowerCase() === "waiting_human"
        ).length,
        lastMessageAt:
          tenantThreads[0]?.lastMessageAt || tenantThreads[0]?.updatedAt || null,
      },
      recentCalls: tenantCalls.map((call) => ({
        id: call.id,
        number: call.number || call.to || "",
        status: call.status || "unknown",
        agent: call.agent || call.metadata?.agentName || "",
        createdAt: call.createdAt || null,
        updatedAt: call.updatedAt || null,
        duration: call.duration || 0,
      })),
      supportThreads: tenantThreads.map((conversation) =>
        buildSupportConversationPreview(conversation)
      ),
    },
  });
});

app.get("/api/admin/license", authMiddleware, adminOnly, (req, res) => {
  const tenantId =
    String(req.query?.tenantId || req.user?.tenantId || "tenant-admin").trim();
  const tenant = ensureTenant(tenantId);

  return res.json({
    success: true,
    data: formatTenantLicenseData(tenant),
  });
});

app.post("/api/admin/license", authMiddleware, adminOnly, (req, res) => {
  const tenantId =
    String(req.query?.tenantId || req.body?.tenantId || req.user?.tenantId || "tenant-admin").trim();
  const tenant = ensureTenant(tenantId);
  const before = { ...tenant };

  const action = String(req.body?.action || "").trim().toLowerCase();
  const reasonCode = normalizeReasonCode(req.body?.reasonCode);
  const reasonText = String(req.body?.reasonText || "").trim();

  if (action === "suspend") {
    if (!reasonCode) {
      return res.status(400).json({
        success: false,
        message: "Suspension requires a valid reason code",
      });
    }

    tenant.isEnabled = false;
    tenant.disabledUntil = null;
    tenant.reasonCode = reasonCode;
    tenant.reasonText = reasonText;
    tenant.suspendReason = reasonText || reasonCode;
  } else if (action === "temporary_suspend") {
    if (!reasonCode) {
      return res.status(400).json({
        success: false,
        message: "Temporary suspension requires a valid reason code",
      });
    }

    const parsedDisabledUntil = new Date(req.body?.disabledUntil);
    if (
      !req.body?.disabledUntil ||
      Number.isNaN(parsedDisabledUntil.getTime()) ||
      parsedDisabledUntil.getTime() <= Date.now()
    ) {
      return res.status(400).json({
        success: false,
        message: "Temporary suspension requires a future end date",
      });
    }

    tenant.isEnabled = false;
    tenant.disabledUntil = parsedDisabledUntil.toISOString();
    tenant.reasonCode = reasonCode;
    tenant.reasonText = reasonText;
    tenant.suspendReason = reasonText || reasonCode;
  } else if (action === "reenable") {
    tenant.isEnabled = true;
    tenant.disabledUntil = null;
    tenant.reasonCode = "";
    tenant.reasonText = "";
    tenant.suspendReason = "";
  } else {
    return res.status(400).json({
      success: false,
      message: "Unknown tenant license action",
    });
  }

  tenant.status = getTenantStatus(tenant);
  tenant.updatedAt = new Date().toISOString();
  tenant.updatedBy = {
    email: req.user?.email || "admin@vynce.com",
    role: req.user?.role || "admin",
  };

  licenseAuditLogs.unshift({
    _id: uuidv4(),
    action:
      action === "suspend"
        ? "TENANT_SUSPENDED"
        : action === "temporary_suspend"
          ? "TENANT_TEMP_SUSPENDED"
          : "TENANT_REENABLED",
    createdAt: new Date().toISOString(),
    performedBy: {
      email: req.user?.email || "admin@vynce.com",
      role: req.user?.role || "admin",
    },
    target: {
      companyName: tenant.companyName,
      tenantId: tenant.tenantId,
      licenseId: tenant.licenseId,
    },
    before,
    after: { ...tenant },
  });

  return res.json({
    success: true,
    message:
      action === "suspend"
        ? "Tenant suspended"
        : action === "temporary_suspend"
          ? "Tenant temporarily suspended"
          : "Tenant re-enabled",
    data: formatTenantLicenseData(tenant),
  });
});

app.post("/api/admin/license/issue", authMiddleware, adminOnly, (req, res) => {
  const tenantId =
    String(req.query?.tenantId || req.body?.tenantId || req.user?.tenantId || "tenant-admin").trim();
  const tenant = ensureTenant(tenantId);

  const plan = String(req.body?.plan || tenant.plan || "professional").trim().toLowerCase();
  const maxActivations = Number.isFinite(Number(req.body?.maxActivations))
    ? Math.max(1, Math.floor(Number(req.body.maxActivations)))
    : 1;
  const includedUsers = Number.isFinite(Number(req.body?.includedUsers))
    ? Math.max(1, Math.floor(Number(req.body.includedUsers)))
    : 1;
  const extraSeats = Number.isFinite(Number(req.body?.extraSeats))
    ? Math.max(0, Math.floor(Number(req.body.extraSeats)))
    : 0;
  const reason =
    String(req.body?.reason || "issued_from_offline_admin").trim() ||
    "issued_from_offline_admin";

  let normalizedExpiresAt = null;
  if (req.body?.expiresAt) {
    const parsed = new Date(req.body.expiresAt);
    if (Number.isNaN(parsed.getTime())) {
      return res.status(400).json({
        success: false,
        message: "expiresAt must be a valid ISO date when provided.",
      });
    }
    normalizedExpiresAt = parsed.toISOString();
  }

  tenant.plan = plan;
  tenant.updatedAt = new Date().toISOString();

  const licenseKey = [
    "VYNCE",
    tenantId.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase() || "TENANT",
    uuidv4().replace(/-/g, "").slice(0, 4).toUpperCase(),
    uuidv4().replace(/-/g, "").slice(0, 4).toUpperCase(),
  ].join("-");

  licenseAuditLogs.unshift({
    _id: uuidv4(),
    action: "LICENSE_ISSUED",
    createdAt: new Date().toISOString(),
    performedBy: {
      email: req.user?.email || "admin@vynce.com",
      role: req.user?.role || "admin",
    },
    target: {
      companyName: tenant.companyName,
      tenantId: tenant.tenantId,
      licenseId: tenant.licenseId,
    },
    before: {
      plan: tenant.plan,
    },
    after: {
      plan,
      maxActivations,
      includedUsers,
      extraSeats,
      expiresAt: normalizedExpiresAt,
      reason,
    },
  });

  return res.json({
    success: true,
    message: "License key issued. This key is displayed once and should be shared securely.",
    data: {
      tenantId,
      licenseId: tenant.licenseId || `vynce-${tenantId}`,
      licenseKey,
      oneTimeDisplay: true,
      issuedAt: new Date().toISOString(),
      plan,
      maxActivations,
      includedUsers,
      extraSeats,
      expiresAt: normalizedExpiresAt,
    },
  });
});

app.get("/api/admin/license/audit", authMiddleware, adminOnly, (req, res) => {
  const tenantId = String(req.query?.tenantId || "").trim();
  const data = tenantId
    ? licenseAuditLogs.filter((log) => log.target?.tenantId === tenantId)
    : licenseAuditLogs;

  return res.json({
    success: true,
    data: data.slice(0, 50),
  });
});

app.get("/api/admin/vonage/webhook-audit", authMiddleware, adminOnly, (req, res) => {
  if (!VONAGE_WEBHOOK_AUDIT_ENABLED) {
    return res.status(404).json({
      success: false,
      message: "Vonage webhook audit logging is disabled in offline mode.",
    });
  }

  const limit = Math.min(Math.max(Number(req.query?.limit || 75), 1), 200);
  const eventType = String(req.query?.eventType || "").trim();
  const matchedAs = String(req.query?.matchedAs || "").trim();
  const callUuid = String(req.query?.callUuid || "").trim();
  const callId = String(req.query?.callId || "").trim();

  let rows = [...vonageWebhookAuditLogs];

  if (eventType) {
    rows = rows.filter((item) => item.eventType === eventType);
  }

  if (matchedAs) {
    rows = rows.filter((item) => item.matchedAs === matchedAs);
  }

  if (callUuid) {
    rows = rows.filter((item) => String(item.callUuid || "").includes(callUuid));
  }

  if (callId) {
    rows = rows.filter((item) => String(item.callId || "").includes(callId));
  }

  rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  return res.json({
    success: true,
    data: rows.slice(0, limit),
  });
});

app.get("/api/admin/onboarding/queue", authMiddleware, adminOnly, (req, res) => {
  const requestedStatuses =
    typeof req.query?.status === "string" && req.query.status.trim()
      ? req.query.status
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : ["pending_review", "changes_requested"];

  const queue = Object.keys(onboardingReviewsByTenant)
    .map((tenantId) => buildOnboardingPayload(tenantId))
    .filter((item) => requestedStatuses.includes(item.review.status))
    .map((item) => {
      const tenant = ensureTenant(item.tenantId);
      return {
        tenantId: item.tenantId,
        companyName: tenant.companyName || "Unknown",
        contactEmail: tenant.contactEmail || "",
        plan: tenant.plan || "professional",
        status: item.review.status,
        submittedAt: item.review.submittedAt,
        reviewedAt: item.review.reviewedAt,
        completion: item.completion,
        canGoLive: item.canGoLive,
      };
    });

  return res.json({ success: true, queue });
});

app.get("/api/admin/onboarding", authMiddleware, adminOnly, (req, res) => {
  const tenantId = String(req.query?.tenantId || "").trim();
  if (!tenantId) {
    return res.status(400).json({ success: false, message: "tenantId is required" });
  }

  const payload = buildOnboardingPayload(tenantId);
  const tenant = ensureTenant(tenantId);

  return res.json({
    success: true,
    data: {
      ...payload,
      tenant: {
        tenantId,
        companyName: tenant.companyName || "Unknown",
        contactEmail: tenant.contactEmail || "",
        plan: tenant.plan || "professional",
        licenseId: tenant.licenseId || `vynce-${tenantId}`,
      },
    },
  });
});

app.post("/api/admin/onboarding/review", authMiddleware, adminOnly, (req, res) => {
  const tenantId = String(req.body?.tenantId || "").trim();
  const action = String(req.body?.action || "").trim();
  const adminNotes = String(req.body?.adminNotes || "").trim();
  const requiredChanges = Array.isArray(req.body?.requiredChanges)
    ? req.body.requiredChanges.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  if (!tenantId) {
    return res.status(400).json({ success: false, message: "tenantId is required" });
  }

  if (!["approve", "request_changes", "reject"].includes(action)) {
    return res.status(400).json({ success: false, message: "Invalid onboarding review action" });
  }

  ensureTenant(tenantId);
  ensureOnboarding(tenantId);
  const review = ensureOnboardingReview(tenantId);
  const now = new Date().toISOString();

  review.reviewedAt = now;
  review.reviewedBy = {
    id: req.user.id,
    email: req.user.email,
    role: req.user.role,
  };
  review.adminNotes = adminNotes;

  if (action === "approve") {
    const payload = buildOnboardingPayload(tenantId);
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

  review.updatedAt = now;

  return res.json({
    success: true,
    message: "Onboarding review updated",
    data: buildOnboardingPayload(tenantId),
  });
});

app.get("/api/tenant/users", authMiddleware, (req, res) => {
  return res.json({
    success: true,
    data: getTenantSeatSnapshot(req.user.tenantId),
  });
});

app.post("/api/admin/tenant-users", authMiddleware, adminOnly, async (req, res) => {
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

  const existingUser = users.find((user) => user.email === email);
  if (existingUser) {
    return res.status(400).json({ success: false, message: "Email is already in use." });
  }

  const tenant = ensureTenant(tenantId);
  const tenantUsers = users.filter((user) => user.tenantId === tenantId);
  if (!tenantUsers.length) {
    return res.status(404).json({
      success: false,
      message: "Tenant not found or has no existing owner account.",
    });
  }

  let seats = getTenantSeatSnapshot(tenantId);
  let additionalAgentSeats = seats.additionalAgentSeats;

  if (!seats.canAddUser) {
    if (!grantAdditionalSeat) {
      return res.status(409).json({
        success: false,
        code: "SEAT_LIMIT_REACHED",
        message:
          "This tenant has reached its active user limit. A superadmin must explicitly grant an additional seat before another user can be added.",
        data: seats,
      });
    }

    additionalAgentSeats += 1;
    syncTenantSubscriptions(tenantId, tenant.plan || "professional", additionalAgentSeats);
    seats = getTenantSeatSnapshot(tenantId);
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = {
    id: uuidv4(),
    email,
    password: hashedPassword,
    firstName,
    lastName,
    company: tenant.companyName || tenantUsers[0]?.company || "Unknown",
    role: requestedRole,
    tenantId,
    isSuperAdmin: false,
    subscription: buildSubscriptionSnapshot(tenant.plan || "professional", {
      additionalAgentSeats,
    }),
  };

  users.push(newUser);
  const onboarding = ensureOnboarding(tenantId, newUser.id);
  onboarding.steps.agentAdded = true;
  onboarding.updatedAt = new Date().toISOString();

  return res.status(201).json({
    success: true,
    message: "Tenant user created successfully.",
    user: sanitizeUser(newUser),
    data: getTenantSeatSnapshot(tenantId),
  });
});

app.post("/api/make-call", authMiddleware, (req, res) => {
  const { to, agent } = req.body || {};
  const tenantId = req.user.tenantId;

  if (!to) {
    return res.status(400).json({ success: false, message: "Phone number is required" });
  }

  try {
    enforceOnboardingForCalling(tenantId, "single", req.user.id);
  } catch (err) {
    return res
      .status(err.statusCode || 403)
      .json(err.payload || { success: false, message: err.message });
  }

  const call = createCall({
    number: to,
    agent: agent || `${req.user.firstName} ${req.user.lastName}`.trim(),
    callType: "single",
    tenantId,
  });
  const onboarding = ensureOnboarding(req.user.tenantId, req.user.id);
  onboarding.steps.testCallCompleted = true;
  onboarding.updatedAt = new Date().toISOString();

  setTimeout(() => {
    const updatedCall = calls.find((entry) => entry.uuid === call.uuid);
    if (!updatedCall) return;
    updatedCall.status = "answered";
    updatedCall.updatedAt = new Date().toISOString();
    emitCallUpdate(updatedCall);
  }, 1000);

  return res.json({
    success: true,
    message: "Offline call queued",
    data: call,
  });
});

app.post("/api/end-call", authMiddleware, (req, res) => {
  const { uuid } = req.body || {};
  const call = calls.find((entry) => entry.uuid === uuid);

  if (!call) {
    return res.status(404).json({ success: false, message: "Call not found" });
  }

  call.status = "ended";
  call.updatedAt = new Date().toISOString();
  call.duration = call.duration === "0:00" ? "0:12" : call.duration;
  emitCallUpdate(call);

  return res.json({ success: true, message: "Call ended", call });
});

app.post("/api/calls/:uuid/notes", authMiddleware, (req, res) => {
  const { uuid } = req.params;
  const { content = "", outcome = "" } = req.body || {};
  const call = calls.find((entry) => entry.uuid === uuid);

  if (!call) {
    return res.status(404).json({ success: false, message: "Call not found" });
  }

  call.notes = content;
  call.outcome = outcome;
  call.updatedAt = new Date().toISOString();

  return res.json({ success: true, message: "Notes saved", call });
});

app.get("/api/bulk/status", authMiddleware, (req, res) => {
  return res.json(bulkStatus);
});

app.post("/api/bulk/pause", authMiddleware, (req, res) => {
  bulkStatus = { ...bulkStatus, paused: true, running: true };
  emitBulkStatus();
  return res.json({ success: true, ...bulkStatus });
});

app.post("/api/bulk/resume", authMiddleware, (req, res) => {
  bulkStatus = { ...bulkStatus, paused: false, running: true };
  emitBulkStatus();
  return res.json({ success: true, ...bulkStatus });
});

app.post("/api/bulk/stop", authMiddleware, (req, res) => {
  bulkStatus = { running: false, paused: false, campaignName: "" };
  emitBulkStatus();
  return res.json({ success: true, ...bulkStatus });
});

app.post("/api/upload-csv", authMiddleware, upload.single("file"), (req, res) => {
  try {
    enforceOnboardingForCalling(req.user.tenantId, "bulk", req.user.id);
  } catch (err) {
    return res
      .status(err.statusCode || 403)
      .json(err.payload || { success: false, message: err.message });
  }

  const csvRows = req.file?.buffer ? parseCsvBuffer(req.file.buffer) : [];
  const createdCalls = csvRows
    .map((row) => {
      const number =
        row.phone ||
        row.number ||
        row.to ||
        row["phone number"] ||
        row["mobile number"];

      if (!number) return null;

      return createCall({
        number,
        callType: "bulk",
        agent: `${req.user.firstName} ${req.user.lastName}`.trim(),
        tenantId: req.user.tenantId,
        metadata: {
          name: row.name || row.contact || row.fullname || row["full name"] || "",
          firstName: row.firstname || "",
          lastName: row.lastname || "",
          address: row.address || "",
          city: row.city || "",
          state: row.state || "",
          zip: row.zip || row.zipcode || "",
          source: req.file?.originalname || "csv-upload",
        },
      });
    })
    .filter(Boolean);

  bulkStatus = {
    running: createdCalls.length > 0,
    paused: false,
    campaignName: req.body?.campaignName || "Offline Campaign",
  };
  emitBulkStatus();

  createdCalls.forEach((call, index) => {
    setTimeout(() => {
      const pendingCall = calls.find((entry) => entry.uuid === call.uuid);
      if (!pendingCall) return;
      pendingCall.status = index % 2 === 0 ? "answered" : "completed";
      pendingCall.duration = pendingCall.status === "completed" ? "0:45" : "0:12";
      pendingCall.updatedAt = new Date().toISOString();
      emitCallUpdate(pendingCall);
    }, 1200 + index * 250);
  });

  return res.json({
    success: true,
    queued: createdCalls.length,
    campaignName: bulkStatus.campaignName,
    calls: createdCalls,
    message:
      createdCalls.length > 0
        ? `Queued ${createdCalls.length} offline bulk calls`
        : "No valid phone numbers found in the uploaded CSV",
  });
});

app.get("/api/license/status", authMiddleware, (req, res) => {
  const onboarding = buildOnboardingPayload(req.user.tenantId, req.user.id);
  const tenant = ensureTenant(req.user.tenantId);
  const mode = {
    requested: tenant.callingMode || "offline",
    effective: "offline",
    liveAvailable: false,
    reason:
      tenant.callingMode === "live"
        ? "Live provider calling is not available in the offline server."
        : null,
  };
  return res.json({
    status: "active",
    usage: {
      callLimit: req.user.subscription?.maxCalls || 0,
      callsUsed: calls.length,
    },
    mode,
    onboarding: onboarding.review,
    canGoLive: onboarding.canGoLive,
    calling: buildCallingPermissions(onboarding),
  });
});

app.get("/api/system/mode", authMiddleware, (req, res) => {
  const tenant = ensureTenant(req.user.tenantId);
  return res.json({
    success: true,
    data: {
      requested: tenant.callingMode || "offline",
      effective: "offline",
      liveAvailable: false,
      reason:
        tenant.callingMode === "live"
          ? "Live provider calling is not available in the offline server."
          : null,
    },
  });
});

app.post("/api/system/mode", authMiddleware, (req, res) => {
  const tenant = ensureTenant(req.user.tenantId);
  const requestedMode =
    String(req.body?.mode || "").trim().toLowerCase() === "live" ? "live" : "offline";

  tenant.callingMode = requestedMode;
  tenant.updatedAt = new Date().toISOString();

  return res.json({
    success: true,
    message:
      requestedMode === "live"
        ? "Live mode requested for this tenant"
        : "Offline mode enabled for this tenant",
    data: {
      requested: requestedMode,
      effective: "offline",
      liveAvailable: false,
      reason:
        requestedMode === "live"
          ? "Live provider calling is not available in the offline server."
          : null,
    },
  });
});

app.get("/api/scripts", (req, res) => {
  return res.json({
    success: true,
    scripts: callScripts.filter((script) => script.isActive),
  });
});

app.post("/api/scripts", authMiddleware, (req, res) => {
  const { _id, id, name, content, category } = req.body || {};

  if (!name || !content) {
    return res.status(400).json({
      success: false,
      message: "Name and content are required",
    });
  }

  const targetId = _id || id;
  if (targetId) {
    const index = callScripts.findIndex(
      (script) => script.id === targetId || script._id === targetId
    );

    if (index === -1) {
      return res.status(404).json({ success: false, message: "Script not found" });
    }

    callScripts[index] = {
      ...callScripts[index],
      name,
      content,
      category: category || callScripts[index].category || "general",
      updatedAt: new Date().toISOString(),
    };

    return res.json({
      success: true,
      message: "Script updated successfully",
      script: callScripts[index],
    });
  }

  const newId = uuidv4();
  const newScript = {
    id: newId,
    _id: newId,
    name,
    content,
    category: category || "general",
    isActive: true,
    createdAt: new Date().toISOString(),
  };

  callScripts.push(newScript);
  const onboarding = ensureOnboarding(req.user.tenantId, req.user.id);
  onboarding.steps.scriptUploaded = true;
  onboarding.updatedAt = new Date().toISOString();

  return res.status(201).json({
    success: true,
    message: "Script created successfully",
    script: newScript,
  });
});

app.delete("/api/scripts/:id", authMiddleware, (req, res) => {
  const { id } = req.params;
  const before = callScripts.length;
  callScripts = callScripts.filter(
    (script) => script.id !== id && script._id !== id
  );

  if (callScripts.length === before) {
    return res.status(404).json({ success: false, message: "Script not found" });
  }

  return res.json({ success: true, message: "Script deleted successfully" });
});

io.on("connection", (socket) => {
  socket.emit("bulkStatusUpdate", bulkStatus);
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🚀 Test server running on port ${PORT}`);
  console.log(`📍 http://localhost:${PORT}/api/health`);
});
