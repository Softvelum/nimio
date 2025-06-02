import { parseAACConfig } from "./utils/aac_config_parser.js";
import workletUrl from "./audio-worklet-processor.js?worker&url"; // ?worker&url - Vite initiate new Rollup build
import { IDX } from "./shared/values.js";
import { StateManager } from "./state_manager.js";
import { Ui } from "./ui/ui.js";
import { VideoBuffer } from "./video-buffer.js";
import { createConfig } from "./player_config.js";
import LoggersFactory from "./shared/logger.js";

export default class Nimio {
  constructor(options) {
    console.debug("Nimio " + this.version());

    if (options && !options.instanceName) {
      options.instanceName = "nimio_" + (Math.floor(Math.random() * 1000) + 1);
    }

    this._config = createConfig(options);
    this._logger = LoggersFactory.create(options.instanceName, "Nimio");

    const idxCount = Object.values(IDX).reduce((total, val) => {
      total += Array.isArray(val) ? val.length : 1;
      return total;
    }, 0);

    this._sab = new SharedArrayBuffer(Uint32Array.BYTES_PER_ELEMENT * idxCount);
    this._state = new StateManager(this._sab);
    this._state.stop();

    this._videoBuffer = new VideoBuffer(1000, this._sab, this._config);
    this._noAudio = this._noVideo = false;

    this._onPlayPauseClick = this._onPlayPauseClick.bind(this);
    this._ui = new Ui(
      this._config.container,
      {
        width: this._config.width, //todo get from video?
        height: this._config.height,
        metricsOverlay: this._config.metricsOverlay,
      },
      this._onPlayPauseClick,
    );
    this._pauseTimeoutId = null;

    this._videoBuffer.attachDebugElement(this._ui.getDebugOverlay());
    this._renderVideoFrame = this._renderVideoFrame.bind(this);
    this._firstFrameTsUs = null;

    this._ctx = this._ui.getCanvas().getContext("2d");

    this._initWorkers();
    this._audioWorkletReady = null;
  }

  play() {
    const resumeFromPause = this._state.isPaused();

    if (this._pauseTimeoutId !== null) {
      clearTimeout(this._pauseTimeoutId);
      this._pauseTimeoutId = null;
    }

    this._state.start();

    requestAnimationFrame(this._renderVideoFrame);

    if (!resumeFromPause) {
      this._webSocketWorker.postMessage({
        type: "initWebSocket",
        url: this._config.streamUrl,
        protocols: ["sldp.softvelum.com"],
        startOffset: this._config.startOffset,
      });
    }

    this._ui.drawPause();
  }

  pause() {
    this._state.pause();
    this._pauseTimeoutId = setTimeout(() => {
      this._logger.debug("Auto stop");
      this.stop();
    }, this._config.pauseTimeout); // TODO: monitor current latency and reduce pauseTimeout if low buffer capacity
  }

  stop(closeConnection) {
    this._state.stop();
    this._webSocketWorker.postMessage({ type: "stop", close: !!closeConnection });

    this._videoBuffer.clear();
    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = this._audioNode = this._audioWorkletReady = null;
    }
    this._noVideo = this._noAudio = false;

    this._state.setPlaybackStartTsUs(0);
    this._state.resetCurrentTsUs();
    this._firstFrameTsUs = null;

