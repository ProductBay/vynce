// backend/dialer.js
require("dotenv").config();

const fs = require("fs");
const http = require("http");
const express = require("express");
const bodyParser = require("body-parser");
const socketio = require("socket.io");
const cors = require("cors");
const multer = require("multer");
const csv = require("csv-parser");
const { Vonage } = require("@vonage/server-sdk");
const { v4: uuidv4 } = require("uuid");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");

const User = require("./models/User");

// ----------------------------
// ENV / CONSTANTS
// ----------------------------
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_WEBHOOK_URL = process.env.PUBLIC_WEBHOOK_URL || `http://localhost:${PORT}`;
const uploadDir = "uploads/";

const ACCESS_TTL = process.env.ACCESS_TTL || "15m";
const REFRESH_DAYS = Number(process.env.REFRESH_DAYS || 14);

if (!process.env.JWT_SECRET) {
  console.error("❌ Missing JWT_SECRET in .env");
  process.exit(1);
}

// ----------------------------
// MONGOOSE
// ----------------------------
console.log("MONGODB_URI from env:", process.env.MONGODB_URI);
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => {
    console.error("❌ Mongo connection error:", err);
    process.exit(1);
  });

// ----------------------------
// VONAGE
// ----------------------------
const privateKey = fs.readFileSync(process.env.VONAGE_PRIVATE_KEY_PATH);


const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
  applicationId: process.env.VONAGE_APPLICATION_ID,
  privateKey,
});

const callerId = process.env.VONAGE_PHONE_NUMBER;
let forwardTo = process.env.FORWARD_TO_NUMBER;

// runtime settings
let dialerSettings = {
  bulkDelayMs: 1500,
  enableVoicemailDrop: true,
  timeZone: process.env.DEFAULT_TIME_ZONE || "America/Jamaica",
};

// ----------------------------
// FS SETUP
// ----------------------------
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// ----------------------------
// APP / SERVER / IO
// ----------------------------
const app = express();
const server = http.createServer(app);
const io = socketio(server, {
  cors: { origin: true, credentials: true },
});

// ----------------------------
// MIDDLEWARE
// ----------------------------
app.use(cookieParser());
app.use(bodyParser.json({ limit: "2mb" }));
app.use(bodyParser.urlencoded({ extended: false }));

// ✅ Single, correct CORS setup (no duplicates)
const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  process.env.CORS_ORIGIN,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // allow server-to-server, curl, postman
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
  })
);

// ----------------------------
// STATE (IN-MEMORY)
// ----------------------------
let allCalls = [];
let bulkCallQueue = [];
let isBulkCallRunning = false;
let callNotes = [];

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
let activeVoicemailId = "default";

const TTS_VOICES = [
  { id: "Amy", label: "Amy (US Female)" },
  { id: "Joey", label: "Joey (US Male)" },
  { id: "Emma", label: "Emma (UK Female)" },
];

// ----------------------------
// SOCKET.IO
// ----------------------------
io.on("connection", (socket) => {
  console.log("📡 Client connected");
  socket.emit("callsUpdate", allCalls);
});

function broadcastCallUpdate(call) {
  io.emit("callUpdate", call);
}

function formatPhone(phone) {
  const clean = (phone || "").replace(/\D/g, "");
  if (clean.length === 11 && clean.startsWith("1")) {
    return `(${clean.slice(1, 4)}) ${clean.slice(4, 7)}-${clean.slice(7)}`;
  } else if (clean.length === 10) {
    return `(${clean.slice(0, 3)}) ${clean.slice(3, 6)}-${clean.slice(6)}`;
  }
  return phone;
}

// ----------------------------
// AUTH HELPERS (ACCESS + REFRESH)
// ----------------------------
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
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/", // ✅ FIX: cookie available to ALL auth routes
    maxAge: REFRESH_DAYS * 24 * 60 * 60 * 1000,
  };
}

// JWT access middleware
async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id);

    if (!user) {
      return res.status(401).json({ success: false, message: "User not found" });
    }

    req.auth = payload; // {id, role, isSuperAdmin}
    req.user = user;    // full doc for checks/settings
    return next();
  } catch (err) {
    console.error("Auth error:", err.message);
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
}

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

