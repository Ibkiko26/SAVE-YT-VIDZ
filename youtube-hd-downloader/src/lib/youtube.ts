export const FORMAT_OPTIONS = [
  { id: "1080", label: "1080p", detail: "Full HD" },
  { id: "720", label: "720p", detail: "HD" },
  { id: "480", label: "480p", detail: "SD" },
  { id: "mp3", label: "MP3", detail: "Audio only" }
] as const;

export type FormatId = (typeof FORMAT_OPTIONS)[number]["id"];

export type VideoInfo = {
  id: string;
  title: string;
  channel: string;
  thumbnail: string | null;
  durationSeconds: number | null;
  formats: Array<{
    id: FormatId;
    label: string;
    detail: string;
    sizeBytes: number | null;
    available: boolean;
  }>;
};

type YtDlpFormat = {
  format_id?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
};

type YtDlpInfo = {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  thumbnail?: string;
  duration?: number;
  formats?: YtDlpFormat[];
  filesize?: number;
};

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com"
]);

export function validateYoutubeUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" &&
      parsed.protocol !== "http:"
    ) {
      return null;
    }
    if (!YOUTUBE_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    if (parsed.username || parsed.password) return null;
    if (parsed.hostname.toLowerCase() === "youtu.be" && parsed.pathname === "/") {
      return null;
    }
    if (parsed.hostname.toLowerCase() === "youtu.be" && !parsed.pathname.slice(1)) {
      return null;
    }
    if (
      parsed.hostname.toLowerCase().endsWith("youtube.com") &&
      parsed.pathname !== "/watch" &&
      !/^\/(shorts|embed|live|v)\/[^/]+\/?$/.test(parsed.pathname)
    ) {
      return null;
    }
    if (
      parsed.hostname.toLowerCase() === "youtu.be" &&
      !/^\/[^/]+\/?$/.test(parsed.pathname)
    ) {
      return null;
    }
    if (
      parsed.hostname.toLowerCase().endsWith("youtube.com") &&
      parsed.pathname.startsWith("/watch") &&
      !parsed.searchParams.get("v")
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function validateFormat(value: string | null): FormatId | null {
  return FORMAT_OPTIONS.find((format) => format.id === value)?.id ?? null;
}

export function formatBytes(bytes: number | null): string | null {
  if (!bytes || !Number.isFinite(bytes) || bytes < 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function estimatedSize(formats: YtDlpFormat[], maxHeight: number): number | null {
  const eligibleVideo = formats
    .filter((format) => format.vcodec && format.vcodec !== "none")
    .filter((format) => (format.height ?? 0) <= maxHeight)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const video = eligibleVideo[0];
  const audio = formats
    .filter((format) => format.acodec && format.acodec !== "none")
    .filter((format) => !format.vcodec || format.vcodec === "none")
    .sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];
  const videoSize = video?.filesize ?? video?.filesize_approx ?? null;
  const audioSize = audio?.filesize ?? audio?.filesize_approx ?? null;
  if (videoSize !== null && audioSize !== null) return videoSize + audioSize;
  const combined = formats
    .filter((format) => format.vcodec && format.vcodec !== "none")
    .filter((format) => format.acodec && format.acodec !== "none")
    .filter((format) => (format.height ?? 0) <= maxHeight)
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
  return combined?.filesize ?? combined?.filesize_approx ?? videoSize;
}

export function toVideoInfo(raw: YtDlpInfo): VideoInfo {
  const formats = raw.formats ?? [];
  const hasAudio = formats.some(
    (format) => format.acodec && format.acodec !== "none"
  );
  const maxAvailableHeight = formats.reduce(
    (height, format) =>
      format.vcodec && format.vcodec !== "none"
        ? Math.max(height, format.height ?? 0)
        : height,
    0
  );
  return {
    id: raw.id ?? "",
    title: raw.title?.trim() || "Untitled video",
    channel: raw.channel?.trim() || raw.uploader?.trim() || "Unknown channel",
    thumbnail:
      typeof raw.thumbnail === "string" &&
      /^https:\/\/(i\.ytimg\.com|img\.youtube\.com)\//.test(raw.thumbnail)
        ? raw.thumbnail
        : null,
    durationSeconds:
      typeof raw.duration === "number" && Number.isFinite(raw.duration)
        ? raw.duration
        : null,
    formats: FORMAT_OPTIONS.map((option) => ({
      ...option,
      available:
        option.id === "mp3"
          ? hasAudio
          : hasAudio &&
            maxAvailableHeight >= Number(option.id),
      sizeBytes:
        option.id === "mp3"
          ? null
          : estimatedSize(formats, Number(option.id))
    }))
  };
}
