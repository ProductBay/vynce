import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

loadDotEnvElectron();

const required = [
  "CONTROL_PLANE_BASE_URL",
  "CONTROL_PLANE_ADMIN_SECRET",
  "E2E_LICENSE_KEY",
  "E2E_ADMIN_EMAIL",
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  fail(`Missing required env vars: ${missing.join(", ")}`);
}

const baseUrl = process.env.CONTROL_PLANE_BASE_URL.replace(/\/+$/, "");
const adminSecret = process.env.CONTROL_PLANE_ADMIN_SECRET;

const identityA = {
  installId: randomUUID(),
  deviceFingerprint: `vynce-e2e-fp-${randomUUID()}`,
  deviceName: process.env.E2E_DEVICE_NAME || "Vynce-E2E-Stage-A",
};

const identityB = {
  installId: randomUUID(),
  deviceFingerprint: `vynce-e2e-fp-${randomUUID()}`,
  deviceName: `${process.env.E2E_DEVICE_NAME || "Vynce-E2E-Stage"}-B`,
};

const activationInputBase = {
  licenseKey: process.env.E2E_LICENSE_KEY,
  companyName: process.env.E2E_COMPANY_NAME || "Vynce Stage Tenant",
  adminFirstName: process.env.E2E_ADMIN_FIRST_NAME || "Stage",
  adminLastName: process.env.E2E_ADMIN_LAST_NAME || "Runner",
  adminEmail: process.env.E2E_ADMIN_EMAIL,
};

const result = {
  runId: randomUUID(),
  steps: [],
};

await runStep("activate-A", async () => {
  const response = await postJson("/api/license/activate", {
    ...activationInputBase,
    ...identityA,
  });

  assertSuccess(response, "activate-A");

  const activationId = response.data?.activationId || response.data?.state?.activation?.activationId;
  const activationToken = response.data?.activationToken;

  if (!activationId || !activationToken) {
    throw new Error("activate-A missing activationId or activationToken");
  }

  return {
    activationId,
    activationToken,
    tenantId: response.data?.state?.tenantId || null,
  };
});

const activationA = getStepData("activate-A");

await runStep("restore-A", async () => {
  const response = await postJson("/api/license/restore", {
    activationId: activationA.activationId,
    installId: identityA.installId,
    deviceFingerprint: identityA.deviceFingerprint,
  });

  assertSuccess(response, "restore-A");
  return summarizeStatus(response);
});

await runStep("heartbeat-A", async () => {
  const response = await postJson(
    "/api/license/heartbeat",
    {
      activationToken: activationA.activationToken,
      installId: identityA.installId,
      deviceFingerprint: identityA.deviceFingerprint,
    },
    activationA.activationToken,
  );

  assertSuccess(response, "heartbeat-A");
  return summarizeStatus(response);
});

await runStep("deactivate-A", async () => {
  const response = await postJson(
    "/api/license/deactivate",
    {
      activationToken: activationA.activationToken,
      installId: identityA.installId,
      deviceFingerprint: identityA.deviceFingerprint,
    },
    activationA.activationToken,
  );

  assertSuccess(response, "deactivate-A");
  return summarizeStatus(response);
});

await runStep("activate-B", async () => {
  const response = await postJson("/api/license/activate", {
    ...activationInputBase,
    ...identityB,
  });

  assertSuccess(response, "activate-B");

  const activationId = response.data?.activationId || response.data?.state?.activation?.activationId;
  const activationToken = response.data?.activationToken;

  if (!activationId || !activationToken) {
    throw new Error("activate-B missing activationId or activationToken");
  }

  return {
    activationId,
    activationToken,
    tenantId: response.data?.state?.tenantId || activationA.tenantId || null,
  };
});

const activationB = getStepData("activate-B");