// ----------------------------
// CALL FUNCTIONS
// ----------------------------
async function initiateCall(toNumber, metadata = {}) {
  // normalize number
  let formatted = toNumber;
  const clean = (toNumber || "").replace(/\D/g, "");
  if (clean.length === 10) formatted = `+1${clean}`;
  else if (clean.length === 11 && clean.startsWith("1")) formatted = `+${clean}`;
  else if (clean && !toNumber.startsWith("+")) formatted = `+${clean}`;

  console.log(`📞 Calling: ${toNumber} → ${formatted}`);

  // create local record immediately
  const call = {
    number: formatted,
    uuid: `dial_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    status: "dialing",
    createdAt: new Date(),
    updatedAt: new Date(),
    type: metadata.type || "single",
    metadata,
  };

  allCalls.unshift(call);
  broadcastCallUpdate(call);

  try {
    const response = await vonage.voice.createOutboundCall({
      to: [{ type: "phone", number: formatted }],
      from: { type: "phone", number: callerId },
      answer_url: [`${PUBLIC_WEBHOOK_URL}/amd-ncco`],
      event_url: [`${PUBLIC_WEBHOOK_URL}/status`],
    });

    const uuid = response.uuid || response.calls?.[0]?.uuid;
    if (!uuid) throw new Error("No UUID from Vonage");

    call.uuid = uuid;
    call.status = "initiated";
    call.updatedAt = new Date();
    broadcastCallUpdate(call);

    console.log(`✅ Call initiated: ${formatted} | UUID: ${uuid}`);
    return call;
  } catch (err) {
    call.status = "failed";
    call.error = err.message;
    call.updatedAt = new Date();
    broadcastCallUpdate(call);
    console.error(`❌ Call failed: ${toNumber}`, err.message);
    throw err;
  }
}

async function processBulkQueue() {
  if (isBulkCallRunning || bulkCallQueue.length === 0) return;

  isBulkCallRunning = true;
  const queue = [...bulkCallQueue];
  bulkCallQueue = [];

  console.log(`🚀 BULK START: ${queue.length} calls | delay ${dialerSettings.bulkDelayMs}ms`);
  io.emit("bulkStart", { count: queue.length });

  let success = 0;
  for (let i = 0; i < queue.length; i++) {
    try {
      await initiateCall(queue[i].number, { type: "bulk", ...queue[i].metadata });
      success++;
      io.emit("bulkProgress", { current: i + 1, total: queue.length, success });
      await new Promise((r) => setTimeout(r, dialerSettings.bulkDelayMs || 1500));
    } catch (err) {
      console.error(`❌ Bulk call ${i + 1} failed:`, err.message);
      io.emit("bulkProgress", { current: i + 1, total: queue.length, success });
    }
  }

  console.log(`✅ BULK DONE: ${success}/${queue.length}`);
  io.emit("bulkComplete", { success, total: queue.length });
  isBulkCallRunning = false;
}

// ----------------------------
// ROUTES
// ----------------------------

// Health
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    status: "ok",
    message: "Vynce backend running",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/// ---------------- AUTH ----------------

// Register
app.post("/api/auth/register", async (req, res) => {
  try {
    let { firstName, lastName, email, password, plan } = req.body;

    // ✅ Normalize inputs
    firstName = String(firstName || "").trim();
    lastName = String(lastName || "").trim();
    email = String(email || "").trim().toLowerCase();
    password = String(password || "");

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "First name, last name, email, and password are required",
      });
    }

    // ✅ Prevent duplicate emails (case + whitespace safe)
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Email already registered",
      });
    }

    // ✅ Hash password correctly
    const passwordHash = await bcrypt.hash(password, 10);

    // ✅ Subscription defaults
    const subscriptionPlan = plan || "professional";
    const maxCalls =
      subscriptionPlan === "starter"
        ? 1000
        : subscriptionPlan === "enterprise"
        ? 20000
        : 5000;

    // ✅ Create user
    const user = await User.create({
      firstName,
      lastName,
      email, // already normalized
      passwordHash,
      subscription: { plan: subscriptionPlan, maxCalls },
      role: "customer",
      isSuperAdmin: false,
    });

    // ✅ Issue access token
    const accessToken = signAccessToken(user);

    // ✅ Issue refresh token (rotatable)
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

    // ✅ IMPORTANT: cookie path must be "/"
    res.cookie("vynce_refresh", rawRefresh, refreshCookieOptions());

    return res.json({
      success: true,
      token: accessToken,
      user: userToSafeObject(user),
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error during registration",
    });
  }
});
//-----------------------------
// Login
// ------------------------------
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "");

if (!cleanEmail || !cleanPassword) {
  return res
    .status(400)
    .json({ success: false, message: "Email and password are required" });
}

console.log("LOGIN DEBUG:", {
  rawBody: req.body,
  cleanEmail,
  passwordLen: cleanPassword.length,
});

const user = await User.findOne({ email: cleanEmail }).select("+passwordHash");

    // IMPORTANT: keep error message generic
    if (!user || !user.passwordHash) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid email or password" });
    }

    const match = await bcrypt.compare(cleanPassword, user.passwordHash);
    if (!match) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid email or password" });
    }

    const accessToken = signAccessToken(user);

    // rotate refresh token on every login
    const rawRefresh = createRefreshToken();
    const tokenHash = hashToken(rawRefresh);
    const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);

    user.refreshTokens = (user.refreshTokens || []).slice(-10); // keep last 10 sessions max
    user.refreshTokens.push({
      tokenHash,
      expiresAt,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      userAgent: req.get("user-agent") || "",
      ip: req.ip || "",
    });

    await user.save();

    // cookie options MUST include path (recommend "/")
    res.cookie("vynce_refresh", rawRefresh, refreshCookieOptions());

    return res.json({
      success: true,
      token: accessToken,
      user: userToSafeObject(user),
    });
  } catch (err) {
    console.error("Login error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error during login" });
  }
});

// Refresh (cookie-based, rotates)
app.post("/api/auth/refresh", async (req, res) => {
  try {
    const raw = req.cookies?.vynce_refresh;
    if (!raw) {
      return res.status(401).json({ success: false, message: "No refresh token" });
    }

    const tokenHash = hashToken(raw);

    const user = await User.findOne({ "refreshTokens.tokenHash": tokenHash });
    if (!user) {
      // ✅ clear with SAME options/path as set-cookie (ideally "/")
      res.clearCookie("vynce_refresh", { path: "/" });
      return res.status(401).json({ success: false, message: "Invalid refresh token" });
    }

    const session = (user.refreshTokens || []).find((t) => t.tokenHash === tokenHash);
    if (!session) {
      res.clearCookie("vynce_refresh", { path: "/" });
      return res.status(401).json({ success: false, message: "Invalid refresh token" });
    }

    if (new Date(session.expiresAt).getTime() < Date.now()) {
      user.refreshTokens = (user.refreshTokens || []).filter((t) => t.tokenHash !== tokenHash);
      await user.save();
      res.clearCookie("vynce_refresh", { path: "/" });
      return res.status(401).json({ success: false, message: "Refresh expired" });
    }

    // rotate: remove old, add new
    user.refreshTokens = (user.refreshTokens || []).filter((t) => t.tokenHash !== tokenHash);

    const newRaw = createRefreshToken();
    const newHash = hashToken(newRaw);
    const newExpiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);

    user.refreshTokens.push({
      tokenHash: newHash,
      expiresAt: newExpiresAt,
      createdAt: new Date(),
      lastUsedAt: new Date(),
      userAgent: req.get("user-agent") || "",
      ip: req.ip || "",
    });

    await user.save();

    const accessToken = signAccessToken(user);

    res.cookie("vynce_refresh", newRaw, refreshCookieOptions());

    return res.json({ success: true, token: accessToken, user: userToSafeObject(user) });
  } catch (err) {
    console.error("Refresh error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Logout (current device/session)
app.post("/api/auth/logout", async (req, res) => {
  try {
    const raw = req.cookies?.vynce_refresh;
    if (raw) {
      const tokenHash = hashToken(raw);
      await User.updateOne(
        { "refreshTokens.tokenHash": tokenHash },
        { $pull: { refreshTokens: { tokenHash } } }
      );
    }

    // ✅ clear cookie using correct path (match set-cookie)
    res.clearCookie("vynce_refresh", { path: "/" });

    return res.json({ success: true });
  } catch (err) {
    console.error("Logout error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Logout all devices
app.post("/api/auth/logout-all", authMiddleware, async (req, res) => {
  await User.updateOne({ _id: req.user._id }, { $set: { refreshTokens: [] } });
  res.clearCookie("vynce_refresh", { path: "/" });
  res.json({ success: true });
});

// Current user
app.get("/api/auth/me", authMiddleware, async (req, res) => {
  res.json({ success: true, user: userToSafeObject(req.user) });
});


// ---------------- ADMIN ----------------

// Create customer (admin/superadmin)
app.post("/api/admin/create-customer", authMiddleware, requireRole("admin", "superadmin"), async (req, res) => {
  try {
    // If you still want ONLY superadmin, keep this check:
    if (!req.user.isSuperAdmin) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const { company, firstName, lastName, email, plan } = req.body;

    if (!company || !firstName || !lastName || !email || !plan) {
      return res.status(400).json({
        success: false,
        message: "Company, first name, last name, email, and plan are required",
      });
    }

    const existing = await User.findOne({ email: email.toLowerCase() }).select("+passwordHash");

    if (existing) {
      return res.status(400).json({ success: false, message: "Email is already in use" });
    }

    const subscriptionPlan = plan;
    const maxCalls =
      subscriptionPlan === "starter" ? 1000 : subscriptionPlan === "enterprise" ? 20000 : 5000;

    const initialPassword = "Vynce" + Math.random().toString(36).slice(2, 8) + "!";
    const passwordHash = await bcrypt.hash(initialPassword, 10);

    const user = await User.create({
      firstName,
      lastName,
      email: email.toLowerCase(),
      passwordHash,
      company,
      subscription: { plan: subscriptionPlan, maxCalls },
      role: "customer",
      isSuperAdmin: false,
    });

    res.json({
      success: true,
      message: "Customer created successfully",
      user: userToSafeObject(user),
      initialPassword,
    });
  } catch (err) {
    console.error("Create customer error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Clear calls (admin+ only)
app.post("/api/admin/clear-calls", authMiddleware, requireRole("admin", "superadmin"), (req, res) => {
  allCalls = [];
  console.log("🧹 Admin cleared in-memory call history");
  res.json({ success: true, message: "In-memory call history cleared" });
});

// ---------------- SETTINGS ----------------
// (If you want these protected: add authMiddleware + requireRole)
app.get("/api/settings", authMiddleware, requireRole("admin", "superadmin"), (req, res) => {
  res.json({
    success: true,
    settings: {
      callerId,
      forwardTo,
      publicWebhookUrl: PUBLIC_WEBHOOK_URL,
      bulkDelayMs: dialerSettings.bulkDelayMs,
      enableVoicemailDrop: dialerSettings.enableVoicemailDrop,
      timeZone: dialerSettings.timeZone,
    },
  });
});

app.post("/api/settings", authMiddleware, requireRole("admin", "superadmin"), (req, res) => {
  const { bulkDelayMs, enableVoicemailDrop, forwardTo: newForwardTo, timeZone } = req.body;

  if (typeof bulkDelayMs === "number" && !Number.isNaN(bulkDelayMs) && bulkDelayMs >= 0 && bulkDelayMs <= 60000) {
    dialerSettings.bulkDelayMs = bulkDelayMs;
  }

  if (typeof enableVoicemailDrop === "boolean") {
    dialerSettings.enableVoicemailDrop = enableVoicemailDrop;
  }

  if (typeof newForwardTo === "string" && newForwardTo.trim()) {
    let num = newForwardTo.trim();
    const digits = num.replace(/\D/g, "");

    if (digits.length === 10) num = `+1${digits}`;
    else if (digits.length === 11 && digits.startsWith("1")) num = `+${digits}`;
    else if (digits && num[0] !== "+") num = `+${digits}`;

    forwardTo = num;
    console.log("📞 Updated forward-to number:", forwardTo);
  }

  if (typeof timeZone === "string" && timeZone.trim()) {
    dialerSettings.timeZone = timeZone.trim();
    console.log("🌐 Updated time zone:", dialerSettings.timeZone);
  }

  res.json({
    success: true,
    message: "Settings updated",
    settings: {
      callerId,
      forwardTo,
      publicWebhookUrl: PUBLIC_WEBHOOK_URL,
      bulkDelayMs: dialerSettings.bulkDelayMs,
      enableVoicemailDrop: dialerSettings.enableVoicemailDrop,
      timeZone: dialerSettings.timeZone,
    },
  });
});

// ---------------- CALL APIs ----------------
app.get("/api/calls", authMiddleware, (req, res) => {
  res.json(allCalls);
});

app.post("/api/make-call", authMiddleware, async (req, res) => {
  const { to, agent } = req.body;
  if (!to) {
    return res.status(400).json({ success: false, message: "Missing 'to' number in request body" });
  }

  try {
    const metadata = {};
    if (agent) metadata.agent = agent;

    const call = await initiateCall(to, metadata);
    res.json({ success: true, data: call });
  } catch (err) {
    console.error("Error in /api/make-call:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/api/end-call", authMiddleware, async (req, res) => {
  const { uuid } = req.body;
  if (!uuid) return res.status(400).json({ success: false, message: "Missing UUID" });

  const call = allCalls.find((c) => c.uuid === uuid);
  if (!call) return res.status(404).json({ success: false, message: "Call not found" });

  try {
    if (vonage.voice && typeof vonage.voice.updateCall === "function") {
      await vonage.voice.updateCall(call.uuid, { action: "hangup" });
    }
  } catch (err) {
    console.error("Vonage hangup failed (continuing):", err.message);
  }

  const endTime = new Date();
  if (!call.createdAt) call.createdAt = endTime;

  const startMs = new Date(call.createdAt).getTime();
  const endMs = endTime.getTime();
  const totalSeconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;

  call.duration = `${mins}:${secs.toString().padStart(2, "0")}`;
  call.status = "ended";
  call.updatedAt = endTime;
  call.endedAt = endTime;

  broadcastCallUpdate(call);
  res.json({ success: true, message: "Call ended" });
});

// ---------------- VONAGE TEST ----------------
app.get("/api/vonage/test", authMiddleware, requireRole("admin", "superadmin"), async (req, res) => {
  try {
    const url = new URL("https://rest.nexmo.com/account/get-balance");
    url.searchParams.set("api_key", process.env.VONAGE_API_KEY);
    url.searchParams.set("api_secret", process.env.VONAGE_API_SECRET);

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Vonage HTTP ${resp.status} ${resp.statusText}`);

    const data = await resp.json();

    res.json({
      success: true,
      balance: data.value,
      currency: "EUR",
      account: {
        apiKey: process.env.VONAGE_API_KEY,
        label: process.env.VONAGE_PLAN_NAME || "Vonage Voice Account",
        dashboardUrl: process.env.VONAGE_DASHBOARD_URL || "https://dashboard.vonage.com",
      },
    });
  } catch (err) {
    console.error("Vonage test failed:", err);
    res.status(500).json({ success: false, message: err.message || "Failed to connect to Vonage" });
  }
});

