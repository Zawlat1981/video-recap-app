export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "")
  || (process.env.NODE_ENV === "development"
    ? "http://localhost:8000"
    : "https://recapkit-video-backend.onrender.com");

const API_KEY_STORAGE_KEY = "recapkit-api-key";

export function getBackendApiKey() {
  return typeof window === "undefined" ? "" : window.localStorage.getItem(API_KEY_STORAGE_KEY) ?? "";
}

export function saveBackendApiKey(value: string) {
  window.localStorage.setItem(API_KEY_STORAGE_KEY, value.trim());
}

export function backendAuthHeaders() {
  const headers = new Headers();
  const apiKey = getBackendApiKey();
  if (apiKey) headers.set("X-API-Key", apiKey);
  return headers;
}

export function backendUrl(path: string) {
  if (!API_BASE_URL) {
    throw new Error("Video backend is not configured. Set NEXT_PUBLIC_API_URL to your deployed API URL.");
  }
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
