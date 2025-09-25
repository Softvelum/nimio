import workletUrl from "./audio-worklet-processor?worker&url"; // ?worker&url - Vite initiate new Rollup build
import wsTransportUrl from "./transport/web-socket?worker&url";
import { EventMixin } from "./events";
import { IDX } from "./shared/values";
import { StateManager } from "./state-manager";
import { SLDPManager } from "./sldp/manager";
import { PlaybackContext } from "./playback/context";
import { Ui } from "./ui/ui";
import { FrameBuffer } from "./media/buffers/frame-buffer";
import { WritableAudioBuffer } from "./media/buffers/writable-audio-buffer";
import { DecoderFlowVideo } from "./media/decoders/flow-video";
import { DecoderFlowAudio } from "./media/decoders/flow-audio";
import { createConfig } from "./player-config";
import { AudioConfig } from "./audio-config";
import { AudioGapsProcessor } from "./media/processors/audio-gaps-processor";
import { NimioTransport } from "./nimio-transport";
import { NimioRenditions } from "./nimio-renditions";
import { NimioAbr } from "./nimio-abr";
import { MetricsManager } from "./metrics/manager";
import LoggersFactory from "./shared/logger";

export default class Nimio {
  constructor(options) {
    if (options && !options.instanceName) {
      options.instanceName = "nimio_" + (Math.floor(Math.random() * 1000) + 1);
    }
    this._instName = options.instanceName;

    this._config = createConfig(options);
    this._logger = LoggersFactory.create(this._instName, "Nimio");
    this._logger.debug("Nimio " + this.version());

    const idxCount = Object.values(IDX).reduce((total, val) => {
      total += Array.isArray(val) ? val.length : 1;
      return total;
    }, 0);

    this._sab = new SharedArrayBuffer(Uint32Array.BYTES_PER_ELEMENT * idxCount);
    this._state = new StateManager(this._sab);
    this._state.stop();

    this._bufferSec = Math.ceil((this._config.fullBufferMs + 200) / 1000);
    this._videoBuffer = new FrameBuffer(this._instName, "Video", 1000);
    this._tempBuffer = new FrameBuffer(this._instName, "Temp", 1000);
    this._noVideo = this._config.audioOnly;
    this._noAudio = this._config.videoOnly;
    if (this._noVideo && this._noAudio) {
      this._config.videoOnly = this._config.audioOnly = false;
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

    this._metricsManager = MetricsManager.getInstance(this._instName);
    if (this._config.metricsOverlay) {
      this._debugView = this._ui.appendDebugOverlay(
        this._state,
        this._videoBuffer,
      );
    }

    this._renderVideoFrame = this._renderVideoFrame.bind(this);
    this._firstFrameTsUs = 0;

    this._ctx = this._ui.getCanvas().getContext("2d");

    this._decoderFlows = { video: null, audio: null };
    this._initTransport(this._instName, wsTransportUrl);
    this._context = PlaybackContext.getInstance(this._instName);
    this._sldpManager = new SLDPManager(this._instName);
    this._sldpManager.init(this._transport, this._config);

    this._audioWorkletReady = null;
    this._audioConfig = new AudioConfig(48000, 1, 1024); // default values
    this._createAbrController();

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
    if (this._isAutoAbr()) this._abrController.start();

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
    if (this._isAutoAbr()) this._abrController.stop();
    this._pauseTimeoutId = setTimeout(() => {
      this._logger.debug("Auto stop");
      this.stop(true); // TODO: check possibility to reuse socket
    }, this._config.pauseTimeout);
  }

  stop(closeConnection) {
    this._state.stop();
    if (this._isAutoAbr()) {
      this._abrController.stop({hard: true});
    }

    this._sldpManager.stop(!!closeConnection);
    if (this._debugView) {
      this._debugView.stop();
    }

    this._videoBuffer.reset();
    this._noVideo = false;

    this._stopAudio();
    if (this._audioBuffer) {
      this._audioBuffer.reset();
    }

    if (this._nextRenditionData) {
      if (this._nextRenditionData.decoderFlow) {
        this._nextRenditionData.decoderFlow.destroy();
      }
      this._nextRenditionData = null;
    }

    ["video", "audio"].forEach((type) => {
      if (this._decoderFlows[type]) {
        this._decoderFlows[type].destroy();
        this._decoderFlows[type] = null;
      }
    });

    this._state.setPlaybackStartTsUs(0);
    this._state.resetCurrentTsUs();
    this._firstFrameTsUs = 0;

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

  _renderVideoFrame() {
    if (!this._noVideo && this._state.isPlaying()) {
      requestAnimationFrame(this._renderVideoFrame);
      if (null === this._audioWorkletReady || 0 === this._firstFrameTsUs) {
        return true;
      }

      let curTsUs = this._audioConfig.smpCntToTsUs(
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

        if (this._isAutoAbr()) {
          let curTimeMs = performance.now();
          if (
            this._lastBufReportMs > 0 &&
            curTimeMs - this._lastBufReportMs >= 100
          ) {
            this._reportBufferLevel(availableMs);
            this._lastBufReportMs = curTimeMs;
          }
        }
      }
    }
  }

  _createMainDecoderFlow(type, data) {
    let flowClass = type === "video" ? DecoderFlowVideo : DecoderFlowAudio;
    this._decoderFlows[type] = new flowClass(
      this._config.instanceName,
      data.trackId,
      data.timescale,
    );

    let decoderFlow = this._decoderFlows[type];
    decoderFlow.onStartTsNotSet =
      type === "video"
        ? this._onVideoStartTsNotSet.bind(this)
        : this._onAudioStartTsNotSet.bind(this);
    decoderFlow.onDecodingError = this._onDecodingError.bind(this);
    if (this._config.adaptiveBitrate) {
      decoderFlow.onSwitchResult = (done) => {
        this._onRenditionSwitchResult(type, done);
      };
      decoderFlow.onInputCancel = () => {
        this._sldpManager.cancelStream(decoderFlow.trackId);
      };
    }
    decoderFlow.setConfig(data.config);
  }

  _createNextRenditionFlow(type, data) {
    let flowClass = type === "video" ? DecoderFlowVideo : DecoderFlowAudio;
    this._nextRenditionData.decoderFlow = new flowClass(
      this._config.instanceName,
      data.trackId,
      data.timescale,
    );
    this._nextRenditionData.decoderFlow.onInputCancel = () => {
      this._sldpManager.cancelStream(data.trackId);
    };
    this._nextRenditionData.decoderFlow.setConfig(data.config);
  }

  _isNextRenditionTrack(trackId) {
    return (
      this._nextRenditionData && this._nextRenditionData.trackId === trackId
    );
  }

  _onRenditionSwitchResult(type, done) {
    if (done) {
      this._context.setCurrentStream(
        type,
        this._nextRenditionData.idx,
        this._nextRenditionData.trackId,
      );
    }
    let nextId = this._nextRenditionData.idx + 1;
    this._nextRenditionData = null;
    if (this._isAutoAbr()) {
      this._abrController.restart(true);
    }

    this._logger.debug(
      `${type} rendition switch to ID ${nextId} ${done ? "completed successfully" : "failed"}`,
    );
  }

  async _onVideoStartTsNotSet(frame) {
    if (this._firstFrameTsUs !== 0) return true;

    if (this._noAudio || this._videoBuffer.getTimeCapacity() >= 0.5) {
      this._firstFrameTsUs =
        this._videoBuffer.length > 0
          ? this._videoBuffer.firstFrameTs
          : frame.timestamp;
      this._state.setPlaybackStartTsUs(this._firstFrameTsUs);

      if (!this._noAudio) {
        await this._startNoAudioMode();
      }
    }

    return true;
  }

  async _onAudioStartTsNotSet(frame) {
    // create AudioContext with correct sampleRate on first frame
    await this._initAudioContext(frame.sampleRate, frame.numberOfChannels);

    if (!this._audioContext || !this._audioNode) {
      this._logger.error("Audio context is not initialized. Can't play audio.");
      return false;
    }

    if (this._firstFrameTsUs === 0) {
      this._firstFrameTsUs = frame.rawTimestamp;
      this._state.setPlaybackStartTsUs(frame.rawTimestamp);
    }

    return true;
  }

  _onDecodingError(kind) {
    // TODO: show error message in UI
    if (kind === "video") this._noVideo = true;
    if (kind === "audio") this._noAudio = true;

    if (this._noVideo && this._noAudio) {
      this.stop(true);
    }
  }

  _prepareAudioOutput(config) {
    if (!config) {
      if (!this._noAudio) {
        this._startNoAudioMode();
      }
      return false;
    }

    if (this._noAudio) {
      // Stop no audio mode if it was started previously
      this._stopAudio();
    }

    this._audioBuffer = WritableAudioBuffer.allocate(
      this._bufferSec * 5, // reserve 5 times buffer size for development (TODO: reduce later)
      config.sampleRate,
      config.numberOfChannels,
      config.sampleCount,
    );

    this._audioBuffer.addPreprocessor(
      new AudioGapsProcessor(
        this._audioConfig.sampleCount,
        this._audioConfig.sampleRate,
      ),
    );

    return true;
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
      procOptions.sampleCount = this._audioConfig.sampleCount;
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

  async _startNoAudioMode() {
    await this._initAudioContext(48000, 1, true);
    this._noAudio = true;
    this._logger.debug("No audio mode started");
  }

  _stopAudio() {
    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = this._audioNode = this._audioWorkletReady = null;
    }
    this._noAudio = false;
  }

  _reportBufferLevel(ms) {
    let trackId = this._decoderFlows["video"].trackId;
    this._metricsManager.reportBufLevel(trackId, ms / 1000);
    if (ms < this._lowBufferMs) {
      this._metricsManager.reportLowBuffer(trackId);
    }
  }
}

Object.assign(Nimio.prototype, EventMixin);
Object.assign(Nimio.prototype, NimioTransport);
Object.assign(Nimio.prototype, NimioRenditions);
Object.assign(Nimio.prototype, NimioAbr);