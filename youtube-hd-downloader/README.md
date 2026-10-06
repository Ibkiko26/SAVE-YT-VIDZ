# Frame — YouTube video downloader

A responsive Next.js 14 app for looking up YouTube video metadata and downloading a selected MP4 quality (up to 1080p) or MP3 audio. Use it only for videos you own or have permission to download. It does not use cookies, logins, DRM circumvention, or paid APIs.

## Requirements

- Node.js 20+
- `yt-dlp` available on `PATH` (or set `YT_DLP_PATH`)
- `ffmpeg` and `ffprobe` available on `PATH` (or set `FFMPEG_LOCATION`)

`ffmpeg` is required to merge separate video and audio streams and to extract MP3 audio. Install current releases of both tools using your operating system's package manager or the official project instructions.

## Run locally

```bash
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open http://localhost:3000. Then run the production checks:

```bash
npm run typecheck
npm run build
```

## API

- `POST /api/info` — JSON body `{ "url": "https://www.youtube.com/watch?v=..." }`; returns title, channel, thumbnail, duration, and estimated sizes for the available output choices.
- `GET /api/download?url=...&format=1080&consent=true` — prepares a selected `1080`, `720`, `480`, or `mp3` file and streams it with attachment headers. The consent parameter is required.

URLs are restricted to YouTube hostnames, playlists are disabled, and format selection is allowlisted server-side. API calls have per-process rate limits; metadata is cached for five minutes. Concurrent downloads are capped per process by `MAX_CONCURRENT_DOWNLOADS`. Temporary media is deleted after the response stream closes. When deployed behind a trusted reverse proxy that overwrites `x-forwarded-for`, set `TRUST_PROXY=true` so rate limits are per client; leave it false for direct exposure or proxies that do not sanitize that header.

## Deployment

This project includes API routes that spawn `yt-dlp` and `ffmpeg`, write temporary media to disk, and may run for several minutes. A serverless deployment such as Vercel is not suitable for reliable downloads: execution time, temporary storage, and response-size limits vary by plan and may terminate jobs before completion.

For a full deployment, use a persistent Node.js container on Railway, Render, or Fly.io with `yt-dlp` and `ffmpeg` installed, and deploy this app as one service. Configure `YT_DLP_PATH`, `FFMPEG_LOCATION` if needed, and a conservative `MAX_CONCURRENT_DOWNLOADS`. If deploying the frontend to Vercel, move the API routes into a separately hosted persistent backend and update the client API origin/CORS policy before exposing it publicly; do not proxy large media through Vercel.

The included in-memory cache and rate limits are per process and reset on restart. Multi-instance deployments should use shared storage (for example, Redis) for distributed rate limits and caching. Protect a public deployment behind appropriate network-level abuse controls.

## Legal

This tool is for downloading videos you own or have explicit permission to download. Downloading copyrighted content without permission may violate YouTube's Terms of Service and copyright law. A user confirmation is required before every download. The app does not attempt to bypass age, regional, account, or rights restrictions.
