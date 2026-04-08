import { useEffect, useState } from "react";
import { useAuth } from "../components/AuthContext";

const bootstrapLicenseChecks = new Map();

function getBootstrapKey(user) {
  return String(user?.tenantId || user?._id || "default").trim() || "default";
}

function fetchBootstrapLicenseStatus(authFetch, user) {
  const bootstrapKey = getBootstrapKey(user);
  const existingRequest = bootstrapLicenseChecks.get(bootstrapKey);

  if (existingRequest) {
    return existingRequest;
  }

  const request = authFetch("/api/license/status").finally(() => {
    bootstrapLicenseChecks.delete(bootstrapKey);
  });

  bootstrapLicenseChecks.set(bootstrapKey, request);
  return request;
}

function getOnboardingReason(payload = {}) {
  const calling = payload?.calling || {};
  const onboarding = payload?.onboarding || {};
  const operational = payload?.operational || {};
  const mode = payload?.mode || {};
  const reviewStatus = String(
    onboarding?.status || calling?.reviewStatus || "draft"
  ).toLowerCase();
  const telephonyVerified = operational?.telephonyVerified === true;
  const onboardingApproved = operational?.onboardingApproved === true;
  const onboardingOverrideActive = operational?.onboardingOverride?.active === true;

  if (mode?.requested === "live" && mode?.effective !== "live" && mode?.reason) {
    return mode.reason;
  }

  if (onboardingOverrideActive && !telephonyVerified) {
    return "Admin override is active, but live calling is still blocked until telephony is verified for this tenant.";
  }

  if (!onboardingApproved) {
    if (reviewStatus === "pending_review") {
      return calling.testCallAvailable
        ? "Onboarding has been submitted and is waiting for admin approval. One test call is still available, but bulk and live calling remain blocked."
        : "Onboarding is waiting for admin approval. The tenant test call has already been used, so further calling stays blocked until approval.";
    }

    if (reviewStatus === "changes_requested") {
      return "Admin requested onboarding changes before live calling can be enabled for this tenant.";
    }

    if (reviewStatus === "rejected") {
      return "Tenant onboarding was rejected. Live calling stays blocked until onboarding is updated and approved.";
    }

    return calling.testCallAvailable
      ? "Tenant onboarding is not submitted yet. One test call is available, but bulk and live calling stay blocked until onboarding is submitted and approved."
      : "Tenant onboarding is incomplete, and the test call has already been used. Further calling stays blocked until onboarding is approved.";
  }

  if (!telephonyVerified) {
    return "Onboarding is approved, but live calling is still blocked until telephony credentials are verified.";
  }

  if (calling.requiresApproval && calling.testCallAvailable) {
    return "One test call is available, but bulk and live calling stay locked until the remaining tenant approval checks are complete.";
  }

  if (calling.requiresApproval && !calling.testCallAvailable) {
    return "Calling is blocked until the remaining tenant approval checks are complete.";
  }

  return null;
}

function shouldLogLicenseGuardError(err) {
  const code = String(err?.code || "").trim().toUpperCase();
  return !["NOT_AUTHENTICATED", "SESSION_EXPIRED"].includes(code) && err?.silent !== true;
}

async function buildLicenseErrorDetails(res) {
  const status = Number(res?.status || 0);
  const fallbackMessage = status
    ? `License check failed (${status})`
    : "Unable to verify license. Please try again later.";

  if (!res) {
    return {
      code: "LICENSE_STATUS_UNAVAILABLE",
      status,
      message: fallbackMessage,
    };
  }

  const contentType = String(res.headers?.get("content-type") || "");
  if (contentType.includes("application/json")) {
    try {
      const payload = await res.json();
      const message =
        payload?.message ||
        payload?.error?.message ||
        payload?.data?.message ||
        fallbackMessage;
      const code =
        payload?.code ||
        payload?.error?.code ||
        payload?.data?.code ||
        "";

      return {
        code,
        status,
        message: code ? `${message} [${code}]` : message,
        payload,
      };
    } catch {
      return {
        code: "",
        status,
        message: fallbackMessage,
      };
    }
  }

  return {
    code: "",
    status,
    message: fallbackMessage,
  };
}

