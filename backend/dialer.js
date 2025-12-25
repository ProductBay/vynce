// Or require() style if you’re not using ES modules:
// const { Vonage } = require('@vonage/server-sdk');
// const fs = require('fs');
// const { v4: uuidv4 } = require('uuid');

// allCalls is declared later in the STATE section to avoid redeclaration
// dialer.js - CLEAN VERSION (NO DUPLICATE RESPONSES)
require("dotenv").config()
console.log("MONGODB_URI from env:", process.env.MONGODB_URI);  // 👈 add this
const fs = require("fs")
const http = require("http")
const express = require("express")
const bodyParser = require("body-parser")
const socketio = require("socket.io")
const cors = require("cors")
const multer = require("multer")
const csv = require("csv-parser")
const { Vonage } = require("@vonage/server-sdk")
const { v4: uuidv4 } = require("uuid")
const PUBLIC_WEBHOOK_URL = process.env.PUBLIC_WEBHOOK_URL || "http://localhost:3001";
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("./models/User");
const analyticsRoutes = require("./routes/analytics");
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB"))
  .catch((err) => console.error("❌ Mongo connection error:", err));
// -------------------------------------------
//  VONAGE
// -------------------------------------------
const privateKey = fs.readFileSync(process.env.VONAGE_PRIVATE_KEY_PATH);
const vonage = new Vonage({
  apiKey: process.env.VONAGE_API_KEY,
  apiSecret: process.env.VONAGE_API_SECRET,
  applicationId: process.env.VONAGE_APPLICATION_ID,
  privateKey,
})

const callerId = process.env.VONAGE_PHONE_NUMBER;
// Make this mutable so admin can change it from Settings
let forwardTo = process.env.FORWARD_TO_NUMBER;
// Runtime dialer settings (can be changed from UI)
let dialerSettings = {
  bulkDelayMs: 1500,          // delay between bulk calls
  enableVoicemailDrop: true,  // whether AMD drops voicemail messages
};
// -------------------------------------------
//  TTS VOICES (Supported by Vonage)
// -------------------------------------------

// -------------------------------------------
//  CONFIG
// -------------------------------------------
const uploadDir = "uploads/"
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const app = express()
app.use(cors({ origin: "*" }))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))
app.use("/api/settings", settingsRoutes);
app.use("/api/analytics", analyticsRoutes);



// -------------------------------------------
//  STATE
// -------------------------------------------
let allCalls = [];
let bulkCallQueue = [];
let isBulkCallRunning = false;
let currentBulkJob = null;
let callNotes = [];
let pendingJobs = [];

// -------------------------------------------
//  SOCKET.IO
// -------------------------------------------
const server = http.createServer(app)
const io = socketio(server, { cors: { origin: "*" } })

io.on("connection", (socket) => {
  console.log("📡 Client connected")
  socket.emit("callsUpdate", allCalls)
})

function generateToken(user) {
  return jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

function userToSafeObject(userDoc) {
  if (!userDoc) return null;
  const obj = userDoc.toObject();
  delete obj.passwordHash;
  return obj;
}

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
    req.user = user;
    next();
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
}

