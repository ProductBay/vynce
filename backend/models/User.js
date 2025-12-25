// backend/models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  // ...existing fields...
  firstName: String,
  lastName: String,
  email: { type: String, unique: true },
  // etc...

  callerId: {
    type: String,
    default: "",
  },
  timeZone: {
    type: String,
    default: "America/Jamaica", // choose a sensible default
  },
});

module.exports = mongoose.model("User", userSchema);