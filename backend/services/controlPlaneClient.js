import fetch from "node-fetch";

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

export class ControlPlaneError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ControlPlaneError";
    this.statusCode = options.statusCode || 500;
    this.code = options.code || "CONTROL_PLANE_ERROR";
    this.retriable = options.retriable !== false;
    this.meta = options.meta || null;
  }
}

export function getControlPlaneConfig() {
  const adminSecret = String(
    process.env.CONTROL_PLANE_ADMIN_SECRET || process.env.CONTROL_PLANE_API_SECRET || ""
  ).trim();

  return {
    baseUrl: String(process.env.CONTROL_PLANE_BASE_URL || "").trim().replace(/\/$/, ""),
    apiSecret: adminSecret,
    timeoutMs: toPositiveInt(process.env.CONTROL_PLANE_TIMEOUT_MS, 8000),
    appEnv: String(process.env.APP_ENV || process.env.NODE_ENV || "development").trim(),
  };
}

function buildServiceHeaders(config) {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-App-Env": config.appEnv || "development",
  };

  if (config.apiSecret) {
    headers["x-admin-secret"] = config.apiSecret;
  }

  return headers;
}

async function parseJsonSafe(res) {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw: text,
    };
  }
}

export function createControlPlaneClient() {
  const config = getControlPlaneConfig();

  const isConfigured = () => Boolean(config.baseUrl && config.apiSecret);

  function logControlPlaneRequest(entry) {
    const logEntry = {
      event: "control_plane_request",
      ...entry,
    };

    if (entry.outcome === "error") {
      console.warn(JSON.stringify(logEntry));
      return;
    }

    console.info(JSON.stringify(logEntry));
  }

  async function request(method, path, options = {}) {
    if (!isConfigured()) {
      throw new ControlPlaneError("Control plane is not configured", {
        statusCode: 503,
        code: "CONTROL_PLANE_NOT_CONFIGURED",
        retriable: false,
      });
    }

    const timeoutMs = toPositiveInt(options.timeoutMs, config.timeoutMs);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const tenantId = options?.tenantId || options?.body?.tenantId || null;
    const activationId = options?.activationId || options?.body?.activationId || null;
    const endpoint = path.startsWith("/") ? path : `/${path}`;

    try {
      const url = `${config.baseUrl}${endpoint}`;
      const headers = {
        ...buildServiceHeaders(config),
        ...(options.headers || {}),
      };

      const response = await fetch(url, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const payload = await parseJsonSafe(response);

      logControlPlaneRequest({
        method,
        endpoint,
        tenantId,
        activationId,
        statusCode: response.status,
        outcome: response.ok ? "success" : "error",
      });

      if (!response.ok) {
        const envelopeError = payload?.error || null;
        throw new ControlPlaneError(
          envelopeError?.message || payload?.message || payload?.error || `Control plane request failed (${response.status})`,
          {
            statusCode: response.status,
            code: envelopeError?.code || payload?.code || "CONTROL_PLANE_HTTP_ERROR",
            retriable: response.status >= 500,
            meta: payload,
          }
        );
      }

      return payload;
    } catch (err) {
      logControlPlaneRequest({
        method,
        endpoint,
        tenantId,
        activationId,
        statusCode: err?.statusCode || 503,
        outcome: "error",
      });

      if (err?.name === "AbortError") {
        throw new ControlPlaneError("Control plane request timed out", {
          statusCode: 504,
          code: "CONTROL_PLANE_TIMEOUT",
          retriable: true,
        });
      }

      if (err instanceof ControlPlaneError) {
        throw err;
      }

      throw new ControlPlaneError(err?.message || "Control plane request failed", {
        statusCode: 503,
        code: "CONTROL_PLANE_UNAVAILABLE",
        retriable: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    config,
    isConfigured,
    request,
    logControlPlaneRequest,
  };
}

export const controlPlaneClient = createControlPlaneClient();
