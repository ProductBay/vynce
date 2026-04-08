// backend/models/LicenseAudit.js
import mongoose from "mongoose";

const LicenseAuditSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },

    action: {
      type: String,
      required: true,
      enum: [
        "TENANT_CREATED",
        "LICENSE_ISSUED",
        "LICENSE_ENABLED",
        "LICENSE_DISABLED",
        "TEMPORARY_DISABLED",
        "AUTO_REENABLED",
        "PLAN_CHANGED",
        "LIMITS_CHANGED",
        "LICENSE_UPDATED",
        "TENANT_SUSPENDED",
        "TENANT_REENABLED",
        "TENANT_TEMP_SUSPENDED",
        "TENANT_ONBOARDING_OVERRIDE_ENABLED",
        "TENANT_ONBOARDING_OVERRIDE_CLEARED",
      ],
    },

    performedBy: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      email: {
        type: String,
        required: true,
      },
      role: {
        type: String,
        required: true,
      },
    },

    target: {
      companyName: { type: String, default: "Unknown" },
      tenantId: { type: String, required: true },
      licenseId: { type: String, required: true },
    },

    before: {
      type: Object,
      default: {},
    },

    after: {
      type: Object,
      default: {},
    },
  },
  { timestamps: true }
);

export default mongoose.models.LicenseAudit ||
  mongoose.model("LicenseAudit", LicenseAuditSchema);
