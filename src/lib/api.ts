export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "")
  || (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "");

export function backendUrl(path: string) {
  if (!API_BASE_URL) {
    throw new Error("Video backend is not configured. Set NEXT_PUBLIC_API_URL to your deployed API URL.");
  }
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
