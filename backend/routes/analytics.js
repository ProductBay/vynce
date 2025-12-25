// backend/routes/analytics.js
const express = require("express");
const router = express.Router();
const Call = require("../models/Call"); // adjust path/model name
const authMiddleware = require("../middleware/auth");

// helper: check if plan has analytics
function hasAnalyticsAccess(plan) {
  if (!plan) return false;
  const normalized = String(plan).toLowerCase();
  return normalized === "growth" || normalized === "white_label" || normalized === "enterprise";
}

// GET /api/analytics/overview
router.get("/overview", authMiddleware, async (req, res) => {
  try {
    const plan = req.user?.subscription?.plan;
    if (!hasAnalyticsAccess(plan)) {
      return res.status(403).json({
        success: false,
        message: "Your current plan does not include analytics.",
      });
    }

    // Time window: last 30 days
    const since = new Date();
    since.setDate(since.getDate() - 30);

    // Fetch calls for this user/company; adjust filter for multi-tenant
    const calls = await Call.find({
      createdAt: { $gte: since },
      // companyId: req.user.companyId, // if you have multi‑tenant
    }).lean();

    const totalCalls = calls.length;

    // Calls per outcome
    const outcomeCounts = {};
    for (const c of calls) {
      const outcome = c.outcome || "unknown";
      outcomeCounts[outcome] = (outcomeCounts[outcome] || 0) + 1;
    }

    // Calls per agent
    const agentCounts = {};
    for (const c of calls) {
      const agent = c.agentName || "Unassigned";
      agentCounts[agent] = (agentCounts[agent] || 0) + 1;
    }

    // Calls per day (last 30 days)
    const callsPerDayMap = {};
    for (const c of calls) {
      const d = new Date(c.createdAt);
      const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
      callsPerDayMap[key] = (callsPerDayMap[key] || 0) + 1;
    }
    const callsPerDay = Object.entries(callsPerDayMap)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, count]) => ({ date, count }));

    // Average duration (if duration seconds stored)
    let totalDuration = 0;
    let durationCount = 0;
    for (const c of calls) {
      if (typeof c.durationSeconds === "number") {
        totalDuration += c.durationSeconds;
        durationCount += 1;
      }
    }
    const avgDurationSeconds =
      durationCount > 0 ? Math.round(totalDuration / durationCount) : 0;

    res.json({
      success: true,
      data: {
        totalCalls,
        outcomeCounts,
        agentCounts,
        callsPerDay,
        avgDurationSeconds,
      },
    });
  } catch (err) {
    console.error("GET /api/analytics/overview error:", err);
    res.status(500).json({
      success: false,
      message: "Server error loading analytics.",
    });
  }
});

module.exports = router;