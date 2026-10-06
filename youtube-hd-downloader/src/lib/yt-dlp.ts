import { spawn } from "node:child_process";

export function getFormatArguments(format: "1080" | "720" | "480" | "mp3"): string[] {
  if (format === "mp3") {
    return [
      "--format",
      "bestaudio/best",
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0"
    ];
  }
  const height = Number(format);
  const selector = [
    `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]`,
    `best[height<=${height}][ext=mp4]`,
    `best[height<=${height}]`
  ].join("/");
  return ["--format", selector, "--merge-output-format", "mp4"];
}

export function runYtDlp(
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal
) {
  const command = process.env.YT_DLP_PATH?.trim() || "yt-dlp";
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("The video service took too long to respond."));
    }, timeoutMs);
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(new Error("Download cancelled."));
    };
    const finish = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 8_000_000) {
        child.kill("SIGKILL");
        finish(new Error("The metadata response was unexpectedly large."));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-12_000);
    });
    child.once("error", () => {
      finish(new Error("yt-dlp is unavailable. Install it and make sure it is on PATH."));
    });
    child.once("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(new Error(classifyYtDlpError(stderr)));
      } else {
        finish();
      }
    });
    if (signal?.aborted) onAbort();
  });
}

export function classifyYtDlpError(stderr: string): string {
  const message = stderr.toLowerCase();
  if (
    message.includes("age-restricted") ||
    message.includes("sign in to confirm your age")
  ) {
    return "This video is age-restricted and cannot be processed.";
  }
  if (
    message.includes("not available in your country") ||
    message.includes("geo-restricted")
  ) {
    return "This video is not available in this region.";
  }
  if (message.includes("private video") || message.includes("video unavailable")) {
    return "This video is private or unavailable.";
  }
  if (message.includes("copyright")) {
    return "This video cannot be processed because of a rights restriction.";
  }
  return "We couldn't process this video. Check the URL and try again.";
}
