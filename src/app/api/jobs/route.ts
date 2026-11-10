import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "")
  || (process.env.NODE_ENV === "development"
    ? "http://localhost:8000"
    : "https://recapkit-video-backend.onrender.com");

async function backendResponse(request: NextRequest, path: string, init?: RequestInit) {
  if (!API_BASE_URL) {
    return NextResponse.json({ detail: "Video backend is not configured. Set NEXT_PUBLIC_API_URL to your deployed API URL." }, { status: 503 });
  }

  try {
    const apiKey = request.headers.get("x-api-key");
    const upstream = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
      cache: "no-store",
    });
    const body = await upstream.text();
    let result: unknown;
    try {
      result = JSON.parse(body);
    } catch {
      return NextResponse.json({
        detail: `Render server returned a non-JSON response (HTTP ${upstream.status}). It may be restarting or overloaded; the render job may still be running, so its status will be retried.`,
      }, { status: 502 });
    }
    return NextResponse.json(result, { status: upstream.status });
  } catch {
    return NextResponse.json(
      { detail: "The video backend could not be reached. It may be waking up; wait a moment and retry." },
      { status: 502 },
    );
  }
}

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get("job_id");
  if (!jobId || !/^[a-f0-9]{32}$/.test(jobId)) {
    return NextResponse.json({ detail: "A valid render job ID is required." }, { status: 400 });
  }
  return backendResponse(request, `/api/jobs/${jobId}`);
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ detail: "A valid JSON render request is required." }, { status: 400 });
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return NextResponse.json({ detail: "A valid JSON render request is required." }, { status: 400 });
  }

  return backendResponse(request, "/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
