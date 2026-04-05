import mongoose from "mongoose";

const TelephonySettingsSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      index: true,
      default: "",
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
    },

    provider: {
      type: String,
      default: "vonage",
    },

    outboundNumber: String,
    applicationId: String,
    apiKey: String,
    apiSecret: String,
    privateKey: String,

    verified: {
      type: Boolean,
      default: false,
    },

    verification: {
      status: {
        type: String,
        enum: ["unverified", "pending", "verified", "failed"],
        default: "unverified",
      },
      checkedAt: {
        type: Date,
        default: null,
      },
      verifiedAt: {
        type: Date,
        default: null,
      },
      code: {
        type: String,
        default: "",
      },
      message: {
        type: String,
        default: "",
      },
      aiExplanation: {
        type: String,
        default: "",
      },
      suggestedActions: {
        type: [String],
        default: [],
      },
      account: {
        apiKeyMasked: { type: String, default: "" },
        applicationId: { type: String, default: "" },
        outboundNumber: { type: String, default: "" },
        dashboardUrl: { type: String, default: "" },
        balance: { type: String, default: "" },
        currency: { type: String, default: "" },
        label: { type: String, default: "" },
      },
      checks: {
        credentials: { type: Boolean, default: false },
        application: { type: Boolean, default: false },
        numbers: { type: Boolean, default: false },
        preferredNumber: { type: Boolean, default: false },
      },
    },
  },
  { timestamps: true }
);

export default mongoose.model(
  "TelephonySettings",
  TelephonySettingsSchema
);
