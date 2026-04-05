const path = require("path");
const fs = require("fs");

function readOptionalEnvFile() {
  const envPath = path.join(process.cwd(), ".env.electron");
  if (!fs.existsSync(envPath)) {
    return;
  }

  try {
    // Optional runtime dependency. If missing, process env still works.
    const dotenv = require("dotenv");
    dotenv.config({ path: envPath });
  } catch (error) {
    console.warn("[electron-config] dotenv not installed; skipping .env.electron file load");
  }
}

function getAppConfig() {
  readOptionalEnvFile();

  const controlPlaneBaseUrl = process.env.CONTROL_PLANE_BASE_URL || "http://127.0.0.1:4000";
  const vynceAppUrl = process.env.VYNCE_APP_URL || "http://127.0.0.1:5174";
  const appEnv = process.env.APP_ENV || process.env.NODE_ENV || "development";
  const heartbeatMsRaw = Number(process.env.CONTROL_PLANE_HEARTBEAT_MS || 60_000);

  return {
    controlPlaneBaseUrl: controlPlaneBaseUrl.replace(/\/$/, ""),
    vynceAppUrl: vynceAppUrl.replace(/\/$/, ""),
    appEnv,
    heartbeatMs: Number.isFinite(heartbeatMsRaw) && heartbeatMsRaw >= 15_000 ? heartbeatMsRaw : 60_000,
  };
}

module.exports = {
  getAppConfig,
};
