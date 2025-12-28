// backend/models/User.js
const mongoose = require("mongoose");

const refreshTokenSchema = new mongoose.Schema(
  {
    tokenHash: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
    userAgent: {
      type: String,
      default: "",
    },
    ip: {
      type: String,
      default: "",
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    // =========================
    // IDENTITY
    // =========================
    firstName: {
      type: String,
      required: true,
      trim: true,
    },

    lastName: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    // =========================
    // AUTH
    // =========================
    passwordHash: {
      type: String,
      required: true,
      select: false, // 🔐 never return hash by default
    },

    // =========================
    // ROLE / ACCESS
    // =========================
    role: {
      type: String,
      enum: ["customer", "admin", "superadmin"],
      default: "customer",
      index: true,
    },

    isSuperAdmin: {
      type: Boolean,
      default: false,
    },

    // =========================
    // DIALER SETTINGS
    // =========================
    callerId: {
      type: String,
      default: "",
      trim: true,
    },

    timeZone: {
      type: String,
      default: "America/Jamaica",
    },

    // =========================
    // SAAS / SUBSCRIPTION
    // =========================
    subscription: {
      plan: {
        type: String,
        enum: ["starter", "professional", "enterprise"],
        default: "professional",
      },
      maxCalls: {
        type: Number,
        default: 5000,
      },
      active: {
        type: Boolean,
        default: true,
      },
      expiresAt: {
        type: Date,
        default: null,
      },
    },

    // =========================
    // REFRESH TOKENS (ROTATION)
    // =========================
    refreshTokens: [refreshTokenSchema],

    // =========================
    // STATUS / AUDIT
    // =========================
    lastLoginAt: {
      type: Date,
      default: null,
    },

    lastLoginIp: {
      type: String,
      default: "",
    },

    isDisabled: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true, // createdAt / updatedAt
  }
);

// =========================
// INDEXES
// =========================
userSchema.index({ email: 1 });
userSchema.index({ "refreshTokens.expiresAt": 1 });

// =========================
// INSTANCE HELPERS
// =========================
userSchema.methods.canMakeCalls = function () {
  return (
    this.subscription?.active === true &&
    this.subscription?.maxCalls > 0 &&
    !this.isDisabled
  );
};

userSchema.methods.isAdmin = function () {
  return this.role === "admin" || this.role === "superadmin";
};

userSchema.methods.isSuper = function () {
  return this.role === "superadmin" || this.isSuperAdmin === true;
};

// =========================
// CLEANUP EXPIRED TOKENS
// =========================
userSchema.methods.pruneExpiredRefreshTokens = function () {
  const now = new Date();
  this.refreshTokens = this.refreshTokens.filter(
    (t) => t.expiresAt > now
  );
};

module.exports = mongoose.model("User", userSchema);
