const fs = require("fs");
const path = require("path");
const { safeStorage } = require("electron");

const STORE_FILE = "activation-state.bin";

function getStorePath(userDataPath) {
  return path.join(userDataPath, STORE_FILE);
}

function readState(userDataPath) {
  const target = getStorePath(userDataPath);
  if (!fs.existsSync(target)) {
    return {};
  }

  const encrypted = fs.readFileSync(target);

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure storage is unavailable on this system");
  }

  const decryptedText = safeStorage.decryptString(encrypted);
  return JSON.parse(decryptedText);
}

function writeState(userDataPath, state) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure storage is unavailable; refusing to persist activation secrets");
  }

  const target = getStorePath(userDataPath);
  const payload = Buffer.from(JSON.stringify(state), "utf8");
  const encrypted = safeStorage.encryptString(payload.toString("utf8"));

  fs.writeFileSync(target, encrypted);
}

function clearState(userDataPath) {
  const target = getStorePath(userDataPath);
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }
}

module.exports = {
  readState,
  writeState,
  clearState,
};
