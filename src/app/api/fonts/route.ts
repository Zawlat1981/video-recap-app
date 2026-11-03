import { NextResponse } from "next/server";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET() {
  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE_URL}/api/fonts`, { cache: "no-store" });
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