function broadcastCallUpdate(call) {
  io.emit("callUpdate", call)
}
function formatPhone(phone) {
  const clean = phone.replace(/\D/g, '');
  if (clean.length === 11 && clean.startsWith('1')) {
    return `(${clean.slice(1,4)}) ${clean.slice(4,7)}-${clean.slice(7)}`;
  } else if (clean.length === 10) {
    return `(${clean.slice(0,3)}) ${clean.slice(3,6)}-${clean.slice(6)}`;
  }
  return phone;
}
// -------------------------------------------
//  CALL FUNCTIONS
// -------------------------------------------
async function initiateCall(toNumber, metadata = {}) {
  try {
    // Format number
    let formatted = toNumber;
    const clean = toNumber.replace(/\D/g, '');
    if (clean.length === 10) formatted = `+1${clean}`;
    else if (!toNumber.startsWith('+')) formatted = `+${clean}`;

    console.log(`📞 Calling: ${toNumber} → ${formatted}`);

    // Create local record (shown immediately in UI)
    const call = {
      number: formatted,
      uuid: `dial_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`, // temporary
      status: 'dialing',
      createdAt: new Date(),
      type: metadata.type || 'single',
      metadata,
    };
    allCalls.unshift(call);
    broadcastCallUpdate(call);

    // Vonage outbound call
    const response = await vonage.voice.createOutboundCall({
      to: [{ type: 'phone', number: formatted }],
      from: { type: 'phone', number: callerId },

      // NCCO with AMD
      answer_url: [`${PUBLIC_WEBHOOK_URL}/amd-ncco`],

      // Call status events: started, ringing, answered, completed, failed, etc.
      event_url: [`${PUBLIC_WEBHOOK_URL}/status`],
    });

    const uuid = response.uuid || response.calls?.[0]?.uuid;
    if (!uuid) throw new Error('No UUID from Vonage');

    // Replace temp ID with real Vonage UUID (this is what the frontend gets)
    call.uuid = uuid;
    call.status = 'initiated';
    broadcastCallUpdate(call);

    console.log(`✅ Call: ${formatted} | UUID: ${uuid}`);
    return call;
  } catch (err) {
    console.error(`❌ Call failed: ${toNumber}`, err.message);
    throw err;
  }
}
  //console.log(`🚀 BULK START: ${queue.length} calls with delay ${dialerSettings.bulkDelayMs}ms`);
async function processBulkQueue() {
  if (isBulkCallRunning || bulkCallQueue.length === 0) return;

  isBulkCallRunning = true;
  const queue = [...bulkCallQueue];
  bulkCallQueue = [];

  console.log(
    `🚀 BULK START: ${queue.length} calls with delay ${dialerSettings.bulkDelayMs}ms`
  );
  io.emit("bulkStart", { count: queue.length });

  let success = 0;
  for (let i = 0; i < queue.length; i++) {
    try {
      await initiateCall(queue[i].number, {
        type: "bulk",
        ...queue[i].metadata,
      });
      success++;
      io.emit("bulkProgress", {
        current: i + 1,
        total: queue.length,
        success,
      });

      // use admin‑configured delay between calls
      await new Promise((r) =>
        setTimeout(r, dialerSettings.bulkDelayMs || 1500)
      );
    } catch (err) {
      console.error(`❌ Bulk call ${i + 1} failed`);
    }
  }

  console.log(`✅ BULK DONE: ${success}/${queue.length}`);
  io.emit("bulkComplete", { success, total: queue.length });
  isBulkCallRunning = false;
}

// CRITICAL FIX: Ensure callScripts is declared globally here
let callScripts = [
  {
    id: '1',
    name: 'Sales Introduction',
    content: `Hello [Name], this is [Agent] calling from Vynce.`,
    category: 'sales',
    isActive: true
  }
];

// dialer.js - Define the Voicemail message storage (if not already global)
let voicemailMessages = [
  {
    id: 'default',
    name: 'Default Message',
    content: "Hello, this is Vynce calling back...",
    voiceId: "Amy", label: "Amy (US Female)",
    isActive: true
  }
];
let activeVoicemailId = 'default';

// Available Vonage TTS voices (simplified example – you can add more)
const TTS_VOICES = [
  { id: "Amy", label: "Amy (US Female)" },
  { id: "Joey", label: "Joey (US Male)" },
  { id: "Emma", label: "Emma (UK Female)" },
];


// -------------------------------------------
//  ROUTES
// -------------------------------------------
// -------------------------------------------
//  ROUTES
// -------------------------------------------

// Health check
app.get("/api/health", (req, res) => {
  res.json({ success: true, message: "Vynce running" });
});

/**
 * ADMIN SETTINGS API
 * Exposes callerId, forwardTo, webhook URL
 * and lets admin change bulkDelayMs, enableVoicemailDrop, forwardTo.
 */
app.get("/api/settings", (req, res) => {
  res.json({
    success: true,
    settings: {
      callerId,
      forwardTo,
      publicWebhookUrl: PUBLIC_WEBHOOK_URL,
      bulkDelayMs: dialerSettings.bulkDelayMs,
      enableVoicemailDrop: dialerSettings.enableVoicemailDrop,
    },
  });
});

