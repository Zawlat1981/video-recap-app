import { NextRequest, NextResponse } from "next/server";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "")
  || (process.env.NODE_ENV === "development" ? "http://localhost:8000" : "");

export async function POST(request: NextRequest) {
  if (!API_BASE_URL) {
    return NextResponse.json({ detail: "Video backend is not configured. Set NEXT_PUBLIC_API_URL to your deployed API URL." }, { status: 503 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ detail: "A valid multipart asset upload is required." }, { status: 400 });
  }

  const category = formData.get("category");
  const file = formData.get("file");
  if ((category !== "image" && category !== "audio") || !(file instanceof File)) {
    return NextResponse.json({ detail: "Choose an image or audio file to upload." }, { status: 422 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_BASE_URL}/api/assets`, {
      method: "POST",
      body: formData,
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
