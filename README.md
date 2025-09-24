<img src="public/nimio-logo.png" alt="Nimio Logo" height="60"/>

## Overview

**Nimio** is a lightweight, flexible JavaScript player for the SLDP 2.0 protocol built on the WebCodecs API. It offers low-latency streaming, full control over audio/video pipelines, and easy integration into modern web apps.

## Demo

https://nimio.pages.dev/demo - Latest

https://softvelum.com/nimio/demo/ - Stable

## SLDP & WebCodecs Features

- **SLDP Protocol** (Softvelum Low Delay Protocol) - WebSocket‑based streaming with sub-100ms latency, supporting H.264, H.265/HEVC, AV1, VP8, VP9, AAC, MP3, Opus, and more.
- **WebCodecs Integration** - Fine‑grained control over decoding, synchronization, jitter buffering, playback speed, and debugging at each stage of the pipeline.
- **Available on all web platforms** - desktop, Android and [recent iOS/macOS](https://softvelum.com/2025/09/nimio-safari-ios-macos-26/).

Read the [first beta release announcement](https://softvelum.com/2025/05/introducing-nimio-nextgen-player/) with the list of current features.

## Quick Start

```javascript
nimio = new Nimio({
  streamUrl: "ws://example.com/stream", //SLDP stream URL
  container: "#player", // CSS selector or HTMLElement
  //optional parameters:
  width: 476,
  height: 268,
  latency: 600, // Target latency in ms
  startOffset: 1000, // Startup offset in ms
  pauseTimeout: 3000, // ms until auto-stop when paused
  metricsOverlay: true, // Show overlay with performance metrics
  logLevel: "warn", // Logging verbosity
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

### Instance Methods

These methods are available on every `Nimio` player instance.

- `play()`  
  Start playback.
- `pause()`  
  Pause playback.
- `stop()`  
  Stop and reset the player.
- `version()`  
  Return the current version string of this player instance.

### Static Methods

These methods are available directly on the `Nimio` class.

- `Nimio.version()`  
  Return the current version string (identical to `instance.version()`).

## Roadmap

The following features are planned for upcoming releases:

- Adaptive bitrate
- Volume control
- Automatic aspect ratio detection
- Fullscreen playback
- Picture-in-Picture (PiP)
- Latency retention for asynchronous renditions
- CEA-608 closed captions
- VU meter
- VOD playback (DVR support)
- VOD thumbnail previews
- SEI timecodes support
- WebTransport protocol
- Nimble Advertizer integration
- Automatic reconnection
- Sync mode
- Screenshot capture
- Splash/startup image
- Extended Player API
- Muted autoplay
- Dynamic latency adjustment
- OffscreenCanvas rendering
- Resume from pause in DVR mode (no auto-jump to live)

## Contributing

Contributions are welcome! Please open an issue for discussion or submit a pull request.

## License

Nimio released under [MIT License](https://github.com/Softvelum/nimio/blob/main/LICENSE).
