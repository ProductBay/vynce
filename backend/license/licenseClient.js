import jwt from "jsonwebtoken";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

// -----------------------------
// PATH HELPERS
// -----------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OFFLINE_MODE =
  (process.env.OFFLINE_MODE || "false").toLowerCase() === "true";

function normalizeKey(value) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return "";
  }

  return normalized.replace(/\\n/g, "\n");
}

// -----------------------------
// CONFIG
// -----------------------------
const PUBLIC_KEY_CANDIDATES = [
  String(process.env.LICENSE_PUBLIC_KEY_PATH || "").trim(),
  path.join(__dirname, "../license_public.pem"),
  path.join(__dirname, "../../license_public.pem"),
].filter(Boolean);

let cachedPublicKey = null;

function loadPublicKey() {
  if (cachedPublicKey !== null) {
    return cachedPublicKey;
  }

  const inlinePublicKey = normalizeKey(process.env.LICENSE_PUBLIC_KEY);

  if (inlinePublicKey) {
    cachedPublicKey = inlinePublicKey;
    return cachedPublicKey;
  }

  const publicKeyPath = PUBLIC_KEY_CANDIDATES.find((candidate) => fs.existsSync(candidate));

  if (!publicKeyPath) {
    cachedPublicKey = "";
    return cachedPublicKey;
  }

  cachedPublicKey = fs.readFileSync(publicKeyPath, "utf8");
  return cachedPublicKey;
}

const LICENSE_SERVER = process.env.LICENSE_SERVER_URL;
const HEARTBEAT_INTERVAL_MS = 1000 * 60 * 5; // 5 minutes
const GRACE_PERIOD_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const ISSUER = "vynce-license-server";
const AUDIENCE = "vynce-self-hosted";

// -----------------------------
// LICENSE STATE (IN MEMORY)
// -----------------------------
const licenseState = {
  valid: false,
  payload: null,
  lastOkAt: null,
  token: null,
  activationId: null,
};

// -----------------------------
// LOCAL VERIFICATION
// -----------------------------
function verifyLocal(token) {
  const publicKey = loadPublicKey();

  if (!publicKey) {
    throw new Error(
      `LICENSE_PUBLIC_KEY or LICENSE_PUBLIC_KEY_PATH is required for offline JWT verification. Checked: ${PUBLIC_KEY_CANDIDATES.join(", ")}`
    );
  }

  return jwt.verify(token, publicKey, {
    algorithms: ["RS256"],
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

// -----------------------------
// HEARTBEAT LOGIC
// -----------------------------
async function runHeartbeat() {
  if (OFFLINE_MODE) {
    return;
  }

  if (!LICENSE_SERVER) {
    // Heartbeat disabled, rely on local + grace
    return;
  }

  try {
    const res = await fetch(`${LICENSE_SERVER}/v1/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        license_token: licenseState.token,
        activation_id: licenseState.activationId,
      }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data?.ok === true && typeof data.license_token === "string") {
      const refreshed = verifyLocal(data.license_token);

      licenseState.token = data.license_token;
      licenseState.valid = true;
      licenseState.payload = refreshed;
      licenseState.lastOkAt = Date.now();

      console.log("🔄 License heartbeat refreshed");
    } else {
      throw new Error(data?.error || "heartbeat_rejected");
    }
  } catch (err) {
    const now = Date.now();
    const withinGrace =
      typeof licenseState.lastOkAt === "number" &&
      now - licenseState.lastOkAt < GRACE_PERIOD_MS;

    // Do not invalidate if no license server configured
    if (!LICENSE_SERVER) {
      return;
    }

    licenseState.valid = withinGrace;

    console.warn(
      `⚠️ License heartbeat failed (${err.message}) — ${
        withinGrace ? "grace active" : "license invalid"
      }`
    );
  }
}

// -----------------------------
// LICENSE MANAGER (STARTUP)
// -----------------------------
export function startLicenseManager({ token, activationId }) {
  if (!token || !activationId) {
    console.warn(
      "⚠️ License manager not started — missing token or activationId"
    );
    return;
  }

  if (!loadPublicKey()) {
    console.warn(
      `⚠️ License manager not started — missing LICENSE_PUBLIC_KEY or readable key file. Checked: ${PUBLIC_KEY_CANDIDATES.join(", ")}`
    );
    return;
  }

  licenseState.token = token;
  licenseState.activationId = activationId;

  // -----------------------------
  // LICENSE INITIALIZATION
  // -----------------------------

  // Initial local verification (offline-safe)
  try {
    const decoded = verifyLocal(token);

    licenseState.valid = true;
    licenseState.payload = {
      ...decoded,
      status: "active",
      usage: {
        callsUsed: decoded?.usage?.callsUsed ?? 0,
      },
    };
    licenseState.lastOkAt = Date.now();

    console.log("✅ License verified locally and activated");
  } catch (err) {
    licenseState.valid = false;
    global.currentLicensePayload = null;

    console.warn(
      "⚠️ License verification failed at startup:",
      err.message
    );
    return;
  }

  // Immediate heartbeat
  runHeartbeat();

  // Background heartbeat
  setInterval(runHeartbeat, HEARTBEAT_INTERVAL_MS);
}

// -----------------------------
// STATE ACCESSOR
// -----------------------------
export function getLicenseState() {
  return licenseState;
}