export function useLicenseGuard() {
  const { authFetch, user, loading: authLoading } = useAuth();

  const [state, setState] = useState({
    loading: true,
    canCall: false,
    canSingleCall: false,
    canBulkCall: false,
    license: null,
    onboarding: null,
    calling: null,
    operational: null,
    mode: null,
    code: null,
    status: null,
    reason: null,
  });

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setState({
        loading: false,
        canCall: false,
        canSingleCall: false,
        canBulkCall: false,
        license: null,
        onboarding: null,
        calling: null,
        operational: null,
        mode: null,
        code: "NOT_AUTHENTICATED",
        status: 401,
        reason: "Not authenticated.",
      });
      return;
    }

    let mounted = true;

    const checkLicense = async () => {
      try {
        const res = await fetchBootstrapLicenseStatus(authFetch, user);

        if (!res || !res.ok) {
          const details = await buildLicenseErrorDetails(res);
          const error = new Error(details.message);
          error.code = details.code;
          error.status = details.status;
          error.payload = details.payload;
          throw error;
        }

        const contentType = res.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
          throw new Error("License API did not return JSON");
        }

        const data = await res.json();
        if (!mounted) return;

        const payload = data?.data || data || {};
        const commercial = payload?.commercial || null;
        const effectiveAccess = payload?.effectiveAccess || {};
        const calling = payload?.calling || {};
        const onboarding = payload?.onboarding || null;
        const operational = payload?.operational || null;
        const mode = payload?.mode || null;

        if (commercial?.degraded) {
          setState({
            loading: false,
            canCall: false,
            canSingleCall: false,
            canBulkCall: false,
            license: payload,
            onboarding,
            calling,
            operational,
            mode,
            code: "CONTROL_PLANE_UNAVAILABLE",
            status: 503,
            reason:
              commercial?.degradedReason ||
              "Licensing service is temporarily unavailable. Please contact support.",
          });
          return;
        }

        if (!effectiveAccess?.canLogin) {
          setState({
            loading: false,
            canCall: false,
            canSingleCall: false,
            canBulkCall: false,
            license: payload,
            onboarding,
            calling,
            operational,
            mode,
            code: "COMMERCIAL_ACCESS_BLOCKED",
            status: 403,
            reason:
              payload?.commercial?.blockedReason ||
              "Commercial access is blocked for this tenant. Contact support.",
          });
          return;
        }

        const canSingleCall = Boolean(
          effectiveAccess?.canSingleCall ?? calling?.canSingleCall ?? true
        );
        const canBulkCall = Boolean(
          effectiveAccess?.canBulkCall ?? calling?.canBulkCall ?? true
        );
        const reason = getOnboardingReason(payload);

        setState({
          loading: false,
          canCall: canSingleCall || canBulkCall,
          canSingleCall,
          canBulkCall,
          license: payload,
          onboarding,
          calling,
          operational,
          mode,
          code: null,
          status: 200,
          reason,
        });
      } catch (err) {
        if (shouldLogLicenseGuardError(err)) {
          console.error("[LicenseGuard]", err);
        }
        if (!mounted) return;

        const errorCode = String(err?.code || "").trim();
        const errorStatus = Number.isFinite(Number(err?.status)) ? Number(err.status) : null;
        const errorMessage =
          String(err?.message || "").trim() ||
          "Unable to verify license. Please try again later.";

        setState({
          loading: false,
          canCall: false,
          canSingleCall: false,
          canBulkCall: false,
          license: null,
          onboarding: null,
          calling: null,
          operational: null,
          mode: null,
          code: errorCode || "LICENSE_STATUS_CHECK_FAILED",
          status: errorStatus,
          reason: errorCode ? `${errorMessage}` : errorMessage,
        });
      }
    };

    checkLicense();

    return () => {
      mounted = false;
    };
  }, [authFetch, authLoading, user]);

  return state;
}
