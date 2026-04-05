import mongoose from "mongoose";

const LicenseSettingsSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    isEnabled: { type: Boolean, default: true },
    suspendReason: { type: String, default: "" },

    plan: {
      type: String,
      enum: ["development", "professional", "enterprise"],
      default: "professional",
    },

    callingMode: {
      type: String,
      enum: ["offline", "live"],
      default: "live",
    },

    limits: {
      calls_per_day: { type: Number, default: 5000 },
      channels: { type: Number, default: 10 },
    },

    client: {
      companyName: { type: String, default: "Unknown" },
      contactEmail: { type: String, default: "" },
      tenantId: { type: String, default: "" },
      licenseId: { type: String, default: "" },
    },

    disabledUntil: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.models.LicenseSettings ||
  mongoose.model("LicenseSettings", LicenseSettingsSchema);
