import mongoose from "mongoose";

const SupportMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SupportConversation",
      required: true,
      index: true,
    },
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    direction: {
      type: String,
      enum: ["inbound", "outbound", "system"],
      default: "inbound",
    },
    authorType: {
      type: String,
      enum: ["customer", "agent", "admin", "ai", "system", "provider"],
      default: "customer",
    },
    authorName: {
      type: String,
      default: "",
      trim: true,
    },
    channel: {
      type: String,
      enum: ["web", "email", "sms", "whatsapp", "internal"],
      default: "web",
    },
    providerMessageId: {
      type: String,
      default: "",
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.models.SupportMessage ||
  mongoose.model("SupportMessage", SupportMessageSchema);
