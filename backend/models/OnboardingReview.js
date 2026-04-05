import mongoose from "mongoose";

const OnboardingReviewSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        "draft",
        "pending_review",
        "changes_requested",
        "approved",
        "rejected",
      ],
      default: "draft",
      index: true,
    },

    submittedAt: {
      type: Date,
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    adminNotes: {
      type: String,
      default: "",
      trim: true,
    },

    requiredChanges: {
      type: [String],
      default: [],
    },

    approvedForLiveCalling: {
      type: Boolean,
      default: false,
    },

    approvedForBilling: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("OnboardingReview", OnboardingReviewSchema);
