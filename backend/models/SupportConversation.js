import mongoose from "mongoose";

const SupportConversationSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    subject: {
      type: String,
      default: "",
      trim: true,
    },
    category: {
      type: String,
      default: "general",
      trim: true,
    },
    priority: {
      type: String,
      default: "normal",
      trim: true,
    },
    status: {
      type: String,
      enum: ["open", "pending_ai", "waiting_human", "resolved", "closed"],
      default: "open",
      index: true,
    },
    source: {
      type: String,
      enum: ["web", "provider_webhook", "internal"],
      default: "web",
    },
    provider: {
      type: String,
      default: "",
      trim: true,
    },
    externalThreadId: {
      type: String,
      default: "",
      index: true,
    },
    customer: {
      name: { type: String, default: "", trim: true },
      email: { type: String, default: "", trim: true },
      phone: { type: String, default: "", trim: true },
    },
    aiHandoff: {
      requested: { type: Boolean, default: false },
      requestedAt: { type: Date, default: null },
      requestedBy: { type: String, default: "", trim: true },
      reason: { type: String, default: "", trim: true },
      summary: { type: String, default: "", trim: true },
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.models.SupportConversation ||
  mongoose.model("SupportConversation", SupportConversationSchema);