// ---------------- WEBHOOKS ----------------
app.post("/status", (req, res) => {
  const { uuid, status, detail, sip_code } = req.body;
  const call = allCalls.find((c) => c.uuid === uuid);

  if (call) {
    call.status = status;
    call.updatedAt = new Date();

    if (detail) call.detail = detail;
    if (sip_code) call.sipCode = sip_code;

    if (status === "failed" && detail) {
      call.error = `${detail} (SIP ${sip_code || ""})`.trim();
    }

    if (["completed", "ended", "failed", "busy", "timeout", "rejected", "cancelled"].includes(status)) {
      if (!call.endedAt) call.endedAt = new Date();
      if (call.createdAt) {
        const start = new Date(call.createdAt).getTime();
        const end = new Date(call.endedAt).getTime();
        const diffSeconds = Math.max(0, Math.floor((end - start) / 1000));
        const mins = Math.floor(diffSeconds / 60);
        const secs = diffSeconds % 60;
        call.duration = `${mins}:${secs.toString().padStart(2, "0")}`;
      }
    }

    broadcastCallUpdate(call);
  }

  res.sendStatus(200);
});

app.get("/voice", (req, res) => {
  res.json([
    { action: "talk", text: "Connecting..." },
    { action: "connect", from: callerId, endpoint: [{ type: "phone", number: forwardTo }] },
  ]);
});