app.post("/api/settings", (req, res) => {
  const {
    bulkDelayMs,
    enableVoicemailDrop,
    forwardTo: newForwardTo,
  } = req.body;

  // Validate and update bulk delay
  if (
    typeof bulkDelayMs === "number" &&
    !Number.isNaN(bulkDelayMs) &&
    bulkDelayMs >= 0 &&
    bulkDelayMs <= 60000
  ) {
    dialerSettings.bulkDelayMs = bulkDelayMs;
  }

  // Update voicemail drop toggle
  if (typeof enableVoicemailDrop === "boolean") {
    dialerSettings.enableVoicemailDrop = enableVoicemailDrop;
  }

  // Validate and update forward-to number (basic normalization)
  if (typeof newForwardTo === "string" && newForwardTo.trim()) {
    let num = newForwardTo.trim();
    const digits = num.replace(/\D/g, "");

    if (digits.length === 10) {
      // assume US 10‑digit -> +1XXXXXXXXXX
      num = `+1${digits}`;
    } else if (digits.length === 11 && digits.startsWith("1")) {
      num = `+${digits}`;
    } else if (num[0] !== "+") {
      num = `+${digits}`;
    }

    forwardTo = num;
    console.log("📞 Updated forward‑to number:", forwardTo);
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
    },
  });
});

// Return all calls (used by Calls.jsx & CallList.jsx)
app.get("/api/calls", (req, res) => {
  res.json(allCalls);
});

