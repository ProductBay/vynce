export const LICENSE_SOURCE_CONTROL_PLANE = "control_plane";
export const LICENSE_SOURCE_LEGACY_JWT = "legacy_jwt";

export function getLicenseSourceMode(env = process.env) {
  const mode = String(env.LICENSE_SOURCE || LICENSE_SOURCE_CONTROL_PLANE)
    .trim()
    .toLowerCase();

  if (mode === LICENSE_SOURCE_LEGACY_JWT) return LICENSE_SOURCE_LEGACY_JWT;
  return LICENSE_SOURCE_CONTROL_PLANE;
}

export function isControlPlaneSource(mode = getLicenseSourceMode()) {
  return mode === LICENSE_SOURCE_CONTROL_PLANE;
}

export function shouldStartLegacyLicenseManager({
  offlineMode,
  mode = getLicenseSourceMode(),
}) {
  if (offlineMode) return false;
  return mode === LICENSE_SOURCE_LEGACY_JWT;
}