app.get("/amd-ncco", (req, res) => {
  res.json([
    {
      action: "connect",
      from: callerId,
      endpoint: [{ type: "phone", number: forwardTo }],
      machineDetection: "continue",
      eventUrl: [`${PUBLIC_WEBHOOK_URL}/amd-status`],
    },
  ]);
});

app.post("/amd-status", (req, res) => {
  const { uuid, conversation_uuid, machine_detection } = req.body;
  const callUuid = uuid || conversation_uuid;

  console.log(`🤖 AMD Result for ${callUuid}: ${machine_detection}`);

  const call = allCalls.find((c) => c.uuid === callUuid);
  if (!call) return res.sendStatus(200);

  if (machine_detection === "machine") {
    call.voicemailDetected = true;

    if (!dialerSettings.enableVoicemailDrop) {
      call.status = "voicemail";
      call.voicemailLeft = false;
      call.endedAt = new Date();

      if (call.createdAt) {
        const start = new Date(call.createdAt).getTime();
        const end = call.endedAt.getTime();
        const secs = Math.max(0, Math.floor((end - start) / 1000));
        const mins = Math.floor(secs / 60);
        const rest = secs % 60;
        call.duration = `${mins}:${rest.toString().padStart(2, "0")}`;
      }

      call.updatedAt = new Date();
      broadcastCallUpdate(call);
      return res.sendStatus(200);
    }

    call.status = "voicemail";
    call.voicemailLeft = true;
    call.endedAt = new Date();

    if (call.createdAt) {
      const start = new Date(call.createdAt).getTime();
      const end = call.endedAt.getTime();
      const secs = Math.max(0, Math.floor((end - start) / 1000));
      const mins = Math.floor(secs / 60);
      const rest = secs % 60;
      call.duration = `${mins}:${rest.toString().padStart(2, "0")}`;
    }

    const activeMsg = voicemailMessages.find((m) => m.id === activeVoicemailId) || voicemailMessages[0];

    const textToSay = (activeMsg.content || "")
      .replace(/\[Name\]/g, call.metadata?.name || "there")
      .replace(/\[Agent\]/g, call.metadata?.agent || "a team member")
      .replace(/\[Company\]/g, call.metadata?.company || "our company")
      .replace(/\[Number\]/g, formatPhone(callerId));

    const ncco = [
      { action: "talk", text: textToSay, voiceName: activeMsg.voiceId || "Amy" },
      { action: "hangup" },
    ];

    call.updatedAt = new Date();
    broadcastCallUpdate(call);
    return res.json(ncco);
  }

  res.sendStatus(200);
});

