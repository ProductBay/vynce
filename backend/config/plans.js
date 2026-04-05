const plans = {
  starter: {
    key: "starter",
    name: "Starter",
    billing: {
      monthlyPrice: 149,
      displayPrice: "$149",
      interval: "/month",
      unlimitedCalls: true,
      includedActiveUsers: 1,
      additionalActiveUserPrice: 0,
      publicSignup: false,
      legacy: true,
    },
    limits: {
      maxAgents: 1,
      maxConcurrentCalls: Infinity,
      monthlyCallAttempts: Infinity,
      maxVonageNumbers: 1,
    },
    features: {
      bulkDialing: true,
      voicemailDetection: true,
      callRecording: true,
      analytics: "basic",
    },
  },

  professional: {
    key: "professional",
    name: "Professional",
    billing: {
      monthlyPrice: 199,
      displayPrice: "$199",
      interval: "/month",
      unlimitedCalls: true,
      includedActiveUsers: 1,
      additionalActiveUserPrice: 250,
      publicSignup: true,
    },
    limits: {
      maxAgents: 1,
      maxConcurrentCalls: Infinity,
      monthlyCallAttempts: Infinity,
      maxVonageNumbers: Infinity,
    },
    features: {
      bulkDialing: true,
      voicemailDetection: true,
      callRecording: true,
      analytics: "advanced",
    },
  },

  team: {
    key: "team",
    name: "Team",
    billing: {
      monthlyPrice: 599,
      displayPrice: "$599",
      interval: "/month",
      unlimitedCalls: true,
      includedActiveUsers: 5,
      additionalActiveUserPrice: 0,
      publicSignup: true,
    },
    limits: {
      maxAgents: 5,
      maxConcurrentCalls: Infinity,
      monthlyCallAttempts: Infinity,
      maxVonageNumbers: Infinity,
    },
    features: {
      bulkDialing: true,
      voicemailDetection: true,
      callRecording: true,
      analytics: "advanced",
    },
  },

  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    billing: {
      monthlyPrice: 0,
      displayPrice: "Custom",
      interval: "",
      unlimitedCalls: true,
      includedActiveUsers: Infinity,
      additionalActiveUserPrice: 0,
      publicSignup: true,
      customPricing: true,
    },
    limits: {
      maxAgents: Infinity,
      maxConcurrentCalls: Infinity,
      monthlyCallAttempts: Infinity,
      maxVonageNumbers: Infinity,
    },
    features: {
      bulkDialing: true,
      voicemailDetection: true,
      callRecording: true,
      analytics: "enterprise",
      apiAccess: true,
    },
  },
};

export function normalizePlanKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return plans[normalized] ? normalized : "professional";
}

export function getPlanDefinition(value) {
  const key = normalizePlanKey(value);
  return plans[key];
}

export function getIncludedActiveUsers(value) {
  const plan = getPlanDefinition(value);
  return Number(plan.billing?.includedActiveUsers ?? 1);
}

export function getAdditionalActiveUserPrice(value) {
  const plan = getPlanDefinition(value);
  return Number(plan.billing?.additionalActiveUserPrice ?? 0);
}

export default plans;
