const REFRESH_SKEW_MS = 60 * 1000;
const DEFAULT_EXPIRES_IN_SECONDS = 900;
const WORKFLOW_JWT_ENDPOINT =
  import.meta.env.VITE_WORKFLOW_JWT_URL || "/api/shared/workflow_jwt_issue.php";

let cachedToken = null;
let expiresAtMs = 0;
let pendingRequest = null;

function isTokenUsable() {
  return Boolean(cachedToken) && Date.now() + REFRESH_SKEW_MS < expiresAtMs;
}

function normalizeExpiresIn(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_EXPIRES_IN_SECONDS;
}

export function clearWorkflowJwt() {
  cachedToken = null;
  expiresAtMs = 0;
  pendingRequest = null;
}

export async function getWorkflowJwt() {
  if (isTokenUsable()) {
    return cachedToken;
  }

  if (pendingRequest) {
    return pendingRequest;
  }

  pendingRequest = (async () => {
    const response = await fetch(WORKFLOW_JWT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || data?.status !== 1 || typeof data?.token !== "string" || !data.token.trim()) {
      throw new Error(data?.message || "Failed to fetch workflow token");
    }

    const expiresInSeconds = normalizeExpiresIn(data.expiresIn);
    cachedToken = data.token.trim();
    expiresAtMs = Date.now() + expiresInSeconds * 1000;
    return cachedToken;
  })();

  try {
    return await pendingRequest;
  } finally {
    pendingRequest = null;
  }
}
