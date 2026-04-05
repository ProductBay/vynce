import mongoose from "mongoose";

const SettingsSchema = new mongoose.Schema(
  {
    singleton: {
      type: Boolean,
      default: true,
      unique: true,
    },
    callerId: String,
    vonageApplicationId: String,
    timeZone: String,
    forwardTo: String,
    publicWebhookUrl: String,
    bulkDelayMs: {
      type: Number,
      default: 1500,
    },
    enableVoicemailDrop: {
      type: Boolean,
      default: true,
    },
    activeVoicemailId: {
      type: String,
      default: "",
    },
  },
  { versionKey: false }
);

export default mongoose.model("Settings", SettingsSchema);
