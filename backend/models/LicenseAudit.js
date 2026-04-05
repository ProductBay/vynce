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
        "LICENSE_ENABLED",
        "LICENSE_DISABLED",
        "LICENSE_UPDATED",
        "LICENSE_EXPIRED",
        "LICENSE_REFRESHED",
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
