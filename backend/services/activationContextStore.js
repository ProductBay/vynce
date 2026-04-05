import crypto from "crypto";
import mongoose from "mongoose";
import ActivationContext from "../models/ActivationContext.js";

function hashString(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function getEncryptionKey() {
  const seed = String(process.env.JWT_SECRET || process.env.CONTROL_PLANE_API_SECRET || "").trim();
  return crypto.createHash("sha256").update(seed).digest();
}

function encryptToken(token) {
  const normalized = String(token || "").trim();
  if (!normalized) return { encrypted: "", iv: "", tag: "" };

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function decryptToken(encrypted, iv, tag) {
  if (!encrypted || !iv || !tag) return "";

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
}

function buildDeviceKey({ installId, deviceFingerprint }) {
  return hashString(`${String(installId || "").trim()}::${String(deviceFingerprint || "").trim()}`);
}

export async function upsertActivationContext({
  tenantId,
  activationId,
  activationToken,
  installId,
  deviceFingerprint,
  lastHeartbeatAt,
}) {
  if (mongoose.connection.readyState !== 1) {
    return { skipped: true, reason: "db_not_connected" };
  }

  const tid = String(tenantId || "").trim();
  if (!tid) return { skipped: true, reason: "missing_tenant" };

  const normalizedInstallId = String(installId || "").trim();
  const normalizedFingerprint = String(deviceFingerprint || "").trim();
  if (!normalizedInstallId && !normalizedFingerprint) {
    return { skipped: true, reason: "missing_device_identity" };
  }

  const deviceKey = buildDeviceKey({
    installId: normalizedInstallId,
    deviceFingerprint: normalizedFingerprint,
  });
  const encryptedToken = encryptToken(activationToken || "");

  await ActivationContext.findOneAndUpdate(
    { tenantId: tid, deviceKey },
    {
      $set: {
        installId: normalizedInstallId,
        deviceFingerprintHash: normalizedFingerprint ? hashString(normalizedFingerprint) : "",
        activationId: String(activationId || "").trim(),
        activationTokenEncrypted: encryptedToken.encrypted,
        tokenIv: encryptedToken.iv,
        tokenTag: encryptedToken.tag,
        lastHeartbeatAt: lastHeartbeatAt ? new Date(lastHeartbeatAt) : null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();

  return { success: true };
}

export async function readActivationContext({ tenantId, installId, deviceFingerprint, deviceKey }) {
  if (mongoose.connection.readyState !== 1) {
    return null;
  }

  const tid = String(tenantId || "").trim();
  if (!tid) return null;

  const normalizedInstallId = String(installId || "").trim();
  const normalizedFingerprint = String(deviceFingerprint || "").trim();
  if (!deviceKey && !normalizedInstallId && !normalizedFingerprint) {
    return null;
  }

  const resolvedDeviceKey = deviceKey || buildDeviceKey({
    installId: normalizedInstallId,
    deviceFingerprint: normalizedFingerprint,
  });

  const doc = await ActivationContext.findOne({ tenantId: tid, deviceKey: resolvedDeviceKey }).lean();
  if (!doc) return null;

  return {
    tenantId: doc.tenantId,
    installId: doc.installId || "",
    activationId: doc.activationId || "",
    activationToken: decryptToken(doc.activationTokenEncrypted, doc.tokenIv, doc.tokenTag),
    lastHeartbeatAt: doc.lastHeartbeatAt || null,
  };
}

export async function touchActivationHeartbeat({ tenantId, activationId, lastHeartbeatAt }) {
  if (mongoose.connection.readyState !== 1) {
    return { skipped: true, reason: "db_not_connected" };
  }

  const tid = String(tenantId || "").trim();
  const aid = String(activationId || "").trim();
  if (!tid || !aid) return { skipped: true, reason: "missing_identity" };

  await ActivationContext.updateMany(
    { tenantId: tid, activationId: aid },
    { $set: { lastHeartbeatAt: lastHeartbeatAt ? new Date(lastHeartbeatAt) : new Date() } }
  );

  return { success: true };
}
