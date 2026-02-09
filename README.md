<img src="public/nimio-logo.png" alt="Nimio Logo" height="60"/>

## SLDP ecosystem

[SLDP (Softvelum Low Delay Protocol)](https://softvelum.com/sldp/) is a part of **Larix** product family, which provides a complete solution for mobile contribution and low-latency playback.

- **Nimio** — lightweight JavaScript **SLDP** player for the web built on WebCodecs.
- **Larix Player** — playback including **SLDP** (iOS / Apple TV / Android)
- **Larix Broadcaster** — mobile contribution; supports **SLDP** talkback (iOS / Android)

### Get Larix apps

**Larix Player**  
&nbsp;&nbsp;<a href="https://itunes.apple.com/app/sldp-player/id1238237026">
<img alt="Download on the App Store" src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" height="50">
</a>

<a href="https://play.google.com/store/apps/details?id=com.softvelum.sldp_player">
<img alt="Get it on Google Play" src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png" height="60">
</a>

**Larix Broadcaster**  
&nbsp;&nbsp;<a href="https://apps.apple.com/us/app/larix-broadcaster-live-stream/id1042474385">
<img alt="Download on the App Store" src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" height="50">
</a>

<a href="https://play.google.com/store/apps/details?id=com.wmspanel.larix_broadcaster">
<img alt="Get it on Google Play" src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png" height="60">
</a>

## Overview

**Nimio** is a lightweight, flexible JavaScript player for the SLDP 2.0 protocol built on the WebCodecs API. It offers low-latency streaming, full control over audio/video pipelines, and easy integration into modern web apps.

## Demo

https://nimio.pages.dev/demo - Latest

https://softvelum.com/nimio/demo/ - Stable

## Player highlights

- Ultra-low latency SLDP 2.0 over WebSockets with WebCodecs; supports H.264/H.265/AV1/VP8/VP9 plus AAC/MP3/Opus.
- Adaptive streaming
- Integrated player UI
- Latency and sync control: target + tolerance, fast-forward/seek correction, audio gap smoothing, timestamp recovery.
- Audio-only/video-only modes
- Full screen playback
- VU meter
- EventBus hooks for custom UI/analytics

## SLDP & WebCodecs Features

- **SLDP Protocol** (Softvelum Low Delay Protocol) - WebSocket‑based streaming with sub-100ms latency, supporting H.264, H.265/HEVC, AV1, VP8, VP9, AAC, MP3, Opus, and more.
- **WebCodecs Integration** - Fine‑grained control over decoding, synchronization, jitter buffering, playback speed, and debugging at each stage of the pipeline.
- **Available on all web platforms** - desktop, Android and [recent iOS/macOS](https://softvelum.com/2025/09/nimio-safari-ios-macos-26/).

Read the [first beta release announcement](https://softvelum.com/2025/05/introducing-nimio-nextgen-player/) with the list of current features.

## Quick Start

```html
<script type="module" src="/dist/nimio.js"></script>

<div id="player"></div>

<script>
  const nimio = new Nimio({
    streamUrl: "wss://example.com/stream",
    container: "#player",
  });
</script>
```

## Full Configuration Example

```javascript
nimio = new Nimio({
  streamUrl: "wss://example.com/stream", //SLDP stream URL
  container: "#player", // CSS selector or HTMLElement
  //optional parameters:
  width: 476,
  height: 268,
  latency: 600, // Target latency in ms
  startOffset: 1000, // Startup offset in ms
  pauseTimeout: 3000, // ms until auto-stop when paused
  metricsOverlay: true, // Show overlay with performance metrics
  logLevel: "warn", // Logging verbosity
  autoplay: true, // Start playback automatically
  videoOnly: false, // Video only playback
  audioOnly: false, // Audio only playback
  muted: true, // Player is muted on start
  hardwareAcceleration: false, // Request hardware decoder; falls back to software if unsupported
  adaptiveBitrate: {
    initialRendition: "480p", // Default rendition which the player will set on start
    maxRendition: "1080p", // Maximum rendition that the player will set automatically
    sizeConstrained: true, // Player won't automatically switch to renditions which dimensions exceed the actual player size more then 5%
  },
  vuMeter: {
    // a volume unit (VU) meter settings object
    api: "AudioWorklet", // audio processing interface used by VU meter ("AudioWorklet" or "ScriptProcessor")
    container: "vu-meter", // ID of the VU meter container. VU meter UI  occupies the whole container's size. Vertical orientation (container's height >= width), horizontal orientation (container's width > height)
    mode: "peak", // the way which audio level values are calculated ("peak", "avg", "rms")
    type: "input", // VU meter readings type ("input" or "output")
    rate: 6, // audio level update frequency limit (from 0.001 to 50)
    dbRange: 100, // decibel scale range which is plotted in the VU meter UI
  },
});

nimio.play();
```

## Multiple players

Mosaic demo (multiple players on one page): [docs/mosaic-demo.md](docs/mosaic-demo.md)

## Cross‑Origin Isolation

Nimio tries to use `SharedArrayBuffer` for zero‑copy state/audio exchange, but now falls back to a message‑based path when it is unavailable.  
For best latency you should still enable a fully isolated browsing context by sending both the **Cross‑Origin‑Opener‑Policy** and **Cross‑Origin‑Embedder‑Policy** headers on any page or asset that loads the player.

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

## Events

`Nimio` player uses events to interact with its UI. It allows to create custom UI easily.

### Events sent from UI to player

These events are used to send commands and data from UI to `Nimio` player.

- `ui:play-pause-click`  
  Start/pause playback.  
  Parameters:

```javascript
isPlayClicked: Boolean;
```

- `ui:mute-unmute-click`  
  Mute/unmute audio.  
  Parameters:

```javascript
mute: Boolean;
```

- `ui:volume-change`  
  Set audio volume.  
  Parameters:

```javascript
volume: Number; // Current volume as integer value in the range from 0 to 100.
```

- `ui:rendition-change`  
  Change ABR rendition. Should be form the list received with `nimio:rendition-list` event.  
  Parameters:

```javascript
   rendition: {
     id: Number, // An integer number with unique rendition ID.
     name: String // Rendition name.
   }
```

### Events sent from player to UI

These events are used to send data from `Nimio` player to UI.

- `nimio:play`  
  Playback started.  
  Parameters:

```javascript
instanceName: String; // Player instance name
containerId: String; // Container ID, where player is rendered
```

- `nimio:muted`  
  Audio muted/unmuted.  
  Parameters:

```javascript
muted: Boolean;
```

- `nimio:volume-set`  
  Audio volume set.  
  Parameters:

```javascript
volume: Number; // Current volume integer value in the range from 0 to 100.
```

- `nimio:abr`  
  Adaptive bitrate enabled/disabled.  
  Parameters:

```javascript
isAbr: Boolean;
```

- `nimio:rendition-set`  
  ABR rendition set.  
  Parameters:

  ```javascript
   rendition: {
     id: Number, // An integer number with unique rendition ID.
     name: String // Rendition name.
   }
  ```

- `nimio:rendition-list`  
  An array of ABR renditions available.  
   Parameters:

```javascript
  renditions: [
   {
     id: Number, // An integer number with unique rendition ID.
     name: String // Rendition name.
   },
   ...
 ]
```

## Roadmap

The following features are planned for upcoming releases:

- Automatic aspect ratio detection
- Picture-in-Picture (PiP)
- Latency retention for asynchronous renditions
- CEA-608 closed captions
- VOD playback (DVR support)
- VOD thumbnail previews
- SEI timecodes support
- WebTransport protocol
- Nimble Advertizer integration
- Sync mode
- Screenshot capture
- Splash/startup image
- Extended Player API
- OffscreenCanvas rendering
- Resume from pause in DVR mode (no auto-jump to live)

## Contributing

Contributions are welcome! Please open an issue for discussion or submit a pull request.

## License

Nimio released under [MIT License](https://github.com/Softvelum/nimio/blob/main/LICENSE).
