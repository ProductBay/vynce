// backend/models/OnboardingStatus.js
import mongoose from "mongoose";

const OnboardingStepsSchema = new mongoose.Schema(
  {
    companyInfo: { type: Boolean, default: false },
    vonageConnected: { type: Boolean, default: false },
    agentAdded: { type: Boolean, default: false },
    scriptUploaded: { type: Boolean, default: false },
    testCallCompleted: { type: Boolean, default: false },
    billingSetup: { type: Boolean, default: false },
    settingsConfigured: { type: Boolean, default: false },
    complianceAccepted: { type: Boolean, default: false },
  },
  { _id: false }
);

const OnboardingStatusSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
      unique: true,
    },

    ownerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
      default: null,
    },

    // Legacy alias kept for older code paths while we finish migrating.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
      default: null,
    },

    steps: {
      type: OnboardingStepsSchema,
      default: () => ({}),
    },

    submittedForReviewAt: {
      type: Date,
      default: null,
    },

    lastSubmittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model(
  "OnboardingStatus",
  OnboardingStatusSchema
);
