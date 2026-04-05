import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { controlPlaneClient } from "../services/controlPlaneClient.js";
import {
  buildTenantAccessState,
  fetchTenantCommercialStatus,
  issueTenantLicenseKey,
  syncTenantActivationState,
  syncTenantLicenseState,
  syncTenantSeatEntitlement,
} from "../services/controlPlaneSync.js";
import {
  getLicenseSourceMode,
  shouldStartLegacyLicenseManager,
} from "../services/licenseSource.js";

function withMockedControlPlane(fn) {
  return async () => {
    const originalConfigured = controlPlaneClient.isConfigured;
    const originalRequest = controlPlaneClient.request;

    controlPlaneClient.isConfigured = () => true;

    try {
      await fn((handler) => {
        controlPlaneClient.request = handler;
      });
    } finally {
      controlPlaneClient.isConfigured = originalConfigured;
      controlPlaneClient.request = originalRequest;
    }
  };
}

test(
  "issueTenantLicenseKey maps successful control-plane issuance response",
  { concurrency: false },
  withMockedControlPlane(async (setRequest) => {
    setRequest(async (method, path, options = {}) => {
      assert.equal(method, "POST");
      assert.equal(path, "/api/admin/licenses/issue");
      assert.equal(options.body.tenantId, "tenant_issue");
      assert.equal(options.body.plan, "enterprise");

      return {
        success: true,
        data: {
          tenantId: "tenant_issue",
          licenseId: "lic_123",
          licenseKey: "ABCD-EFGH-IJKL-MNOP",
          state: {
            commercialStatus: "active",
          },
        },
      };
    });

    const result = await issueTenantLicenseKey("tenant_issue", {
      plan: "enterprise",
      maxActivations: 5,
      includedUsers: 10,
      extraSeats: 2,
      performedBy: "ops@vynce.com",
      reason: "contract_start",
    });

    assert.equal(result.success, true);
    assert.equal(result.tenantId, "tenant_issue");
    assert.equal(result.licenseId, "lic_123");
    assert.equal(result.licenseKey, "ABCD-EFGH-IJKL-MNOP");
  })
);

test(
  "issueTenantLicenseKey returns structured error metadata from control plane",
  { concurrency: false },
  withMockedControlPlane(async (setRequest) => {
    setRequest(async () => {
      const err = new Error("forbidden");
      err.statusCode = 403;
      err.code = "CONTROL_PLANE_HTTP_ERROR";
      throw err;
    });

    const result = await issueTenantLicenseKey("tenant_issue", {
      plan: "enterprise",
    });

    assert.equal(result.success, false);
    assert.equal(result.statusCode, 403);
    assert.equal(result.code, "CONTROL_PLANE_HTTP_ERROR");
  })
);

test(
  "admin license issuance route is explicitly guarded by adminOnly",
  { concurrency: false },
  async () => {
    const source = await readFile(new URL("../dialer.js", import.meta.url), "utf8");
    assert.equal(
      source.includes('app.post("/api/admin/license/issue", authMiddleware, adminOnly'),
      true,
      "Expected /api/admin/license/issue to be protected by authMiddleware + adminOnly"
    );
  }
);

test(
  "syncTenantSeatEntitlement calls only contract seat endpoint",
  { concurrency: false },
  withMockedControlPlane(async (setRequest) => {
    const calls = [];

    setRequest(async (method, path) => {
      calls.push({ method, path });
      return { success: true, data: {} };
    });

    const result = await syncTenantSeatEntitlement("tenant_a", { extraSeats: 2 });

    assert.equal(result.success, true);
    assert.deepEqual(calls, [{ method: "POST", path: "/api/admin/seats/grant" }]);
  })
);

test(
  "syncTenantActivationState uses activation endpoint when activationId is present",
  { concurrency: false },
  withMockedControlPlane(async (setRequest) => {
    const calls = [];

    setRequest(async (method, path, options = {}) => {
      calls.push({ method, path, body: options.body || null });
      return { success: true, data: {} };
    });

    const result = await syncTenantActivationState("tenant_a", {
      action: "revoke",
      activationId: "act_123",
      installId: "install-1",
      deviceFingerprint: "fp-1",
    });

    assert.equal(result.success, true);
    assert.equal(calls[0].path, "/api/admin/activations/revoke");
    assert.equal(calls[0].body.activationId, "act_123");
  })
);

test(
  "syncTenantActivationState falls back to tenant-level reset when activationId missing",
  { concurrency: false },
  withMockedControlPlane(async (setRequest) => {
    const calls = [];

    setRequest(async (method, path, options = {}) => {
      calls.push({ method, path, body: options.body || null });
      return { success: true, data: {} };
    });

    const result = await syncTenantActivationState("tenant_a", {
      action: "reset",
      installId: "install-1",
      deviceFingerprint: "fp-1",
    });

    assert.equal(result.success, true);
    assert.equal(calls[0].path, "/api/admin/licenses/reset");
    assert.equal(calls[0].body.tenantId, "tenant_a");
  })
);

