import { NextResponse } from "next/server";
import { getClientKey, getVideoInfo, isRateLimited } from "@/lib/server";
import { validateYoutubeUrl } from "@/lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (isRateLimited(`info:${getClientKey(request)}`, 30)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a minute and try again." },
      { status: 429 }
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 8192) {
    return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a valid JSON request." }, { status: 400 });
  }
  const url = validateYoutubeUrl(
    body && typeof body === "object" ? (body as { url?: unknown }).url : null
  );
  if (!url) {
    return NextResponse.json(
      { error: "Enter a valid YouTube video URL to continue." },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(await getVideoInfo(url), {
      headers: { "Cache-Control": "private, max-age=0" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to look up this video.";
    const status = message.includes("too long") ? 504 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