// Single call endpoint used by Topbar "New Call" button
app.post("/api/make-call", async (req, res) => {
  const { to, agent } = req.body;
  if (!to) {
    return res.status(400).json({
      success: false,
      message: "Missing 'to' number in request body",
    });
  }

  try {
    const metadata = {};
    if (agent) metadata.agent = agent;

    const call = await initiateCall(to, metadata); // pass metadata
    res.json({ success: true, data: call });
  } catch (err) {
    console.error("Error in /api/make-call:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------- AUTH ROUTES ----------------

// Register (for now: you can use this to create accounts; later you can restrict or expose publicly)
app.post("/api/auth/register", async (req, res) => {
  try {
    const { firstName, lastName, email, password, plan } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and password are required" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: "Email is already in use" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const subscriptionPlan = plan || "professional";
    const maxCalls =
      subscriptionPlan === "starter"
        ? 1000
        : subscriptionPlan === "enterprise"
        ? 20000
        : 5000; // default professional

    const user = await User.create({
      firstName,
      lastName,
      email: email.toLowerCase(),
      passwordHash,
      subscription: {
        plan: subscriptionPlan,
        maxCalls,
      },
    });

    const token = generateToken(user);
    res.json({
      success: true,
      token,
      user: userToSafeObject(user),
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid email or password" });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid email or password" });
    }

    const token = generateToken(user);
    res.json({
      success: true,
      token,
      user: userToSafeObject(user),
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get current user
app.get("/api/auth/me", authMiddleware, async (req, res) => {
  res.json({
    success: true,
    user: userToSafeObject(req.user),
  });
});

// ---------------- ADMIN: CREATE CUSTOMER ----------------
app.post("/api/admin/create-customer", authMiddleware, async (req, res) => {
  try {
    // Only super admin (you) can create customers
    if (!req.user.isSuperAdmin) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    const { company, firstName, lastName, email, plan } = req.body;

    if (!company || !firstName || !lastName || !email || !plan) {
      return res.status(400).json({
        success: false,
        message: "Company, first name, last name, email, and plan are required",
      });
    }

    // Check if email is already in use
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res
        .status(400)
        .json({ success: false, message: "Email is already in use" });
    }

    // Decide maxCalls based on Vynce plan
    const subscriptionPlan = plan;
    const maxCalls =
      subscriptionPlan === "starter"
        ? 1000
        : subscriptionPlan === "enterprise"
        ? 20000
        : 5000; // professional default

    // Generate a simple initial password (you can change the logic)
    const initialPassword =
      "Vynce" + Math.random().toString(36).slice(2, 8) + "!";
    const passwordHash = await bcrypt.hash(initialPassword, 10);

    const user = await User.create({
      firstName,
      lastName,
      email: email.toLowerCase(),
      passwordHash,
      company,
      subscription: {
        plan: subscriptionPlan,
        maxCalls,
      },
      isSuperAdmin: false,
    });

    res.json({
      success: true,
      message: "Customer created successfully",
      user: userToSafeObject(user),
      initialPassword, // <-- you can show/copy this in the UI and send to customer
    });
  } catch (err) {
    console.error("Create customer error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

const settingsRoutes = require("./routes/settings");

// -------------------------------------------
//  SETTINGS / VONAGE TEST ENDPOINT
// -------------------------------------------
// Vonage balance / plan test endpoint
app.get("/api/vonage/test", async (req, res) => {
  try {
    // Use Vonage REST API directly instead of vonage.account.getBalance()
    const url = new URL("https://rest.nexmo.com/account/get-balance");
    url.searchParams.set("api_key", process.env.VONAGE_API_KEY);
    url.searchParams.set("api_secret", process.env.VONAGE_API_SECRET);

    const resp = await fetch(url); // Node 22 has global fetch
    if (!resp.ok) {
      throw new Error(`Vonage HTTP ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json();
    console.log("✅ Vonage balance response:", data);

    const usage = {
      calls: 0,
      cost: 0,
    };

    const accountLabel =
      process.env.VONAGE_PLAN_NAME || "Vonage Voice Account";

    res.json({
      success: true,
      balance: data.value,          // Vonage returns { value: <balance> }
      autoReload: false,            // not provided by this endpoint
      currency: "EUR",              // or whatever your account uses
      usage,
      account: {
        apiKey: process.env.VONAGE_API_KEY,
        label: accountLabel,
        dashboardUrl:
          process.env.VONAGE_DASHBOARD_URL ||
          "https://dashboard.vonage.com",
      },
    });
  } catch (err) {
    console.error("Vonage test failed:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Failed to connect to Vonage",
    });
  }
});

// dialer.js - /status Webhook
app.post("/status", (req, res) => {
  console.log(`  ${methods} ${r.route.path}`);

  const { uuid, status, detail, sip_code } = req.body;
  const call = allCalls.find((c) => c.uuid === uuid);

  if (call) {
    call.status = status;
    call.updatedAt = new Date();

    // Save error info for UI
    if (detail) call.detail = detail;
    if (sip_code) call.sipCode = sip_code;
    if (status === "failed" && detail) {
      call.error = `${detail} (SIP ${sip_code || ""})`.trim();
    }

    // Freeze duration on end-like statuses
    if (
      ["completed", "ended", "failed", "busy", "timeout", "rejected", "cancelled"].includes(
        status
      )
    ) {
      if (!call.endedAt) {
        call.endedAt = new Date();
      }
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

app.post("/api/admin/clear-calls", (req, res) => {
  allCalls = [];
  console.log("🧹 Admin cleared in-memory call history");
  res.json({ success: true, message: "In-memory call history cleared" });
});

app.post("/api/end-call", async (req, res) => {
  const { uuid } = req.body;
  if (!uuid) {
    return res.status(400).json({ success: false, message: "Missing UUID" });
  }

  const call = allCalls.find((c) => c.uuid === uuid);
  if (!call) {
    return res.status(404).json({ success: false, message: "Call not found" });
  }

  // --- TRY to hang up in Vonage, but only if the method exists ---
  try {
    if (vonage.voice && typeof vonage.voice.updateCall === "function") {
      await vonage.voice.updateCall(call.uuid, { action: "hangup" });
    } else {
      console.warn("vonage.voice.updateCall not available; skipping remote hangup");
    }
  } catch (err) {
    console.error("Vonage hangup failed (continuing anyway):", err.message);
    // we keep going, we still end the call locally
  }
  // ---------------------------------------------------------------

  const endTime = new Date();
  if (!call.createdAt) {
    call.createdAt = endTime;
  }

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

app.get("/voice", (req, res) => {
  res.json([
    { action: "talk", text: "Connecting..." },
    { action: "connect", from: callerId, endpoint: [{ type: "phone", number: forwardTo }] }
  ])
})

// Webhook: Receives the AMD result and executes the VM drop if needed
app.post("/amd-status", (req, res) => {
  const { uuid, conversation_uuid, machine_detection } = req.body;
  const callUuid = uuid || conversation_uuid;

  console.log(`🤖 AMD Result for ${callUuid}: ${machine_detection}`);

  const call = allCalls.find((c) => c.uuid === callUuid);
  if (!call) {
    console.warn(`❌ Call not found for AMD: ${callUuid}`);
    return res.sendStatus(200);
  }

    if (machine_detection === "machine") {
    call.voicemailDetected = true;

    // If admin has disabled voicemail drop, just mark and return
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
      broadcastCallUpdate(call);
      return res.sendStatus(200);
    }

    // Voicemail drop enabled → play active voicemail message
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

    const activeMsg =
      voicemailMessages.find((m) => m.id === activeVoicemailId) ||
      voicemailMessages[0];

    let textToSay = activeMsg.content
      .replace(/\[Name\]/g, call.metadata?.name || "there")
      .replace(/\[Agent\]/g, call.metadata?.agent || "a team member")
      .replace(/\[Company\]/g, call.metadata?.company || "our company")
      .replace(/\[Number\]/g, formatPhone(callerId));

    const ncco = [
      {
        action: "talk",
        text: textToSay,
        voiceName: activeMsg.voiceId || "Amy",
      },
      { action: "hangup" },
    ];

    console.log(`📢 Dropping VM: "${textToSay}"`);
    broadcastCallUpdate(call);
    return res.json(ncco);
  }
  res.sendStatus(200);
});

// -------------------------------------------
//  CSV UPLOAD - FIXED (NO DUPLICATE RESPONSES)
// -------------------------------------------
const upload = multer({ dest: uploadDir })

app.post("/api/upload-csv", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file" })

  const path = req.file.path
  const numbers = []
  let responseSent = false

  const stream = fs.createReadStream(path)
    .pipe(csv())
    .on("data", (row) => {
      // Support flexible column names
      const phoneCol = row.number || row.phone || row.telephone || row.contact || row.mobile || row.phonenumber
      const nameCol = row.name || row.fullname || row.firstname || row.first_name || row.contactname || row.Name || row.FullName
      const addressCol = row.address || row.addr || row.street || row.location || row.Address || row.Street

      if (phoneCol && phoneCol.trim()) {
        let num = phoneCol.toString().trim().replace(/\D/g, '')
        if (num.length === 10) num = `1${num}`
        if (num.length >= 10) {
          numbers.push({
            number: `+${num}`,
            metadata: {
              name: nameCol ? nameCol.trim() : 'Unknown',
              address: addressCol ? addressCol.trim() : '',
              source: req.file.originalname
            }
          })
        }
      }
    })
    .on("end", async () => {
      try {
        fs.unlinkSync(path)
      } catch {}

      if (responseSent) return
      responseSent = true

      if (numbers.length === 0) {
        return res.status(400).json({ success: false, message: "No valid phone numbers found" })
      }

      console.log(`📄 CSV: ${numbers.length} numbers with metadata`)
      bulkCallQueue = numbers
      processBulkQueue()

      res.json({ success: true, count: numbers.length })
    })
    .on("error", (err) => {
      try { fs.unlinkSync(path) } catch {}
      if (responseSent) return
      responseSent = true
      console.error("CSV error:", err)
      res.status(500).json({ success: false, message: err.message })
    })
})

app.get("/api/scripts", (req, res) => {
  res.json({
    success: true,
    scripts: callScripts.filter(script => script.isActive)
  });
});

// --- 1. CREATE NEW SCRIPT ---
app.post("/api/scripts", (req, res) => {
  const { name, content, category } = req.body;
  
  if (!name || !content) {
    return res.status(400).json({ success: false, message: "Name and content are required" });
  }

  const newScript = {
    id: uuidv4(), // Use the uuidv4 dependency
    name,
    content,
    category: category || 'general',
    isActive: true,
    createdAt: new Date()
  };

  callScripts.push(newScript);
  console.log(`📝 New script created: ${newScript.name}`);
  
  res.status(201).json({ 
    success: true, 
    message: "Script created successfully",
    script: newScript 
  });
});

// --- 2. UPDATE EXISTING SCRIPT ---
app.put("/api/scripts/:id", (req, res) => {
    const { id } = req.params;
    const { name, content, category } = req.body;
    
    const index = callScripts.findIndex(s => s.id === id);
    
    if (index === -1) {
        return res.status(404).json({ success: false, message: "Script not found" });
    }

    if (!name || !content) {
        return res.status(400).json({ success: false, message: "Name and content are required" });
    }

    callScripts[index] = {
        ...callScripts[index],
        name,
        content,
        category: category || callScripts[index].category,
        updatedAt: new Date()
    };
    
    console.log(`✏️ Script updated: ${name} (ID: ${id})`);
    res.json({ 
        success: true, 
        message: "Script updated successfully", 
        script: callScripts[index] 
    });
});

// --- 3. DELETE SCRIPT ---
app.delete("/api/scripts/:id", (req, res) => {
    const { id } = req.params;
    const initialLength = callScripts.length;
    
    // Remove the script from the in-memory array
    callScripts = callScripts.filter(s => s.id !== id);
    
    if (callScripts.length === initialLength) {
        return res.status(404).json({ success: false, message: "Script not found" });
    }

    console.log(`🗑️ Script deleted: ID ${id}`);
    res.json({ success: true, message: "Script deleted successfully" });
});

app.get("/amd-ncco", (req, res) => {
  res.json([
    {
      action: "connect",
      from: callerId,
      endpoint: [{ type: "phone", number: forwardTo }],
      machineDetection: "continue",
      eventUrl: [`${PUBLIC_WEBHOOK_URL}/amd-status`]  // ← Must be correct
    }
  ]);
});
// dialer.js - Voicemail Message Endpoints

// --- VOICEMAIL CONFIGURATION & DATA (Ensure this is global) ---
// (Define voicemailMessages array and TTS_VOICES array globally above the routes)



// Update or Create Voicemail Message
// -------------------------------------------
//  VOICEMAIL MESSAGES API
// -------------------------------------------

// GET all voicemail messages
app.get("/api/voicemail-messages", (req, res) => {
  res.json({ 
    success: true, 
    messages: voicemailMessages, 
    activeId: activeVoicemailId,
    voices: TTS_VOICES 
  });
});

// CREATE or UPDATE a voicemail message
app.post("/api/voicemail-messages", (req, res) => {
  const { id, name, content, voiceId } = req.body;
  
  if (!name || !content || !voiceId) {
    return res.status(400).json({ 
      success: false, 
      message: "Name, content, and voice are required." 
    });
  }

  const index = voicemailMessages.findIndex(m => m.id === id);

  if (index !== -1) {
    // Update existing
    voicemailMessages[index] = { 
      ...voicemailMessages[index], 
      name, 
      content, 
      voiceId 
    };
    console.log(`🔊 Voicemail updated: ${name}`);
    return res.json({ 
      success: true, 
      message: "Voicemail updated.", 
      message: voicemailMessages[index] 
    });
  } else {
    // Create new
    const newMsg = { 
      id: uuidv4(), 
      name, 
      content, 
      voiceId, 
      isActive: true, 
      createdAt: new Date() 
    };
    voicemailMessages.push(newMsg);
    console.log(`✅ New voicemail created: ${name}`);
    return res.status(201).json({ 
      success: true, 
      message: "Voicemail created.", 
      message: newMsg 
    });
  }
});

app.post("/api/calls/:uuid/notes", (req, res) => {
  const { uuid } = req.params;
  const { content, scriptUsed, outcome, followUpRequired } = req.body;

  const call = allCalls.find((c) => c.uuid === uuid);
  if (!call) {
    return res.status(404).json({ success: false, message: "Call not found" });
  }

  call.notes = content || "";
  if (outcome) call.outcome = outcome;
  if (typeof followUpRequired === "boolean") {
    call.followUpRequired = followUpRequired;
  }
  if (scriptUsed) {
    call.scriptUsed = scriptUsed;
  }
  call.updatedAt = new Date();

  // Optional: also store in a separate notes log
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

// ------------------------------------------
console.log("\n🚀 Registered Routes:");
app._router.stack.forEach((r) => {
  if (r.route && r.route.path) {
    const methods = Object.keys(r.route.methods).map(m => m.toUpperCase()).join(", ");
    console.log(`  ${methods} /api${r.route.path}`);
  }
});

// -------------------------------------------
//  START
// -------------------------------------------
const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
  console.log(`\n🚀 Vynce on port ${PORT}`)
  console.log(`✅ Ready\n`)
})
console.log("\n🚀 Registered API Routes:");
app._router.stack
  .filter(r => r.route) // Only routes
  .forEach(r => {
    const methods = Object.keys(r.route.methods).map(m => m.toUpperCase()).join(", ");
    console.log(`  ${methods} http://localhost:3001${r.route.path}`);
  });