// ---------------- CSV UPLOAD ----------------
const upload = multer({ dest: uploadDir });

/**
 * Normalize header names so:
 * "Phone Number", "phone_number", "PHONE #" → "phone number"
 */
function normalizeHeader(header = "") {
  return header
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/#/g, "number");
}

/**
 * Extract a usable NANP phone number
 * Returns +1XXXXXXXXXX or null
 */
function normalizePhone(value) {
  if (!value) return null;

  let num = value.toString().replace(/\D/g, "");
  num = num.replace(/^0+/, "");

  if (num.length === 10) num = "1" + num;
  if (num.length === 11 && num.startsWith("1")) return `+${num}`;

  return null;
}

app.post(
  "/api/upload-csv",
  authMiddleware,
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const filePath = req.file.path;
    const numbers = [];
    let headersMap = {};
    let phoneKey = null;

    fs.createReadStream(filePath)
      .pipe(csv())
      .on("headers", (headers) => {
        headers.forEach((h) => {
          headersMap[normalizeHeader(h)] = h;
        });

        phoneKey =
          headersMap["phone"] ||
          headersMap["phone number"] ||
          headersMap["mobile"] ||
          headersMap["mobile number"] ||
          headersMap["contact"] ||
          headersMap["contact number"] ||
          headersMap["number"];

        console.log("📄 CSV Headers:", headers);
        console.log("📞 Detected phone column:", phoneKey);
      })
      .on("data", (row) => {
        if (!phoneKey || !row[phoneKey]) return;

        const phone = normalizePhone(row[phoneKey]);
        if (!phone) return;

        numbers.push({
          number: phone,
          metadata: {
            name:
              row[headersMap["name"]] ||
              row[headersMap["full name"]] ||
              "Unknown",
            address:
              row[headersMap["address"]] ||
              row[headersMap["street"]] ||
              "",
            city: row[headersMap["city"]] || "",
            state: row[headersMap["state"]] || "",
            zip:
              row[headersMap["zip"]] ||
              row[headersMap["zipcode"]] ||
              "",
            country: row[headersMap["country"]] || "",
            source: req.file.originalname,
          },
        });
      })
      .on("end", () => {
        try {
          fs.unlinkSync(filePath);
        } catch {}

        if (!numbers.length) {
          return res.status(400).json({
            success: false,
            message: "No valid phone numbers found in CSV",
          });
        }

        console.log(`📄 CSV parsed: ${numbers.length} valid numbers`);

        bulkCallQueue = numbers;
        processBulkQueue();

        res.json({ success: true, count: numbers.length });
      })
      .on("error", (err) => {
        try {
          fs.unlinkSync(filePath);
        } catch {}

        console.error("CSV parse error:", err);
        res.status(500).json({
          success: false,
          message: "Failed to parse CSV",
        });
      });
  }
);


