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

    this.config = createConfig(options);
    this._logger = LoggersFactory.create(options.instanceName, "Nimio");

    this._sab = new SharedArrayBuffer(
      Int32Array.BYTES_PER_ELEMENT * Object.keys(IDX).length,
    );
    this.state = new StateManager(this._sab);
    this.state.stop();

    this.videoBuffer = new VideoBuffer(1000, this._sab, this.config);
    this.videoOnly = false;

    this._onPlayPauseClick = this._onPlayPauseClick.bind(this);
    this.ui = new Ui(
      this.config.container,
      {
        width: this.config.width, //todo get from video?
        height: this.config.height,
        metricsOverlay: this.config.metricsOverlay,
      },
      this._onPlayPauseClick,
    );

    this.videoBuffer.attachDebugElement(this.ui.getDebugOverlay());

    this.ctx = this.ui.getCanvas().getContext("2d");
    this.firstFrameTsUs = null;
    this.initWorkers();
    this.audioWorkletReady = null;

    this._renderVideoFrame = this._renderVideoFrame.bind(this);
    this._pauseTimeoutId = null;
  }

  initWorkers () {
    this.videoDecoderWorker = new Worker(
      new URL("./decoders/decoder_video.js", import.meta.url),
      { type: "module" },
    );
    this.videoDecoderWorker.addEventListener("message", (e) => {
      this.processWorkerMessage(e);
    });

    this.audioDecoderWorker = new Worker(
      new URL("./decoders/decoder_audio.js", import.meta.url),
      { type: "module" },
    );
    this.audioDecoderWorker.addEventListener("message", (e) => {
      this.processWorkerMessage(e);
    });

    this.webSocketWorker = new Worker(
      new URL("./transport/web_socket.js", import.meta.url),
      { type: "module" },
    );
    this.webSocketWorker.addEventListener("message", (e) => {
      this.processWorkerMessage(e);
    });
    this.webSocketWorker.postMessage({ type: "initShared", sab: this._sab });
  }

  _renderVideoFrame () {
    if (this.state.isPlaying()) {
      requestAnimationFrame(this._renderVideoFrame);
      if (null === this.audioWorkletReady) return true;

      let currentPlayedTsUs = this.state.getCurrentTsUs() + this.firstFrameTsUs - 1000000;
      const frame = this.videoBuffer.getFrameForTime(currentPlayedTsUs);
      if (frame) {
        this.ctx.drawImage(
          frame,
          0,
          0,
          this.ctx.canvas.width,
          this.ctx.canvas.height,
        );
        frame.close();
      }
    }
  }

  _onPlayPauseClick (e, isPlayClicked) {
    isPlayClicked ? this.play() : this.pause();
  }

  play () {
    const resumeFromPause = this.state.isPaused();

    if (this._pauseTimeoutId !== null) {
      clearTimeout(this._pauseTimeoutId);
      this._pauseTimeoutId = null;
    }

    this.state.start();

    requestAnimationFrame(this._renderVideoFrame);

    if (!resumeFromPause) {
      this.webSocketWorker.postMessage({
        type: "initWebSocket",
        url: this.config.streamUrl,
        protocols: ["sldp.softvelum.com"],
        startOffset: this.config.startOffset,
      });
    }

    this.ui.drawPause();
  }

  pause () {
    this.state.pause();
    this._pauseTimeoutId = setTimeout(() => {
      this._logger.debug("Auto stop");
      this.stop();
    }, this.config.pauseTimeout); // TODO: monitor current latency and reduce pauseTimeout if low buffer capacity
  }

  stop () {
    this.state.stop();
    this.webSocketWorker.postMessage({ type: "stop" });
    this.videoBuffer.clear();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = this.audioNode = this.audioWorkletReady = null;
    }
    this.firstFrameTsUs = null;
    this.state.resetCurrentTsUs();
    this.ui.drawPlay();
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
  }

  version() {
    return __NIMIO_VERSION__;
  }

  static version() {
    return __NIMIO_VERSION__;
  }

  processWorkerMessage (e) {
    const type = e.data.type;
    switch (type) {
    case "videoConfig":
      this.videoDecoderWorker.postMessage({
        type: "videoConfig",
        videoConfig: e.data.videoConfig,
      });
      break;
    case "audioConfig":
      if (!e.data.audioConfig) {
        this.initAudioContext(48000, 1, true);
        this.videoOnly = true;
        break;
      }
      this.audioDecoderWorker.postMessage({
        type: "audioConfig",
        audioConfig: e.data.audioConfig,
      });
      break;
    case "videoCodecData":
      this.videoDecoderWorker.postMessage({
        type: "codecData",
        codecData: e.data.codecData,
      });
      break;
    case "audioCodecData":
      this.audioDecoderWorker.postMessage({
        type: "codecData",
        codecData: e.data.codecData,
        aacConfig: parseAACConfig(e.data.codecData),
      });
      break;
    case "videoChunk":
      this.videoDecoderWorker.postMessage({
        type: "videoChunk",
          timestamp: e.data.timestamp,
        chunkType: e.data.chunkType,
          frameWithHeader: e.data.frameWithHeader,
          framePos: e.data.framePos,
      }, [e.data.frameWithHeader]);
      break;
    case "audioChunk":
      this.audioDecoderWorker.postMessage({
        type: "audioChunk",
          timestamp: e.data.timestamp,
          frameWithHeader: e.data.frameWithHeader,
          framePos: e.data.framePos,
      }, [e.data.frameWithHeader]);
      break;
    case "videoFrame":
      let frame = e.data.videoFrame;
      let frameTsUs = frame.timestamp;
      if (this.videoOnly && null === this.firstFrameTsUs) {
        this.firstFrameTsUs = frameTsUs;
      }
      this.videoBuffer.addFrame(frame, frameTsUs);
      this.state.setVideoDecoderQueue(e.data.decoderQueue);
      this.state.setVideoDecoderLatency(e.data.decoderLatency);
      break;
    case "audioFrame":
      this.handleAudioFrame(e.data.audioFrame);
      this.state.setAudioDecoderQueue(e.data.decoderQueue);
      break;
    default:
      break;
    }
  }

  async handleAudioFrame (audioFrame) {
    if (this.state.isStopped()) {
      audioFrame.close();
      return true;
    }

    // create AudioContext with correct sampleRate on first frame
    const channels = audioFrame.numberOfChannels;
    await this.initAudioContext(audioFrame.sampleRate, channels);
    if (!this.audioContext || !this.audioNode) {
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

    if (null === this.firstFrameTsUs) {
      this.firstFrameTsUs = audioFrame.timestamp;
    }

    this.audioNode.port.postMessage({
      buffer: interleaved,
      numberOfChannels: channels,
    }, [interleaved.buffer]);
    audioFrame.close();
  }

  async initAudioContext (sampleRate, channels, blank) {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({
        latencyHint: "interactive",
        sampleRate: sampleRate,
      });

      if (sampleRate !== this.audioContext.sampleRate) {
        this._logger.error(
          "Unsupported sample rate", sampleRate, this.audioContext.sampleRate
        );
      }

      // load processor
      this.audioWorkletReady = this.audioContext.audioWorklet
        .addModule(workletUrl)
        .catch((err) => {
          this._logger.error("Audio worklet error", err);
        });
    }

    await this.audioWorkletReady;
    if (this.audioNode) return;

      this.audioNode = new AudioWorkletNode(
        this.audioContext,
        "nimio-processor",
        {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [channels],
          processorOptions: {
          sampleRate: sampleRate,
            sab: this._sab,
            latency: this.config.latency,
            startOffset: this.config.startOffset,
            pauseTimeout: this.config.pauseTimeout,
            blank: blank || false,
          },
        },
      );

      this.audioNode.connect(this.audioContext.destination);
    }
}
