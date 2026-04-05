// backend/models/Call.js
import mongoose from "mongoose";

// --- SINGLE, CORRECT SCHEMA DEFINITION ---
const CallSchema = new mongoose.Schema(
  {
    // --- Identifiers ---
    uuid: {
      type: String,
      index: true,
      sparse: true, // Allows null/undefined values for queued calls
    },
    tenantId: {
      type: String,
      required: true,
      index: true,
    },

    // --- Call Details ---
    to: {
      type: String,
      required: true,
    },
    number: { // Good practice to have 'number' as well for consistency
      type: String,
      required: true,
    },
    from: {
      type: String,
    },
    direction: {
      type: String,
      default: 'outbound',
    },

    // --- ✅ CORRECTED STATUS FIELD ---
    status: {
      type: String,
      enum: [
        "queued",
        "initiated",
        "ringing",
        "answered",
        "completed",
        "ended",       // CRITICAL: 'ended' is now included
        "failed",
        "busy",
        "timeout",
        "rejected",
        "cancelled",   // Use 'cancelled' (double L) for consistency
        "voicemail",
      ],
      default: "queued",
      required: true,
      index: true,
    },
    
    // --- Call Type ---
    callType: { // Use 'callType' for clarity
      type: String,
      enum: ["single", "bulk", "test"],
      default: "single",
      index: true,
    },

    // --- Agent & Notes ---
    agent: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: "",
    },
    outcome: {
      type: String,
      default: "",
    },

    // --- Timestamps & Duration ---
    answeredAt: Date,
    endedAt: Date,
    duration: String, // Store as "MM:SS" string

    // --- Extra Data ---
    voicemailDetected: {
      type: Boolean,
      default: false,
    },
    voicemailLeft: {
      type: Boolean,
      default: false,
    },
    voicemailLeftAt: Date,
    voicemailMessageId: {
      type: String,
      default: "",
    },
    voicemailVoiceId: {
      type: String,
      default: "",
    },
    endedReason: {
      type: String,
      default: "",
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true, // This automatically adds `createdAt` and `updatedAt`
    versionKey: false,
  }
);

// --- SINGLE, CORRECT EXPORT ---
const Call = mongoose.models.Call || mongoose.model("Call", CallSchema);

export default Call;
