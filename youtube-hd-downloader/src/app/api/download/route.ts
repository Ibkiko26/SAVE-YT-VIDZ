import { NextResponse } from "next/server";
import { createDownload, getClientKey, isRateLimited } from "@/lib/server";
import { validateFormat, validateYoutubeUrl } from "@/lib/youtube";

export const runtime = "nodejs";
export const maxDuration = 900;

export async function GET(request: Request) {
  if (isRateLimited(`download:${getClientKey(request)}`, 5)) {
    return NextResponse.json(
      { error: "Download limit reached. Please wait a minute before trying again." },
      { status: 429 }
    );
  }
  const params = new URL(request.url).searchParams;
  const url = validateYoutubeUrl(params.get("url"));
  const format = validateFormat(params.get("format"));
  if (!url || !format) {
    return NextResponse.json(
      { error: "Provide a valid YouTube URL and a supported format." },
      { status: 400 }
    );
  }
  if (params.get("consent") !== "true") {
    return NextResponse.json(
      { error: "Confirm you have the right to download this video." },
      { status: 403 }
    );
  }

  try {
    return await createDownload(url, format, request.signal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare the download.";
    const status = message.includes("too long") ? 504 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}
