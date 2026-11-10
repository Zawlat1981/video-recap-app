import { NextResponse } from "next/server";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "")
  || (process.env.NODE_ENV === "development"
    ? "http://localhost:8000"
    : "https://aungzawlatt-video-recap-backend.hf.space");

export async function GET(request: Request) {
  if (!API_BASE_URL) {
    return NextResponse.json({ detail: "Video backend is not configured. Set NEXT_PUBLIC_API_URL to your deployed API URL." }, { status: 503 });
  }

  let upstream: Response;
  try {
    const apiKey = request.headers.get("x-api-key");
    upstream = await fetch(`${API_BASE_URL}/api/fonts`, {
      headers: apiKey ? { "X-API-Key": apiKey } : undefined,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ detail: "The video backend is unavailable." }, { status: 502 });
  }

  let result: unknown;
  try {
    result = await upstream.json();
  } catch {
    return NextResponse.json({ detail: "The video backend returned an invalid response." }, { status: 502 });
  }
  return NextResponse.json(result, { status: upstream.status });
}
