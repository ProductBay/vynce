function createControlPlaneService(config) {
  const baseUrl = config.controlPlaneBaseUrl;

  async function request(method, endpoint, body, token) {
    const url = `${baseUrl}${endpoint}`;
    const headers = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      return {
        ok: false,
        statusCode: 0,
        errorCode: "control_plane_unavailable",
        message: "Control plane is unavailable",
      };
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok || !payload || payload.success === false) {
      const message = payload?.error?.message || `Control plane request failed (${response.status})`;
      return {
        ok: false,
        statusCode: response.status,
        errorCode: mapStatusToErrorCode(response.status, message),
        message,
      };
    }

    return {
      ok: true,
      statusCode: response.status,
      data: payload.data || {},
    };
  }

  return {
    activate: (input) => request("POST", "/api/license/activate", input),
    restore: (input) => request("POST", "/api/license/restore", input),
    heartbeat: (input) => {
      const activationToken = input?.activationToken || null;
      return request(
        "POST",
        "/api/license/heartbeat",
        {
          activationToken,
          installId: input?.installId || null,
          deviceFingerprint: input?.deviceFingerprint || null,
        },
        activationToken
      );
    },
    status: (activationToken) => request("GET", "/api/license/status", undefined, activationToken),
    deactivate: (input) => {
      const activationToken = input?.activationToken || null;
      return request(
        "POST",
        "/api/license/deactivate",
        {
          activationToken,
          installId: input?.installId || null,
          deviceFingerprint: input?.deviceFingerprint || null,
        },
        activationToken
      );
    },
  };
}

function mapStatusToErrorCode(statusCode, message) {
  if (statusCode === 0) {
    return "control_plane_unavailable";
  }

  if (statusCode === 404 || /invalid license key/i.test(message || "")) {
    return "invalid_license_key";
  }

  if (statusCode === 409 || /activation limit/i.test(message || "")) {
    return "activation_limit_reached";
  }

  if (/revoked/i.test(message || "")) {
    return "activation_revoked";
  }

  if (/suspend/i.test(message || "")) {
    return "tenant_commercially_suspended";
  }

  if (/restore/i.test(message || "")) {
    return "restore_failed";
  }

  return "control_plane_error";
}

module.exports = {
  createControlPlaneService,
};