// ---------------- SCRIPTS ----------------
app.get("/api/scripts", authMiddleware, (req, res) => {
  res.json({ success: true, scripts: callScripts.filter((s) => s.isActive) });
});

app.post("/api/scripts", authMiddleware, (req, res) => {
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
  res.status(201).json({ success: true, message: "Script created successfully", script: newScript });
});

app.put("/api/scripts/:id", authMiddleware, (req, res) => {
  const { id } = req.params;
  const { name, content, category } = req.body;

  const index = callScripts.findIndex((s) => s.id === id);
  if (index === -1) return res.status(404).json({ success: false, message: "Script not found" });
  if (!name || !content) return res.status(400).json({ success: false, message: "Name and content are required" });

  callScripts[index] = { ...callScripts[index], name, content, category: category || callScripts[index].category, updatedAt: new Date() };
  res.json({ success: true, message: "Script updated successfully", script: callScripts[index] });
});

app.delete("/api/scripts/:id", authMiddleware, (req, res) => {
  const { id } = req.params;
  const before = callScripts.length;
  callScripts = callScripts.filter((s) => s.id !== id);
  if (callScripts.length === before) return res.status(404).json({ success: false, message: "Script not found" });
  res.json({ success: true, message: "Script deleted successfully" });
});

// ---------------- VOICEMAIL ----------------
app.get("/api/voicemail-messages", authMiddleware, (req, res) => {
  res.json({ success: true, messages: voicemailMessages, activeId: activeVoicemailId, voices: TTS_VOICES });
});

