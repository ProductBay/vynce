// backend/routes/settings.js
const express = require("express");
const router = express.Router();
const User = require("../models/User");
const authMiddleware = require("../middleware/auth"); // whatever you use

// GET /api/settings  -> current user's settings
router.get("/", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id; // depends on your auth middleware
    const user = await User.findById(userId).select("callerId timeZone email");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({
      success: true,
      data: {
        callerId: user.callerId || "",
        timeZone: user.timeZone || "America/Jamaica",
      },
    });
  } catch (err) {
    console.error("GET /api/settings error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PUT /api/settings  -> update callerId & timeZone
router.put("/", authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const { callerId, timeZone } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    user.callerId = (callerId || "").trim();
    user.timeZone = timeZone || user.timeZone;

    await user.save();

    res.json({
      success: true,
      data: {
        callerId: user.callerId,
        timeZone: user.timeZone,
      },
    });
  } catch (err) {
    console.error("PUT /api/settings error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;