await runStep("admin-revoke-activation-B", async () => {
  const response = await postJson(
    "/api/admin/activations/revoke",
    {
      activationId: activationB.activationId,
      performedBy: process.env.E2E_PERFORMED_BY || process.env.E2E_ADMIN_EMAIL,
      reason: process.env.E2E_REVOKE_REASON || "staged_e2e_revoke_check",
    },
    null,
    {
      "x-admin-secret": adminSecret,
    },
  );

  assertSuccess(response, "admin-revoke-activation-B");
  return summarizeStatus(response);
});

await runStep("heartbeat-B-after-revoke", async () => {
  const response = await postJson(
    "/api/license/heartbeat",
    {
      activationToken: activationB.activationToken,
      installId: identityB.installId,
      deviceFingerprint: identityB.deviceFingerprint,
    },
    activationB.activationToken,
  );

  assertSuccess(response, "heartbeat-B-after-revoke");

  const status = response.data?.status;
  const commercialStatus = response.data?.state?.commercialStatus;
  const blockedReason = response.data?.state?.blockedReason || null;

  const blocked = status === "blocked" || commercialStatus === "revoked" || commercialStatus === "suspended";
  if (!blocked) {
    throw new Error(
      `Expected blocked heartbeat after revoke, got status=${String(status)} commercialStatus=${String(commercialStatus)}`,
    );
  }

  return {
    status,
    commercialStatus,
    blockedReason,
  };
});

printSummary();
process.exit(0);

function getStepData(name) {
  const step = result.steps.find((item) => item.name === name);
  if (!step || step.outcome !== "passed") {
    fail(`Step ${name} missing or failed`);
  }
  return step.data;
}

async function runStep(name, fn) {
  const startedAt = new Date().toISOString();
  process.stdout.write(`\n[STEP] ${name} ...\n`);
  try {
    const data = await fn();
    const endedAt = new Date().toISOString();
    result.steps.push({ name, outcome: "passed", startedAt, endedAt, data });
    process.stdout.write(`[PASS] ${name}\n`);
  } catch (error) {
    const endedAt = new Date().toISOString();
    result.steps.push({
      name,
      outcome: "failed",
      startedAt,
      endedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    printSummary();
    fail(`Step failed: ${name} :: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function postJson(endpoint, body, bearerToken = null, extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };

  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body || {}),
  });

  return parseResponse(response, endpoint);
}

async function parseResponse(response, endpoint) {
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  return {
    endpoint,
    statusCode: response.status,
    okHttp: response.ok,
    payload,
    success: Boolean(payload?.success),
    data: payload?.data || null,
    errorMessage: payload?.error?.message || null,
  };
}

function assertSuccess(response, stepName) {
  if (!response.okHttp || !response.success) {
    const message = response.errorMessage || `HTTP ${response.statusCode}`;
    throw new Error(`${stepName} request failed at ${response.endpoint}: ${message}`);
  }
}

function summarizeStatus(response) {
  return {
    statusCode: response.statusCode,
    status: response.data?.status || null,
    tenantId: response.data?.state?.tenantId || response.data?.tenantId || null,
    commercialStatus: response.data?.state?.commercialStatus || response.data?.commercialStatus || null,
    blockedReason: response.data?.state?.blockedReason || null,
  };
}

function maskToken(value) {
  if (!value) {
    return null;
  }
  if (value.length <= 10) {
    return `${value.slice(0, 3)}...`;
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function printSummary() {
  process.stdout.write("\n=== STAGED CONTROL PLANE E2E SUMMARY ===\n");
  process.stdout.write(`runId: ${result.runId}\n`);
  for (const step of result.steps) {
    if (step.outcome === "passed") {
      const data = {
        ...step.data,
        activationToken: step.data?.activationToken ? maskToken(step.data.activationToken) : undefined,
      };
      process.stdout.write(`- PASS ${step.name} ${JSON.stringify(data)}\n`);
    } else {
      process.stdout.write(`- FAIL ${step.name} ${step.error}\n`);
    }
  }
}

function fail(message) {
  process.stderr.write(`\n[ERROR] ${message}\n`);
  process.exit(1);
}

function loadDotEnvElectron() {
  const filePath = resolve(process.cwd(), ".env.electron");
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^"|"$/g, "");

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
