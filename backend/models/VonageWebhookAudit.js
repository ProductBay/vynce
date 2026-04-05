import mongoose from "mongoose";

const VonageWebhookAuditSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      enum: ["status", "voice"],
      required: true,
      index: true,
    },
    callUuid: {
      type: String,
      default: "",
      index: true,
    },
    conversationUuid: {
      type: String,
      default: "",
    },
    callId: {
      type: String,
      default: "",
      index: true,
    },
    matchedAs: {
      type: String,
      enum: ["unclassified", "human", "machine", "voicemail"],
      default: "unclassified",
      index: true,
    },
    status: {
      type: String,
      default: "",
      index: true,
    },
    subState: {
      type: String,
      default: "",
    },
    answeredBy: {
      type: String,
      default: "",
    },
    machineDetectionResult: {
      type: String,
      default: "",
    },
    detail: {
      type: String,
      default: "",
    },
    reason: {
      type: String,
      default: "",
    },
    request: {
      method: {
        type: String,
        default: "",
      },
      query: {
        type: Object,
        default: {},
      },
      headers: {
        type: Object,
        default: {},
      },
      body: {
        type: Object,
        default: {},
      },
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export default
  mongoose.models.VonageWebhookAudit ||
  mongoose.model("VonageWebhookAudit", VonageWebhookAuditSchema);
