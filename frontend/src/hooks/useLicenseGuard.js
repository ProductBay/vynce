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

function getOnboardingReason(calling = {}) {
  if (calling.requiresApproval && calling.testCallAvailable) {
    return "Onboarding is pending approval. You can place one test call, but bulk/live calling stays locked until an admin approves the tenant.";
  }

  if (calling.requiresApproval && !calling.testCallAvailable) {
    return "Onboarding is pending approval. Your test call is already used, so further calling is blocked until an admin approves the tenant.";
  }

  return null;
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
        const reason = getOnboardingReason(calling);

        setState({
          loading: false,
          canCall: canSingleCall || canBulkCall,
          canSingleCall,
          canBulkCall,
          license: payload,
          onboarding,
          calling,
          mode,
          code: null,
          status: 200,
          reason,
        });
      } catch (err) {
        console.error("[LicenseGuard]", err);
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
