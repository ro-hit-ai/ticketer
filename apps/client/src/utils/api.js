// apps/client/src/utils/api.js
const RAW_BASE =
  import.meta.env.MODE === "development"
    ? "http://localhost:5004" // 👈 Always backend in dev
    : import.meta.env.VITE_BACKEND_URL; // 👈 For prod, from .env

const BASE = (RAW_BASE || "").replace(/\/+$/, "").replace(/\/api$/, "");

export const apiUrl = (path) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (normalizedPath.startsWith("/api/")) {
    return `${BASE}${normalizedPath}`;
  }
  return `${BASE}/api${normalizedPath}`;
};
