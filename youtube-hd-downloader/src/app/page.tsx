"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  Clipboard,
  Clock3,
  Download,
  Headphones,
  Link2,
  LoaderCircle,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  Youtube
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { VideoInfo } from "@/lib/youtube";
import { formatBytes, validateYoutubeUrl } from "@/lib/youtube";

type DownloadState = "idle" | "preparing" | "downloading";
type FileWriter = {
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: () => Promise<void>;
};
type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<{
    createWritable: () => Promise<FileWriter>;
  }>;
};

function durationLabel(seconds: number | null): string {
  if (seconds === null) return "Duration unavailable";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const hours = Math.floor(minutes / 60);
  const shortMinutes = minutes % 60;
  return hours
    ? `${hours}:${String(shortMinutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${shortMinutes}:${String(remainder).padStart(2, "0")}`;
}

function isValidUrl(value: string): boolean {
  return Boolean(validateYoutubeUrl(value));
}

function preferredFormat(video: VideoInfo): string {
  return (
    video.formats.find((format) => format.available && format.id !== "mp3")?.id ??
    video.formats.find((format) => format.available)?.id ??
    "1080"
  );
}

function downloadFilename(title: string, extension: string): string {
  const safeTitle = title
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  return `${safeTitle || "youtube-video"}.${extension}`;
}

