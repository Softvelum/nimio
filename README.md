<img src="public/nimio-logo.png" alt="Nimio Logo" height="60"/>

## Overview

**Nimio** is a lightweight, flexible JavaScript player for the SLDP 2.0 protocol built on the WebCodecs API. It offers low-latency streaming, full control over audio/video pipelines, and easy integration into modern web apps.

## Demo

https://softvelum.com/nimio/demo/

## SLDP & WebCodecs Features

- **SLDP Protocol** (Softvelum Low Delay Protocol) — WebSocket‑based streaming with sub-100ms latency, supporting H.264, H.265/HEVC, AV1, VP8, VP9, AAC, MP3, Opus, and more.
- **WebCodecs Integration** — Fine‑grained control over decoding, synchronization, jitter buffering, playback speed, and debugging at each stage of the pipeline.

Read the [first beta release announcement](https://softvelum.com/2025/05/introducing-nimio-nextgen-player/) with the list of current features.

## Quick Start

```javascript
nimio = new Nimio({
  streamUrl: "ws://example.com/stream", //SLDP stream URL
  container: "#player", // CSS selector or HTMLElement
  width: 476,
  height: 268,
  latency: 600, // Target latency in ms
  startOffset: 1000, // Startup offset in ms
  pauseTimeout: 3000, // ms until auto-stop when paused
});

nimio.play();
```

## Cross‑Origin Isolation

Nimio uses features (e.g. `SharedArrayBuffer`) that require a fully isolated browsing context.  
To enable this, your server must send both the **Cross‑Origin‑Opener‑Policy** and **Cross‑Origin‑Embedder‑Policy** headers on any page or asset that loads the player.

Add these two headers:

```nginx
add_header Cross-Origin-Opener-Policy  same-origin always;
add_header Cross-Origin-Embedder-Policy require-corp always;
```

#### Example: Nginx Configuration

```nginx
server {
    listen 443 ssl;
    server_name example.com;

    # Serve the Nimio demo with COOP/COEP
    location ^~ /nimio/ {
        alias /usr/share/nginx/example.com/nimio/;
        index index.html;

        # Enable cross‑origin isolation
        add_header Cross-Origin-Opener-Policy  same-origin always;
        add_header Cross-Origin-Embedder-Policy require-corp always;
    }
}
```

## Methods

- play(): void — start playback
- pause(): void — pause playback
- stop(): void — stop and reset the player

## Contributing

Contributions are welcome! Please open an issue for discussion or submit a pull request.

## License

Nimio released under [MIT License](https://github.com/Softvelum/nimio/blob/main/LICENSE).
