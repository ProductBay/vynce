const crypto = require("crypto");
const os = require("os");

function randomInstallId() {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return [4, 2, 2, 2, 6]
    .map((size) => crypto.randomBytes(size).toString("hex"))
    .join("-");
}

function deriveDeviceFingerprintInput(identity) {
  const source = [
    identity.deviceName,
    os.platform(),
    os.arch(),
    os.hostname(),
    String(os.cpus()?.length || 0),
    String(os.totalmem() || 0),
  ].join("|");

  return crypto.createHash("sha256").update(source).digest("hex");
}

function defaultDeviceName() {
  return os.hostname() || "Vynce Device";
}

function ensureInstallIdentity(existingState) {
  const next = { ...(existingState || {}) };

  if (!next.installId) {
    next.installId = randomInstallId();
  }

  if (!next.deviceName) {
    next.deviceName = defaultDeviceName();
  }

  if (!next.deviceFingerprintInput) {
    next.deviceFingerprintInput = deriveDeviceFingerprintInput(next);
  }

  return next;
}

module.exports = {
  ensureInstallIdentity,
  deriveDeviceFingerprintInput,
};