export default function HomePage() {
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [video, setVideo] = useState<VideoInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState("1080");
  const [isLoading, setIsLoading] = useState(false);
  const [downloadState, setDownloadState] = useState<DownloadState>("idle");
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [copied, setCopied] = useState(false);

  const validUrl = useMemo(() => isValidUrl(url), [url]);
  const inputError = touched && url.length > 0 && !validUrl;
  const chosenFormat = video?.formats.find((item) => item.id === selectedFormat);

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
  }, [darkMode]);

  const lookupVideo = useCallback(async (value: string) => {
    setTouched(true);
    setError("");
    setVideo(null);
    if (!isValidUrl(value)) {
      setError("Paste a valid YouTube video link first.");
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: validateYoutubeUrl(value) })
      });
      const data = (await response.json()) as VideoInfo | { error?: string };
      if (!response.ok) {
        throw new Error("error" in data && data.error ? data.error : "Unable to load this video.");
      }
      const videoInfo = data as VideoInfo;
      setVideo(videoInfo);
      setSelectedFormat(preferredFormat(videoInfo));
    } catch (lookupError) {
      setError(
        lookupError instanceof Error ? lookupError.message : "Unable to load this video."
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  async function pasteUrl() {
    try {
      const value = await navigator.clipboard.readText();
      setUrl(value.trim());
      setTouched(true);
      setConsent(false);
      if (isValidUrl(value.trim())) await lookupVideo(value.trim());
    } catch {
      setError("Clipboard access is unavailable. Paste the link into the field instead.");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (video && validUrl) return;
    await lookupVideo(url);
  }

  async function downloadVideo() {
    if (!video || !validUrl || !consent || downloadState !== "idle") return;
    setError("");
    setDownloadProgress(null);
    setDownloadState("preparing");
    const extension = selectedFormat === "mp3" ? "mp3" : "mp4";
    const filename = downloadFilename(video.title, extension);
    let writer: FileWriter | null = null;
    try {
      if (!chosenFormat?.available) {
        throw new Error("This quality is not available for the selected video.");
      }
      const pickerWindow = window as SavePickerWindow;
      if (pickerWindow.showSaveFilePicker) {
        try {
          const handle = await pickerWindow.showSaveFilePicker({
            suggestedName: filename,
            types: [
              {
                description: extension === "mp3" ? "MP3 audio" : "MP4 video",
                accept: {
                  [extension === "mp3" ? "audio/mpeg" : "video/mp4"]: [`.${extension}`]
                }
              }
            ]
          });
          writer = await handle.createWritable();
        } catch (pickerError) {
          if (pickerError instanceof DOMException && pickerError.name === "AbortError") {
            setDownloadState("idle");
            return;
          }
          throw pickerError;
        }
      }
      const query = new URLSearchParams({
        url: validateYoutubeUrl(url) ?? url,
        format: selectedFormat,
        consent: "true"
      });
      const response = await fetch(`/api/download?${query.toString()}`);
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Unable to prepare this download.");
      }
      if (!response.body) throw new Error("The download stream is unavailable.");

      setDownloadState("downloading");
      const total = Number(response.headers.get("Content-Length")) || 0;
      let received = 0;
      const chunks: Uint8Array[] = [];
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (writer) await writer.write(value);
          else chunks.push(value);
          setDownloadProgress(total ? Math.min(100, (received / total) * 100) : null);
        }
        if (writer) {
          await writer.close();
        } else {
          const merged = new Uint8Array(received);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
          }
          const blob = new Blob([merged.buffer], {
            type: extension === "mp3" ? "audio/mpeg" : "video/mp4"
          });
          const objectUrl = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = objectUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        }
      } catch (streamError) {
        await reader.cancel();
        throw streamError;
      }
      setDownloadProgress(100);
    } catch (downloadError) {
      if (writer) {
        try {
          await writer.abort();
        } catch {}
      }
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : "Unable to complete this download."
      );
    } finally {
      setDownloadState("idle");
      setConsent(false);
      window.setTimeout(() => setDownloadProgress(null), 1200);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Unable to copy the link. Select and copy it manually.");
    }
  }

  return (
    <main className="app-shell min-h-screen overflow-hidden text-foreground">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <div className="ambient ambient-three" aria-hidden="true" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 pb-10 pt-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between">
          <a href="#" className="inline-flex items-center gap-2.5" aria-label="Frame home">
            <span className="brand-mark">
              <Youtube size={19} strokeWidth={2.4} aria-hidden="true" />
            </span>
            <span className="text-[1.15rem] font-bold tracking-tight">frame<span className="text-pink">.</span></span>
          </a>
          <Button
            variant="secondary"
            size="icon"
            aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`}
            onClick={() => setDarkMode((current) => !current)}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </Button>
        </header>

        <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center pb-10 pt-14 sm:pt-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: "easeOut" }}
            className="text-center"
          >
            <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3.5 py-2 text-xs font-medium text-muted backdrop-blur-xl">
              <Sparkles size={14} className="text-yellow" aria-hidden="true" />
              Your videos, ready for offline
            </div>
            <h1 className="mx-auto max-w-3xl text-balance text-[clamp(2.5rem,7.5vw,4.4rem)] font-semibold leading-[1.08] tracking-[-0.045em]">
              A better way to
              <br className="hidden sm:block" /> keep what&apos;s <span className="gradient-text">yours.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-sm leading-7 text-muted sm:text-base">
              Save videos you own or have permission to download. Pick your quality, then you&apos;re good to go.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.12, ease: "easeOut" }}
            className="mt-10"
          >
            <Card className="p-4 sm:p-7">
              <form onSubmit={handleSubmit} noValidate>
                <label htmlFor="video-url" className="mb-3 block text-sm font-semibold">
                  Paste a video link
                </label>
                <div
                  className={`url-input-wrap ${inputError ? "url-input-error" : ""} ${validUrl ? "url-input-valid" : ""}`}
                >
                  <Link2 className="ml-4 shrink-0 text-muted" size={19} aria-hidden="true" />
                  <input
                    id="video-url"
                    type="url"
                    inputMode="url"
                    autoComplete="url"
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={url}
                    aria-invalid={inputError}
                    aria-describedby={inputError ? "url-error" : undefined}
                    onChange={(event) => {
                      setUrl(event.target.value);
                      setVideo(null);
                      setConsent(false);
                      setError("");
                    }}
                    onBlur={() => setTouched(true)}
                    className="min-w-0 flex-1 bg-transparent px-3 py-4 text-sm outline-none placeholder:text-muted/70 sm:text-[0.95rem]"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    className="mr-1 min-h-10 shrink-0 px-3 text-xs sm:px-4 sm:text-sm"
                    onClick={pasteUrl}
                    aria-label="Paste YouTube link from clipboard"
                  >
                    <Clipboard size={15} aria-hidden="true" />
                    <span className="hidden sm:inline">Paste</span>
                  </Button>
                  <Button
                    type="submit"
                    disabled={isLoading || !validUrl}
                    className="mr-1 min-h-11 shrink-0 px-4 text-xs sm:mr-1 sm:min-h-12 sm:px-6 sm:text-sm"
                  >
                    {isLoading ? (
                      <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <span>Get video</span>
                    )}
                    {!isLoading && <ArrowDownToLine size={16} aria-hidden="true" />}
                  </Button>
                </div>
                {inputError && (
                  <p id="url-error" className="mt-2 flex items-center gap-1.5 text-xs text-danger">
                    <AlertCircle size={14} aria-hidden="true" />
                    That doesn&apos;t look like a YouTube video link.
                  </p>
                )}
              </form>

              <AnimatePresence mode="wait">
                {isLoading && (
                  <motion.div
                    key="loading"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-6 flex items-center gap-3 rounded-2xl border border-line bg-surface/50 p-4"
                    role="status"
                  >
                    <LoaderCircle size={18} className="animate-spin text-pink" aria-hidden="true" />
                    <span className="text-sm text-muted">Getting video details...</span>
                  </motion.div>
                )}
                {error && (
                  <motion.div
                    key="error"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="mt-5 flex items-start gap-2.5 rounded-2xl border border-danger/25 bg-danger/10 px-4 py-3.5 text-sm text-danger"
                    role="alert"
                  >
                    <AlertCircle className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
                    <span>{error}</span>
                  </motion.div>
                )}
                {video && (
                  <motion.div
                    key={video.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.35 }}
                    className="mt-6 grid gap-5 border-t border-line pt-6 sm:grid-cols-[220px_1fr] sm:gap-6"
                  >
                    <div className="thumbnail-frame">
                      {video.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={video.thumbnail} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full place-items-center bg-surface">
                          <Youtube size={35} className="text-muted/60" aria-hidden="true" />
                        </div>
                      )}
                      <span className="absolute bottom-2 right-2 rounded-lg bg-black/75 px-2 py-1 text-[0.68rem] font-medium text-white backdrop-blur">
                        {durationLabel(video.durationSeconds)}
                      </span>
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h2 className="line-clamp-2 text-base font-semibold leading-6 sm:text-lg">
                            {video.title}
                          </h2>
                          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                            <span>{video.channel}</span>
                            <span className="inline-flex items-center gap-1">
                              <Clock3 size={13} aria-hidden="true" />
                              {durationLabel(video.durationSeconds)}
                            </span>
                            <button
                              type="button"
                              onClick={copyLink}
                              className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink"
                              aria-label="Copy video link"
                            >
                              <Clipboard size={12} aria-hidden="true" />
                              {copied ? "Copied" : "Copy link"}
                            </button>
                          </div>
                        </div>
                        <span className="hidden rounded-full border border-line bg-surface/70 px-2.5 py-1 text-[0.68rem] font-medium text-muted sm:inline-flex">
                          Video ready
                        </span>
                      </div>

                      <div className="format-options-container mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {video.formats.map((format) => (
                          <button
                            type="button"
                            key={format.id}
                            onClick={() => setSelectedFormat(format.id)}
                            aria-pressed={selectedFormat === format.id}
                            disabled={!format.available}
                            className={`format-option ${selectedFormat === format.id ? "format-option-selected" : ""} ${!format.available ? "format-option-unavailable" : ""}`}
                            aria-label={`${format.label}, ${format.detail}${format.available ? "" : ", unavailable for this video"}`}
                          >
                            <span className="flex items-center justify-between gap-1">
                              <span className="font-semibold">{format.label}</span>
                              {format.id === "mp3" && <Headphones size={14} aria-hidden="true" />}
                              {selectedFormat === format.id && <Check size={13} aria-hidden="true" />}
                            </span>
                            <span className="mt-1 block text-[0.67rem] text-muted">{format.detail}</span>
                            <span className="mt-1 block text-[0.66rem] text-muted/80">
                              {format.id === "mp3"
                                ? format.available ? "Size varies" : "Unavailable"
                                : formatBytes(format.sizeBytes) ?? "Size unavailable"}
                            </span>
                          </button>
                        ))}
                      </div>

                      <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-xs leading-5 text-muted">
                        <input
                          type="checkbox"
                          checked={consent}
                          onChange={(event) => setConsent(event.target.checked)}
                          className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--rgb-pink))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink"
                        />
                        <span>I confirm I have the right to download this video.</span>
                      </label>

                      <Button
                        type="button"
                        onClick={downloadVideo}
                        disabled={!consent || !chosenFormat?.available || downloadState !== "idle"}
                        className="mt-4 w-full sm:w-auto sm:self-start"
                      >
                        {downloadState !== "idle" ? (
                          <LoaderCircle size={17} className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Download size={17} aria-hidden="true" />
                        )}
                        {downloadState === "preparing"
                          ? "Preparing your video..."
                          : downloadState === "downloading"
                            ? "Downloading..."
                            : `Download ${selectedFormat === "mp3" ? "MP3" : selectedFormat + "p"}`}
                      </Button>

                      {downloadState !== "idle" && (
                        <div className="mt-3" role="status" aria-live="polite">
                          <div className="flex justify-between text-[0.7rem] text-muted">
                            <span>
                              {downloadState === "preparing"
                                ? "Preparing your file. Larger videos can take a little longer."
                                : "Saving your file..."}
                            </span>
                            {downloadProgress !== null && (
                              <span>{Math.round(downloadProgress)}%</span>
                            )}
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
                            <div
                              className={`h-full rounded-full bg-gradient-to-r from-pink via-purple to-blue transition-[width] duration-200 ${downloadProgress === null ? "progress-indeterminate" : ""}`}
                              style={
                                downloadProgress !== null
                                  ? { width: `${downloadProgress}%` }
                                  : undefined
                              }
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 }}
            className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs text-muted"
          >
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck size={15} className="text-teal" aria-hidden="true" />
              No sign-up required
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 size={15} className="text-purple" aria-hidden="true" />
              Quality up to 1080p
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Headphones size={15} className="text-pink" aria-hidden="true" />
              MP3 audio option
            </span>
          </motion.div>
        </section>

        <footer className="mx-auto w-full max-w-4xl">
          <div className="rounded-2xl border border-line bg-surface/45 px-4 py-3.5 text-center text-[0.68rem] leading-5 text-muted/90 backdrop-blur-md sm:text-xs">
            This tool is for downloading videos you own or have explicit permission to download. Downloading copyrighted content without permission may violate YouTube&apos;s Terms of Service and copyright law.
          </div>
          <p className="mt-4 text-center text-[0.68rem] text-muted/70">
            Frame is an independent utility and is not affiliated with YouTube.
          </p>
        </footer>
      </div>
    </main>
  );
}
