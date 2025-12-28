// backend/routes/settings.js
const express = require("express");
const router = express.Router();
const User = require("../models/User");

// TEMP: no auth until backend is stable
router.get("/", async (req, res) => {
  try {
    // TEMP user selection (until auth restored)
    const user = await User.findOne().select("callerId timeZone email");
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

router.put("/", async (req, res) => {
  try {
    const { callerId, timeZone } = req.body;
    const user = await User.findOne();

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
    