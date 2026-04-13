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
  vod: {
    // video on demand (VOD) playback settings. VOD feature provides playback of recorded live stream (DVR). VOD settings can be defined as an object, or simply with true or false values. true value has the same meaning as an empty object, false means the feature is switched off. If not defined, VOD functionality is not enabled by default. VOD feature is backed by open source HLS.js library.

    // Please refer to https://softvelum.com/2024/06/dvr-sldp-html5-player/ article for setup and usage details.

    url: "https://myserver.com:8081/live/stream/playlist_dvr.m3u8", // (optional) URL to HLS stream that provides recorded content. If not defined, SLDP Player will use default Nimble Streamer DVR path according to the live stream URL.
    startupVodFailover: true, // (optional) specifies whether the player should automatically switch to VOD on startup if live stream playback fails. Enabled by default.
    liveFailover: true, // (optional) specifies whether the player should automatically switch to Live if VOD stream playback fails. Enabled by default.
    thumbnails: true, // (optional) enables video thumbnails above the progress bar of the player while hovering or dragging it. It works only if Nimble Streamer is configured with the dvr_hls_add_program_date_time parameter enabled.
    hlsjs: {
      source: "https://cdn.jsdelivr.net/npm/hls.js@1",
    }, // (optional) HLS.js library settings. It can be either object or string. Currently 2 string values are available: 1. ‘local’ – HLS.js is already included in the web application, so Nimio doesn’t load anything. 2. ‘cdn’ – (default) Nimio will automatically load HLS.js library from the official CDN URL. If the hlsjs parameter is defined as object, it can contain the following fields (currently only one parameter is supported): ‘source‘ – a URL to HLS.js library if a specific version is required.
  },
  captions: {
    // CEA-608 closed captions settings object. Can be set to {} or true to enable captions without specific settings. Each caption track is represented by ID: capObj pair, where the ID is one of the following: ‘CC1’, ‘CC2’, ‘CC3’, ‘CC4’. The capObj is an object, that defines the following settings:
    CC1: {
      name: "First track", // (optional) track name that is shown in caption selection menu. If it’s not set, then corresponding ID will be shown instead.
      lang: "English", // (optional) track language that is shown in parentheses in caption selection menu after the track name.
      default: true, // (optional) defines whether given track should be enabled by default. If this parameter isn’t specified for any of the tracks, then captions won’t be shown on the player start.
    },
    CC2: {
      name: "Third track", // (optional) track name
      lang: "French", // (optional) track language
    },
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
- `destroy()`  
  Destroy the player instance and release all memory.
- `version()`  
  Return the current version string of the player instance.

- `seekVod(position)`  
  Updates current VOD playback position with the specified value. If the player is currently in the live mode, it's switched to the VOD mode.\
  **Return value:** boolean status (`true` - position update is performed successfully, `false` - playback position update failed).\
  **Parameters:**
  position - playback position in seconds from the start. Possible values are in range [0, duration]

- `seekLive(buffer)`  
  Updates current live playback position (buffering) with the specified value. If the player is currently in VOD mode, it will be switched to Live mode. The latency value in the player's settings is updated with the value of the buffer parameter. If the parameter is omitted, the current buffering setting is used.\
  **Return value:** boolean status (`true` - position update is performed successfully, `false` - playback position update failed).\
  **Parameters:**
  buffer - (optional) buffer size in seconds that the player pertains during live playback.

- `getCaptionTracks()`  
  Returns map of available CEA-608 caption tracks.  
  **Return value:** object, containing ID: CAP_OBJ pairs, where the ID is one of the following: "CC1", "CC2", "CC3", "CC4". The CAP_OBJ is and object with the following fields:
  - title - caption track title that is shown in caption selection dialog.
  - name - (optional) caption track name defined in caption settings.
  - lang - (optional) caption track language defined in caption settings.

- `getCurrentCaptionTrack()`  
  Returns currently selected CEA-608 caption track.  
  **Return value:** object, containing single ID: CAP_OBJ pair, with the ID of currently selected caption track. If no caption track is selected, then an empty object will be returned.

- `setCaptionTrack(ID)`  
  Sets current CEA-608 caption track with the ID specified. To turn off captions, "OFF" value should be specified as ID.  
  **Return value:** boolean status (`true` - track is set successfully, `false` - specified track can't be set).  
  **Parameters:**  
  ID - either caption track ID value, which can be one of the following: "CC1", "CC2", "CC3", "CC4" or "OFF" to turn off captions.

### Static Methods

These methods are available directly on the `Nimio` class.

- `Nimio.version()`  
  Return the current version string (identical to `instance.version()`).

## Events

`Nimio` player uses events to interact with its UI. It allows to create custom UI easily.

### Events sent from UI to player

These events are used to send commands and data from UI to `Nimio` player.

- `ui:play-pause-click`  
  Start/pause playback control invoked.  
  **Parameters:**

```javascript
isPlayClicked: Boolean;
mode: "live" | "vod"; // playback mode
```

---

- `ui:volume-change`  
  Set audio volume.  
  **Parameters:**

```javascript
volume: Number; // Current volume as integer value in the range from 0 to 100.
```

---

- `ui:mute-unmute-click`  
  Mute/unmute audio.  
  **Parameters:**

```javascript
mute: Boolean;
```

---

- `ui:rendition-select`  
  A specific rendition is selected from the list received from the nimio:rendition-list event.  
  **Parameters:**

```javascript
rend: {
  id: Number, // An integer number with unique rendition ID.
  name: String // Rendition name.
},
mode: "live" | "vod"; // playback mode
```

---

### Events sent from player to UI

These events are used to send data from `Nimio` player to UI.

- `nimio:play`  
  Playback started.
  **Parameters:**

```javascript
mode: "live" | "vod"; // playback mode
```

---

- `nimio:pause`  
  Playback paused.  
  **Parameters:**

```javascript
mode: "live" | "vod"; // playback mode
```

---

- `nimio:playback-start`
  Playback has started and first frame is rendered.  
  **Parameters:**

```javascript
mode: "live" | "vod"; // playback mode
```

---

- `nimio:playback-end`  
  Playback reached the end of the media.  
  **Parameters:**

```javascript
mode: "live" | "vod"; // playback mode
```

---

- `nimio:volume-set`  
  Audio volume level set.  
  **Parameters:**

```javascript
volume: Number; // Current volume integer value in the range from 0 to 100.
```

---

- `nimio:muted`  
  Audio muted/unmuted.  
  **Parameters:**

```javascript
muted: Boolean;
```

---

- `nimio:abr`  
  Adaptive bitrate (ABR) mode enabled/disabled.  
  **Parameters:**

```javascript
enabled: Boolean;
```

---

- `nimio:rendition-list`  
  List of available renditions.  
  **Parameters:**

```javascript
  renditions: Array<{
    id: Number, // An integer number with unique rendition ID.
    name: String // Rendition name.
  }>;
```

---

- `nimio:rendition-set`  
  Active video/audio rendition selected manually or programmatically.  
  **Parameters:**

```javascript
  rendition: {
    id: Number, // An integer number with unique rendition ID.
    name: String // Rendition name.
  }
```

---

### Other events that can be handled by

- `nimio:captions-arrived`  
  Emitted each time a new set of captions is ready to be displayed on the player's screen. All previous captions should be replaced by new ones. CEA-608 caption format implies that player's screen is divided into 15 rows and 32 columns. Each cell contains one symbol.  
  **Parameters:**  
  captions - array of caption block objects having the following fields:
  - time - caption display start time related to video element's currentTime
  - x - caption block's horizontal position counted from the left. Can be in range of 0 - 31.
  - y1 - caption block's top line position counted from the top. Can be in range of 0 - 14.
  - y2 - caption block's bottom line position counted from the top. Can be in range of 0 - 14.
  - regions - array of caption region objects containing single field - spans. The value of this field is an array of caption row span elements. Each element contains text string related to specific row and styling parameters:
    - row - row number starting from the top. Can be in range of 0 - 14.
    - content- caption span text string
    - style - caption span style object, having the follwing fields:
    - foreground - text font color
    - background - background color
    - italic - text should be italic if true
    - underline - text should be underlined if true
    - flash - span should be blinking if true

    If the regions array is empty, it means that the given caption block is used to clear all previous captions from the given time onwards.

## Roadmap

The following features are planned for upcoming releases:

- Automatic aspect ratio detection
- Picture-in-Picture (PiP)
- SEI timecodes support
- WebTransport protocol
- Screenshot capture
- Extended Player API
- OffscreenCanvas rendering
- Resume from pause in DVR mode (no auto-jump to live)

## Contributing

Contributions are welcome! Please open an issue for discussion or submit a pull request.

## License

Nimio released under [MIT License](https://github.com/Softvelum/nimio/blob/main/LICENSE).
