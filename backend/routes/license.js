import express from "express";
import { getLicenseState } from "../license/licenseClient.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// 🔒 Admin-only license status
router.get("/status", authMiddleware, (req, res) => {
  if (req.user.role !== "admin" && req.user.role !== "superadmin") {
    return res.status(403).json({ error: "forbidden" });
  }

  const license = getLicenseState();

  if (!license.payload) {
    return res.json({
      valid: false,
      status: "missing",
    });
  }

  const now = Date.now();
  const expMs = license.payload.exp * 1000;

  res.json({
    valid: license.valid,
    status: license.payload.status,
    plan: license.payload.plan,
    expires_at: expMs,
    expired: now > expMs,
    last_ok_at: license.lastOkAt,
    grace_active: !license.valid && license.lastOkAt,
    limits: license.payload.limits,
    features: license.payload.features,
    fingerprint: license.payload.fingerprint,
  });
});

export default router;
