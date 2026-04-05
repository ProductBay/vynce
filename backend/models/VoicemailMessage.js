import mongoose from "mongoose";

const VoicemailMessageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    voiceId: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

const VoicemailMessage =
  mongoose.models.VoicemailMessage ||
  mongoose.model("VoicemailMessage", VoicemailMessageSchema);

export default VoicemailMessage;
