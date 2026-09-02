# Liquid Glass Player

A glassmorphism music player that **auto-scans your repo's `music/` folder**, supports all common audio formats, plays with zero-latency via Web Audio pre-decoding, and survives background tabs without stuttering.

## Features

- **Auto library scan** — drop files in `music/`, no drag-and-drop, no manual registration needed
- **Filename = track name (no extension)** — e.g. `晴天` not `晴天.mp3`
- **Full format support**: MP3, FLAC, WAV, OGG, M4A, AAC, OPUS, WMA, AIFF, APE, WV, CAF, WebM
- **Zero-latency switching** — Web Audio API pre-decodes the next track in memory
- **Background-safe** — audio keeps playing when tab is hidden; UI animations freeze to save CPU
- **Kugou-ready** — unlock on first touch, `playbackRate` correction on resume
- Liquid glass UI with animated orbs (GPU-accelerated)
- Background image from your own repo (fast in China, no VPN, no jsDelivr dependency)

## How to add music

1. Put audio files in the `music/` folder
2. Name them **without extension**, e.g. `晴天`, `Bohemian Rhapsody`
3. (Optional) Edit `music/manifest.json` to set artist names:

```json
[
  { "file": "晴天", "artist": "周杰伦" },
  { "file": "Bohemian Rhapsody", "artist": "Queen" }
]
```

The player auto-detects the real format by probing extensions. If you skip `manifest.json`, it still works — the filename becomes the track name.

> **About Kugou `.kgm`/`.kgg`**: these are DRM-encrypted and cannot be played by browsers. Convert them to MP3/FLAC with the Kugou client first, then upload as a no-extension filename.

## Background image

The player loads `image_download_1787389320083.jpg` from the **same repo** (your `*.github.io` domain), so it's fast in China without any proxy. If the file is missing, it falls back to a pure CSS gradient — the page always looks good.

## Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Add player"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Then **Settings → Pages → Source: main branch**.

Visit: `https://YOUR_USERNAME.github.io/`

## Keyboard

- `Space` — play / pause
- `←` `→` — previous / next

## License

MIT