test(
  "syncTenantActivationState falls back to tenant-level revoke when activationId missing",
  { concurrency: false },
  withMockedControlPlane(async (setRequest) => {
    const calls = [];

    setRequest(async (method, path, options = {}) => {
      calls.push({ method, path, body: options.body || null });
      return { success: true, data: {} };
    });

    const result = await syncTenantActivationState("tenant_a", {
      action: "revoke",
      installId: "install-1",
      deviceFingerprint: "fp-1",
    });

    assert.equal(result.success, true);
    assert.equal(result.action, "tenant_revoke_fallback");
    assert.equal(calls[0].path, "/api/admin/licenses/revoke");
    assert.equal(calls[0].body.tenantId, "tenant_a");
  })
);

test(
  "syncTenantLicenseState returns no-op when already active",
  { concurrency: false },
  withMockedControlPlane(async (setRequest) => {
    const calls = [];

    setRequest(async (method, path) => {
      calls.push({ method, path });
      if (method === "GET") {
        return {
          success: true,
          data: {
            tenantId: "tenant_a",
            licenseActive: true,
            commercialStatus: "active",
            activationValid: true,
          },
        };
      }
      throw new Error("Should not call mutation when already active");
    });

    const result = await syncTenantLicenseState("tenant_a", { isEnabled: true });

    assert.equal(result.success, true);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "already_active");
    assert.equal(calls.length, 1);
  })
);

test(
  "syncTenantLicenseState disable is no-op when tenant license is missing",
  { concurrency: false },
  withMockedControlPlane(async (setRequest) => {
    const calls = [];

    setRequest(async (method, path) => {
      calls.push({ method, path });
      if (method === "GET" && path.startsWith("/api/admin/tenant-license")) {
        const notFound = new Error("not found");
        notFound.statusCode = 404;
        throw notFound;
      }
      throw new Error("Mutation should not be called when tenant license is missing");
    });

    const result = await syncTenantLicenseState("tenant_a", { isEnabled: false });

    assert.equal(result.success, true);
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "missing_license");
    assert.equal(calls.length, 1);
  })
);

test(
  "syncTenantLicenseState uses only contract endpoints for enable flow",
  { concurrency: false },
  withMockedControlPlane(async (setRequest) => {
    const calls = [];
    const allowed = new Set([
      "/api/admin/tenant-license",
      "/api/admin/licenses/issue",
      "/api/admin/licenses/revoke",
      "/api/admin/licenses/reset",
      "/api/admin/activations/revoke",
      "/api/admin/activations/reset",
      "/api/admin/seats/grant",
    ]);

    setRequest(async (method, path) => {
      calls.push({ method, path });
      if (method === "GET") {
        const notFound = new Error("not found");
        notFound.statusCode = 404;
        throw notFound;
      }

      return { success: true, data: {} };
    });

    const result = await syncTenantLicenseState("tenant_a", { isEnabled: true });

    assert.equal(result.success, true);
    assert.equal(result.action, "issue");

    for (const call of calls) {
      const basePath = call.path.split("?")[0];
      assert.equal(allowed.has(basePath), true, `Unexpected endpoint called: ${basePath}`);
    }
  })
);

test("controlPlaneSync contains no non-contract endpoint paths", { concurrency: false }, async () => {
  const source = await readFile(new URL("../services/controlPlaneSync.js", import.meta.url), "utf8");
  const forbiddenPaths = [
    "/api/tenants/",
    "/api/license/sync",
    "/api/license/activation/sync",
    "/api/license/status?tenantId=",
  ];

  for (const forbidden of forbiddenPaths) {
    assert.equal(
      source.includes(forbidden),
      false,
      `Found non-contract endpoint path in controlPlaneSync.js: ${forbidden}`
    );
  }
});

test(
  "fetchTenantCommercialStatus normalizes admin tenant-license response",
  { concurrency: false },
  withMockedControlPlane(async (setRequest) => {
    setRequest(async () => ({
      success: true,
      data: {
        tenantId: "tenant_norm_flat",
        licenseActive: true,
        commercialStatus: "active",
        activationValid: true,
        plan: "professional",
        includedUsers: 3,
        extraSeats: 2,
        maxActivations: 5,
        activeActivations: 4,
        canProvisionUser: true,
      },
    }));

    const commercial = await fetchTenantCommercialStatus("tenant_norm_flat", {
      forceRefresh: true,
    });

    assert.equal(commercial.tenantId, "tenant_norm_flat");
    assert.equal(commercial.licenseActive, true);
    assert.equal(commercial.commercialStatus, "active");
    assert.equal(commercial.canProvisionUser, true);
    assert.equal(commercial.includedUsers, 3);
    assert.equal(commercial.extraSeats, 2);
    assert.equal(commercial.maxActivations, 5);
    assert.equal(commercial.activeActivations, 4);
  })
);

