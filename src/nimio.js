import workletUrl from "./audio-worklet-processor.js?worker&url"; // ?worker&url - Vite initiate new Rollup build
import { IDX } from "./shared/values.js";
import { StateManager } from "./state-manager.js";
import { SLDPManager } from "./sldp/manager";
import { Ui } from "./ui/ui.js";
import { VideoBuffer } from "./media/buffers/video-buffer.js";
import { WritableAudioBuffer } from "./media/buffers/writable-audio-buffer.js";
import { TransportAdapter } from "./transport/adapter.js";
import { createConfig } from "./player-config.js";
import { AudioService } from "./audio-service.js";
import { AudioGapsProcessor } from "./media/processors/audio-gaps-processor.js";
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

    this._bufferSec = Math.ceil((this._config.fullBufferMs + 200) / 1000);

    this._videoBuffer = new VideoBuffer(options.instanceName, 1000);
    this._noVideo = this._config.audioOnly;
    this._noAudio = this._config.videoOnly;
    if (this._noVideo && this._noAudio) {
      this._noVideo = this._noAudio = false;
    }

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

    if (this._config.metricsOverlay) {
      this._debugView = this._ui.appendDebugOverlay(
        this._state,
        this._videoBuffer,
      );
    }

    this._renderVideoFrame = this._renderVideoFrame.bind(this);
    this._firstFrameTsUs = null;

    this._ctx = this._ui.getCanvas().getContext("2d");

    this._initTransport(options.instanceName, "./web-socket.js");
    this._sldpManager = new SLDPManager(this._transport);
    this._initDecoders();
    this._audioWorkletReady = null;
    this._audioService = new AudioService(48000, 1, 1024); // default values

    if (this._config.autoplay) {
      this.play();
      setTimeout(() => {
        this._ui.hideControls(true);
      }, 1000);
    }
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
      this._sldpManager.start(this._config.streamUrl, this._config.startOffset);
      if (this._debugView) {
        this._debugView.start();
      }
    }

    this._ui.drawPause();
  }

  pause() {
    this._state.pause();
    this._pauseTimeoutId = setTimeout(() => {
      this._logger.debug("Auto stop");
      this.stop(true); // TODO: check possibility to reuse socket
    }, this._config.pauseTimeout);
  }

  stop(closeConnection) {
    this._state.stop();
    this._sldpManager.stop(!!closeConnection);
    if (this._debugView) {
      this._debugView.stop();
    }

    this._videoBuffer.clear();
    this._noVideo = false;

    this._stopAudio();
    if (this._audioBuffer) {
      this._audioBuffer.reset();
    }

    this._state.setPlaybackStartTsUs(0);
    this._state.resetCurrentTsUs();
    this._firstFrameTsUs = null;

    this._ui.drawPlay();
    this._ctx.clearRect(0, 0, this._ctx.canvas.width, this._ctx.canvas.height);
    this._pauseTimeoutId = null;
  }

  destroy() {
    this.stop(true);
    this._ui.destroy();
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

  _initDecoders() {
    this._videoDecoderWorker = new Worker(
      new URL("./media/decoders/decoder-video.js", import.meta.url),
      { type: "module" },
    );
    this._videoDecoderWorker.addEventListener("message", (e) => {
      this._processWorkerMessage(e);
    });

    this._audioDecoderWorker = new Worker(
      new URL("./media/decoders/decoder-audio.js", import.meta.url),
      { type: "module" },
    );
    this._audioDecoderWorker.addEventListener("message", (e) => {
      this._processWorkerMessage(e);
    });
  }

  _initTransport(instName, url) {
    this._transport = new TransportAdapter(instName, url);
    this._transport.callbacks = {
      videoConfig: this._onVideoConfigReceived.bind(this),
      videoCodec: this._onVideoCodecDataReceived.bind(this),
      videoChunk: this._onVideoChunkReceived.bind(this),

      audioConfig: this._onAudioConfigReceived.bind(this),
      audioCodec: this._onAudioCodecDataReceived.bind(this),
      audioChunk: this._onAudioChunkReceived.bind(this),
    };
  }

  _renderVideoFrame() {
    if (this._state.isPlaying()) {
      requestAnimationFrame(this._renderVideoFrame);
      if (null === this._audioWorkletReady || null === this._firstFrameTsUs)
        return true;

      let curTsUs = this._audioService.smpCntToTsUs(
        this._state.getCurrentTsSmp(),
      );
      if (curTsUs <= 0) return true;

      let currentPlayedTsUs = curTsUs + this._firstFrameTsUs;
      const frame = this._videoBuffer.popFrameForTime(currentPlayedTsUs);
      if (frame) {
        this._ctx.drawImage(
          frame,
          0,
          0,
          this._ctx.canvas.width,
          this._ctx.canvas.height,
        );
        frame.close();

        let availableMs =
          (this._videoBuffer.lastFrameTs - frame.timestamp) / 1000;
        if (availableMs < 0) availableMs = 0;
        this._state.setAvailableVideoMs(availableMs);
      }
    }
  }

  _onVideoConfigReceived(config) {
    if (!config) {
      this._noVideo = true;
      return;
    }

    this._videoDecoderWorker.postMessage({
      type: "config",
      config: config,
    });
  }

  _onAudioConfigReceived(config) {
    if (!config) {
      this._startNoAudioMode();
      return;
    }

    this._audioDecoderWorker.postMessage({
      type: "config",
      config: config,
    });
  }

  _onVideoCodecDataReceived(data) {
    this._videoDecoderWorker.postMessage({
      type: "codecData",
      codecData: data.data,
    });
  }

  _onAudioCodecDataReceived(data) {
    if (this._noAudio) {
      this._stopAudio();
    }

    let config = this._audioService.parseAudioConfig(data.data, data.family);
    this._audioDecoderWorker.postMessage({
      type: "codecData",
      codecData: data.data,
      config: config,
    });

    this._audioBuffer = WritableAudioBuffer.allocate(
      this._bufferSec * 5, // reserve 5 times buffer size for development (TODO: reduce later)
      config.sampleRate,
      config.numberOfChannels,
      config.sampleCount,
    );
    this._audioBuffer.addPreprocessor(
      new AudioGapsProcessor(
        this._audioService.sampleCount,
        this._audioService.sampleRate,
      ),
    );
  }

  _onVideoChunkReceived(data) {
    this._videoDecoderWorker.postMessage(
      {
        type: "chunk",
        timestamp: data.timestamp,
        chunkType: data.chunkType,
        frameWithHeader: data.frameWithHeader,
        framePos: data.framePos,
      },
      [data.frameWithHeader],
    );
  }

  _onAudioChunkReceived(data) {
    this._audioDecoderWorker.postMessage(
      {
        type: "chunk",
        timestamp: data.timestamp,
        frameWithHeader: data.frameWithHeader,
        framePos: data.framePos,
      },
      [data.frameWithHeader],
    );
  }

  _processWorkerMessage(e) {
    const type = e.data.type;
    switch (type) {
      case "videoFrame":
        let frame = e.data.videoFrame;
        let frameTsUs = frame.timestamp;
        if (
          null === this._firstFrameTsUs &&
          (this._noAudio || this._videoBuffer.getTimeCapacity() >= 0.5)
        ) {
          this._firstFrameTsUs = frameTsUs;
          this._state.setPlaybackStartTsUs(frameTsUs);

          if (!this._noAudio) {
            this._startNoAudioMode();
          }
        }
        this._videoBuffer.addFrame(frame, frameTsUs);
        this._state.setVideoLatestTsUs(frameTsUs);
        this._state.setVideoDecoderQueue(e.data.decoderQueue);
        this._state.setVideoDecoderLatency(e.data.decoderLatency);
        break;
      case "audioFrame":
        e.data.audioFrame.rawTimestamp = e.data.rawTimestamp;
        e.data.audioFrame.decTimestamp = e.data.decTimestamp;
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
    await this._initAudioContext(
      audioFrame.sampleRate,
      audioFrame.numberOfChannels,
    );

    if (!this._audioContext || !this._audioNode) {
      this._logger.error("Audio context is not initialized. Can't play audio.");
      audioFrame.close();
      return false;
    }

    this._audioBuffer.pushFrame(audioFrame);
    audioFrame.close();

    if (null === this._firstFrameTsUs) {
      this._firstFrameTsUs = audioFrame.rawTimestamp;
      this._state.setPlaybackStartTsUs(audioFrame.rawTimestamp);
    }
  }

  async _initAudioContext(sampleRate, channels, idle) {
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

    let procOptions = {
      instanceName: this._config.instanceName,
      sampleRate: sampleRate,
      stateSab: this._sab,
      latency: this._config.latency,
      idle: idle || false,
    };

    if (!idle && this._audioBuffer) {
      procOptions.sampleCount = this._audioService.sampleCount;
      procOptions.audioSab = this._audioBuffer.buffer;
      procOptions.capacity = this._audioBuffer.bufferCapacity;
    }

    this._audioNode = new AudioWorkletNode(
      this._audioContext,
      "nimio-processor",
      {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [channels],
        processorOptions: procOptions,
      },
    );

    this._audioNode.connect(this._audioContext.destination);
  }

  _startNoAudioMode() {
    this._initAudioContext(48000, 1, true);
    this._noAudio = true;
  }

  _stopAudio() {
    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = this._audioNode = this._audioWorkletReady = null;
    }
    this._noAudio = false;
  }
}
