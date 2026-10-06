import { createReadStream } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { getFormatArguments, runYtDlp } from "@/lib/yt-dlp";
import {
  toVideoInfo,
  type FormatId,
  type VideoInfo
} from "@/lib/youtube";

const metadataCache = new Map<string, { expiresAt: number; value: VideoInfo }>();
const requestWindows = new Map<string, { startedAt: number; count: number }>();
const cacheTtlMs = 5 * 60 * 1000;

export function isRateLimited(key: string, limit = 15): boolean {
  const now = Date.now();
  if (requestWindows.size > 10_000) {
    for (const [requestKey, window] of requestWindows) {
      if (now - window.startedAt > 60_000) requestWindows.delete(requestKey);
    }
  }
  const current = requestWindows.get(key);
  if (!current && requestWindows.size >= 20_000) return true;
  if (!current || now - current.startedAt > 60_000) {
    requestWindows.set(key, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

export function getClientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return process.env.TRUST_PROXY === "true" && forwarded
    ? forwarded
    : "unknown";
}

export async function createDownload(
  url: string,
  format: FormatId,
  signal: AbortSignal
): Promise<Response> {
  const maxConcurrent = Number.parseInt(process.env.MAX_CONCURRENT_DOWNLOADS ?? "3", 10);
  const limit = Number.isFinite(maxConcurrent) && maxConcurrent > 0 ? maxConcurrent : 3;
  const slot = acquireDownloadSlot(limit);
  if (!slot) {
    return Response.json(
      { error: "Downloads are busy right now. Please try again shortly." },
      { status: 429 }
    );
  }

  let directory: string | null = null;
  let slotReleased = false;
  const releaseSlot = () => {
    if (slotReleased) return;
    slotReleased = true;
    releaseDownloadSlot();
  };
  try {
    const downloadDirectory = await mkdtemp(join(tmpdir(), "frame-download-"));
    directory = downloadDirectory;
    const info = await getVideoInfo(url, signal);
    if (signal.aborted) throw new Error("Download cancelled.");
    const outputTemplate = join(downloadDirectory, "media.%(ext)s");
    const ffmpegLocation = process.env.FFMPEG_LOCATION?.trim();
    const args = [
      "--no-warnings",
      "--no-playlist",
      "--newline",
      "--no-part",
      ...(ffmpegLocation ? ["--ffmpeg-location", ffmpegLocation] : []),
      ...getFormatArguments(format),
      ...(format === "mp3" ? [] : ["--recode-video", "mp4"]),
      "--output",
      outputTemplate,
      url
    ];
    const { stderr } = await runYtDlp(args, 15 * 60_000, signal);
    if (signal.aborted) throw new Error("Download cancelled.");
    const files = await readdir(downloadDirectory);
    const filename = files.find((file) => file.startsWith("media."));
    if (!filename) {
      throw new Error(stderr ? "The prepared video file could not be found." : "The video file was not created.");
    }

    const path = join(downloadDirectory, filename);
    const fileStats = await stat(path);
    const extension = format === "mp3" ? "mp3" : "mp4";
    const downloadName = `${safeFilename(info.title)}.${extension}`;
    const fallbackName = downloadName
      .replace(/[^\x20-\x7e]/g, "_")
      .replace(/["\\]/g, "_");
    const encodedName = encodeURIComponent(downloadName).replace(/['()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
    const nodeStream = createReadStream(path);
    const body = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      releaseSlot();
      void rm(downloadDirectory, { recursive: true, force: true });
    };
    nodeStream.once("close", cleanup);
    nodeStream.once("error", cleanup);

    return new Response(body, {
      headers: {
        "Content-Type": format === "mp3" ? "audio/mpeg" : "video/mp4",
        "Content-Length": String(fileStats.size),
        "Content-Disposition": `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    releaseSlot();
    if (directory) await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function getVideoInfo(
  url: string,
  signal?: AbortSignal
): Promise<VideoInfo> {
  if (metadataCache.size > 500) {
    const now = Date.now();
    for (const [cachedUrl, entry] of metadataCache) {
      if (entry.expiresAt <= now) metadataCache.delete(cachedUrl);
    }
  }
  const cached = metadataCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const { stdout } = await runYtDlp(
    ["--dump-single-json", "--no-warnings", "--no-playlist", "--skip-download", url],
    45_000,
    signal
  );
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error("The video service returned invalid metadata.");
  }
  if (!raw || typeof raw !== "object") {
    throw new Error("The video service returned invalid metadata.");
  }
  const value = toVideoInfo(raw);
  if (metadataCache.size >= 500) {
    const oldestKey = metadataCache.keys().next().value as string | undefined;
    if (oldestKey) metadataCache.delete(oldestKey);
  }
  metadataCache.set(url, { expiresAt: Date.now() + cacheTtlMs, value });
  return value;
}

let activeDownloads = 0;

function acquireDownloadSlot(limit: number): boolean {
  if (activeDownloads >= limit) return false;
  activeDownloads += 1;
  return true;
}

function releaseDownloadSlot(): void {
  activeDownloads = Math.max(0, activeDownloads - 1);
}

function safeFilename(value: string): string {
  const safe = value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  return safe || "youtube-video";
}
