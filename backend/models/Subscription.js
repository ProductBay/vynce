// backend/models/Subscription.js
import mongoose from "mongoose";

const SubscriptionSchema = new mongoose.Schema({
  tenantId: {
    type: String,
    default: "",
    index: true
  },

  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    unique: true
  },

  plan: {
    type: String,
    enum: ["starter", "professional", "team", "enterprise"],
    default: "professional"
  },

  status: {
    type: String,
    enum: ["active", "past_due", "cancelled"],
    default: "active"
  },

  limits: {
    maxCalls: { type: Number, default: 0 },
    includedActiveUsers: { type: Number, default: 1 },
  },

  billing: {
    unlimitedCalls: { type: Boolean, default: true },
    monthlyPrice: { type: Number, default: 199 },
    additionalAgentSeats: { type: Number, default: 0 },
    additionalActiveUserPrice: { type: Number, default: 0 },
  },

  usage: {
    callsThisMonth: { type: Number, default: 0 },
    concurrentCalls: { type: Number, default: 0 }
  }
}, { timestamps: true });

export default mongoose.model("Subscription", SubscriptionSchema);