app.post("/api/voicemail-messages", authMiddleware, (req, res) => {
  const { id, name, content, voiceId } = req.body;

  if (!name || !content || !voiceId) {
    return res.status(400).json({ success: false, message: "Name, content, and voice are required." });
  }

  const index = voicemailMessages.findIndex((m) => m.id === id);

  if (index !== -1) {
    voicemailMessages[index] = { ...voicemailMessages[index], name, content, voiceId, updatedAt: new Date() };
    return res.json({ success: true, message: "Voicemail updated.", data: voicemailMessages[index] });
  }

  const newMsg = { id: uuidv4(), name, content, voiceId, isActive: true, createdAt: new Date() };
  voicemailMessages.push(newMsg);
  return res.status(201).json({ success: true, message: "Voicemail created.", data: newMsg });
});

// Call notes
app.post("/api/calls/:uuid/notes", authMiddleware, (req, res) => {
  const { uuid } = req.params;
  const { content, scriptUsed, outcome, followUpRequired } = req.body;

  const call = allCalls.find((c) => c.uuid === uuid);
  if (!call) return res.status(404).json({ success: false, message: "Call not found" });

  call.notes = content || "";
  if (outcome) call.outcome = outcome;
  if (typeof followUpRequired === "boolean") call.followUpRequired = followUpRequired;
  if (scriptUsed) call.scriptUsed = scriptUsed;
  call.updatedAt = new Date();

  callNotes.push({
    id: uuidv4(),
    callUuid: uuid,
    content: content || "",
    scriptUsed: scriptUsed || null,
    outcome: outcome || null,
    followUpRequired: !!followUpRequired,
    createdAt: new Date(),
  });

  res.json({ success: true, message: "Notes saved", data: call });
});

// ----------------------------
// START + ROUTE LOGGING
// ----------------------------
server.listen(PORT, () => {
  console.log(`\n🚀 Vynce on port ${PORT}`);
  console.log(`✅ Ready\n`);

  console.log("🚀 Registered API Routes:");
  app._router.stack
    .filter((r) => r.route)
    .forEach((r) => {
      const methods = Object.keys(r.route.methods).map((m) => m.toUpperCase()).join(", ");
      console.log(`  ${methods} http://localhost:${PORT}${r.route.path}`);
    });
});