    this._ui.drawPlay();
    this._ctx.clearRect(0, 0, this._ctx.canvas.width, this._ctx.canvas.height);
    this._pauseTimeoutId = null;
  }

  version() {
    return __NIMIO_VERSION__;
  }

  static version() {
    return __NIMIO_VERSION__;
  }

  _onPlayPauseClick(e, isPlayClicked) {
    isPlayClicked ? this.play() : this.pause();
  }

  _initWorkers() {
    this._videoDecoderWorker = new Worker(
      new URL("./decoders/decoder_video.js", import.meta.url),
      { type: "module" },
    );
    this._videoDecoderWorker.addEventListener("message", (e) => {
      this._processWorkerMessage(e);
    });

    this._audioDecoderWorker = new Worker(
      new URL("./decoders/decoder_audio.js", import.meta.url),
      { type: "module" },
    );
    this._audioDecoderWorker.addEventListener("message", (e) => {
      this._processWorkerMessage(e);
    });

    this._webSocketWorker = new Worker(
      new URL("./transport/web_socket.js", import.meta.url),
      { type: "module" },
    );
    this._webSocketWorker.addEventListener("message", (e) => {
      this._processWorkerMessage(e);
    });
    this._webSocketWorker.postMessage({ type: "initShared", sab: this._sab });
  }

  _renderVideoFrame() {
    if (this._state.isPlaying()) {
      requestAnimationFrame(this._renderVideoFrame);
      if (null === this._audioWorkletReady || null === this._firstFrameTsUs)
        return true;

      let curTsUs = this._state.getCurrentTsUs();
      if (curTsUs <= 0) return true;

      let currentPlayedTsUs = curTsUs + this._firstFrameTsUs;
      const frame = this._videoBuffer.getFrameForTime(currentPlayedTsUs);
      if (frame) {
        this._ctx.drawImage(
          frame,
          0,
          0,
          this._ctx.canvas.width,
          this._ctx.canvas.height,
        );
        frame.close();
      }
    }
  }

  _processWorkerMessage(e) {
    const type = e.data.type;
    switch (type) {
      case "videoConfig":
        if (!e.data.videoConfig) {
          this._noVideo = true;
          break;
        }
        this._videoDecoderWorker.postMessage({
          type: "videoConfig",
          videoConfig: e.data.videoConfig,
        });
        break;
      case "audioConfig":
        if (!e.data.audioConfig) {
          this._initAudioContext(48000, 1, true);
          this._noAudio = true;
          break;
        }
        this._audioDecoderWorker.postMessage({
          type: "audioConfig",
          audioConfig: e.data.audioConfig,
        });
        break;
      case "videoCodecData":
        this._videoDecoderWorker.postMessage({
          type: "codecData",
          codecData: e.data.codecData,
        });
        break;
      case "audioCodecData":
        this._audioDecoderWorker.postMessage({
          type: "codecData",
          codecData: e.data.codecData,
          aacConfig: parseAACConfig(e.data.codecData),
        });
        break;
      case "videoChunk":
        this._videoDecoderWorker.postMessage(
          {
            type: "videoChunk",
            timestamp: e.data.timestamp,
            chunkType: e.data.chunkType,
            frameWithHeader: e.data.frameWithHeader,
            framePos: e.data.framePos,
          },
          [e.data.frameWithHeader],
        );
        break;
      case "audioChunk":
        this._audioDecoderWorker.postMessage(
          {
            type: "audioChunk",
            timestamp: e.data.timestamp,
            frameWithHeader: e.data.frameWithHeader,
            framePos: e.data.framePos,
          },
          [e.data.frameWithHeader],
        );
        break;
      case "videoFrame":
        let frame = e.data.videoFrame;
        let frameTsUs = frame.timestamp;
        if (this._noAudio && null === this._firstFrameTsUs) {
          this._firstFrameTsUs = frameTsUs;
          this._state.setPlaybackStartTsUs(frameTsUs);
        }
        this._videoBuffer.addFrame(frame, frameTsUs);
        this._state.setVideoLatestTsUs(frameTsUs);
        this._state.setVideoDecoderQueue(e.data.decoderQueue);
        this._state.setVideoDecoderLatency(e.data.decoderLatency);
        break;
      case "audioFrame":
        this._handleAudioFrame(e.data.audioFrame);
        this._state.setAudioDecoderQueue(e.data.decoderQueue);
        break;
      case "decoderError":
        // TODO: show error message in UI
        if (e.data.kind === "video") this._noVideo = true;
        if (e.data.kind === "audio") this._noAudio = true;

        if (this._noVideo && this._noAudio) {
          this.stop(true);
        }
        break;
      default:
        break;
    }
  }

  async _handleAudioFrame(audioFrame) {
    if (this._state.isStopped()) {
      audioFrame.close();
      return true;
    }

    // create AudioContext with correct sampleRate on first frame
    const channels = audioFrame.numberOfChannels;
    await this._initAudioContext(audioFrame.sampleRate, channels);
    if (!this._audioContext || !this._audioNode) {
      this._logger.error("Audio context is not initialized. Can't play audio.");
      audioFrame.close();
      return false;
    }

    const frames = audioFrame.numberOfFrames;
    const interleaved = new Float32Array(frames * channels);

    if (audioFrame.format.endsWith("-planar")) {
      const planes = [];
      for (let c = 0; c < channels; c++) {
        const bytes = audioFrame.allocationSize({ planeIndex: c });
        const samples = bytes / Float32Array.BYTES_PER_ELEMENT;
        const planeBuf = new Float32Array(samples);
        audioFrame.copyTo(planeBuf, { planeIndex: c });
        planes.push(planeBuf);
      }
      for (let i = 0; i < frames; i++) {
        for (let c = 0; c < channels; c++) {
          interleaved[i * channels + c] = planes[c][i] ?? 0;
        }
      }
    } else {
      audioFrame.copyTo(interleaved, { planeIndex: 0 });
    }

    if (null === this._firstFrameTsUs) {
      this._firstFrameTsUs = audioFrame.timestamp;
      this._state.setPlaybackStartTsUs(audioFrame.timestamp);
    }

    this._audioNode.port.postMessage(
      {
        buffer: interleaved,
        numberOfChannels: channels,
      },
      [interleaved.buffer],
    );
    audioFrame.close();
  }

  async _initAudioContext(sampleRate, channels, blank) {
    if (!this._audioContext) {
      this._audioContext = new AudioContext({
        latencyHint: "interactive",
        sampleRate: sampleRate,
      });

      if (sampleRate !== this._audioContext.sampleRate) {
        this._logger.error(
          "Unsupported sample rate",
          sampleRate,
          this._audioContext.sampleRate,
        );
      }

      // load processor
      this._audioWorkletReady = this._audioContext.audioWorklet
        .addModule(workletUrl)
        .catch((err) => {
          this._logger.error("Audio worklet error", err);
        });
    }

    await this._audioWorkletReady;
    if (this._audioNode) return;

    this._audioNode = new AudioWorkletNode(
      this._audioContext,
      "nimio-processor",
      {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [channels],
        processorOptions: {
          sampleRate: sampleRate,
          sab: this._sab,
          latency: this._config.latency,
          startOffset: this._config.startOffset,
          pauseTimeout: this._config.pauseTimeout,
          blank: blank || false,
        },
      },
    );

    this._audioNode.connect(this._audioContext.destination);
  }
}
