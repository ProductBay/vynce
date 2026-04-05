import mongoose from "mongoose";

const ActivationContextSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    deviceKey: {
      type: String,
      required: true,
      index: true,
    },
    installId: {
      type: String,
      default: "",
    },
    deviceFingerprintHash: {
      type: String,
      default: "",
    },
    activationId: {
      type: String,
      default: "",
    },
    activationTokenEncrypted: {
      type: String,
      default: "",
    },
    tokenIv: {
      type: String,
      default: "",
    },
    tokenTag: {
      type: String,
      default: "",
    },
    lastHeartbeatAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

ActivationContextSchema.index({ tenantId: 1, deviceKey: 1 }, { unique: true });

export default mongoose.models.ActivationContext ||
  mongoose.model("ActivationContext", ActivationContextSchema);