test(
  "fetchTenantCommercialStatus normalizes nested state payload",
  { concurrency: false },
  withMockedControlPlane(async (setRequest) => {
    setRequest(async () => ({
      success: true,
      data: {
        status: "blocked",
        state: {
          tenantId: "tenant_norm_nested",
          licenseActive: false,
          commercialStatus: "revoked",
          plan: "professional",
          seatEntitlement: {
            includedUsers: 1,
            extraSeats: 0,
            canProvisionUser: false,
          },
          activation: {
            activationId: "act_nested_1",
            installId: "install_nested_1",
            status: "revoked",
          },
        },
      },
    }));

    const commercial = await fetchTenantCommercialStatus("tenant_norm_nested", {
      forceRefresh: true,
    });

    assert.equal(commercial.tenantId, "tenant_norm_nested");
    assert.equal(commercial.licenseActive, false);
    assert.equal(commercial.commercialStatus, "revoked");
    assert.equal(commercial.activationValid, false);
    assert.equal(commercial.activationId, "act_nested_1");
    assert.equal(commercial.installId, "install_nested_1");
    assert.equal(commercial.includedUsers, 1);
    assert.equal(commercial.extraSeats, 0);
    assert.equal(commercial.canProvisionUser, false);
  })
);

test(
  "control plane source mode bypasses legacy manager start",
  { concurrency: false },
  async () => {
    assert.equal(getLicenseSourceMode({ LICENSE_SOURCE: "control_plane" }), "control_plane");
    assert.equal(
      shouldStartLegacyLicenseManager({ offlineMode: false, mode: "control_plane" }),
      false
    );
    assert.equal(
      shouldStartLegacyLicenseManager({ offlineMode: false, mode: "legacy_jwt" }),
      true
    );
  }
);

test("blocked commercial state denies access", { concurrency: false }, () => {
  const access = buildTenantAccessState({
    commercial: {
      degraded: false,
      licenseActive: false,
      commercialStatus: "revoked",
      activationValid: false,
      canProvisionUser: false,
    },
    operational: {
      tenantOperationalStatus: "active",
      onboardingApproved: true,
      telephonyVerified: true,
    },
  });

  assert.equal(access.canLogin, false);
  assert.equal(access.canSingleCall, false);
  assert.equal(access.canBulkCall, false);
  assert.equal(access.commercialBlocked, true);
});

test(
  "controlPlaneSync every built request path is in the contract allowlist",
  { concurrency: false },
  async () => {
    // Authoritative control-plane endpoints this app is allowed to call.
    // Any path found in the source that is NOT in this set is a contract violation.
    const ALLOWED_PATHS = new Set([
      "/api/admin/tenant-license",
      "/api/admin/licenses/issue",
      "/api/admin/licenses/revoke",
      "/api/admin/licenses/reset",
      "/api/admin/activations/revoke",
      "/api/admin/activations/reset",
      "/api/admin/seats/grant",
    ]);

    const source = await readFile(
      new URL("../services/controlPlaneSync.js", import.meta.url),
      "utf8"
    );

    // Extract every /api/... string literal from source (single-quote, double-quote,
    // backtick, including template-literal prefix before a ${ interpolation).
    // The regex captures the path up to the first ${ , ?, ", ', or ` terminator.
    const pathPattern = /(?:['"`])(\/?api\/[^'"`$?{}\s]+)/g;
    const found = new Set();
    let match;

    while ((match = pathPattern.exec(source)) !== null) {
      // Strip any trailing query-string fragment left by greedy match
      const clean = match[1].split("?")[0].trimEnd();
      found.add(clean);
    }

    const violations = [...found].filter((p) => !ALLOWED_PATHS.has(p));

    assert.deepEqual(
      violations,
      [],
      `controlPlaneSync.js contains path(s) not in the contract allowlist:\n  ${violations.join("\n  ")}`
    );

    // Also assert that all allowlist entries are actually present (prevents stale allowlist).
    const missing = [...ALLOWED_PATHS].filter((p) => !found.has(p));
    assert.deepEqual(
      missing,
      [],
      `Contract allowlist entry not found in controlPlaneSync.js (stale allowlist?):\n  ${missing.join("\n  ")}`
    );
  }
);
