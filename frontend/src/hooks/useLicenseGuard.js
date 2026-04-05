import { useEffect, useState } from "react";
import { useAuth } from "../components/AuthContext";

function getOnboardingReason(calling = {}) {
  if (calling.requiresApproval && calling.testCallAvailable) {
    return "Onboarding is pending approval. You can place one test call, but bulk/live calling stays locked until an admin approves the tenant.";
  }

  if (calling.requiresApproval && !calling.testCallAvailable) {
    return "Onboarding is pending approval. Your test call is already used, so further calling is blocked until an admin approves the tenant.";
  }

  return null;
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
        reason: "Not authenticated.",
      });
      return;
    }

    let mounted = true;

    const checkLicense = async () => {
      try {
        const res = await authFetch("/api/license/status");

        if (!res || !res.ok) {
          throw new Error(`License check failed (${res?.status})`);
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
            reason: "Commercial access is blocked for this tenant. Contact support.",
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
          reason,
        });
      } catch (err) {
        console.error("[LicenseGuard]", err);
        if (!mounted) return;

        setState({
          loading: false,
          canCall: false,
          canSingleCall: false,
          canBulkCall: false,
          license: null,
          onboarding: null,
          calling: null,
          mode: null,
          reason: "Unable to verify license. Please try again later.",
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
