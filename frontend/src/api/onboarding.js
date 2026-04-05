export async function fetchOnboardingStatus(authFetch) {
  const res = await authFetch("/api/onboarding/status", {
    cache: "no-store",
  });

  const json = await res.json();

  if (!json.success) {
    throw new Error(json.message || "Failed to load onboarding status");
  }

  return json.data || {
    steps: json.steps || {},
    review: json.review || { status: "draft" },
    canGoLive: !!json.canGoLive,
  };
}

export async function saveOnboardingSteps(authFetch, steps) {
  const res = await authFetch("/api/onboarding/steps", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ steps }),
  });

  const json = await res.json();

  if (!res.ok || !json.success) {
    throw new Error(json.message || "Failed to save onboarding progress");
  }

  return json.data;
}

export async function submitOnboardingForReview(authFetch) {
  const res = await authFetch("/api/onboarding/submit", {
    method: "POST",
  });

  const json = await res.json();

  if (!res.ok || !json.success) {
    throw new Error(json.message || "Failed to submit onboarding for review");
  }

  return json.data;
}
