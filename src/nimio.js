import audioProcUrl from "./audio/nimio-processor?worker&url"; // ?worker&url - Vite initiate new Rollup build
import wsTransportUrl from "./transport/web-socket?worker&url";
import { IDX } from "./shared/values";
import { StateManager } from "./state-manager";
import { SLDPManager } from "./sldp/manager";
import { PlaybackContext } from "./playback/context";
import { Ui } from "./ui/ui";
import { FrameBuffer } from "./media/buffers/frame-buffer";
import { WritableAudioBuffer } from "./media/buffers/writable-audio-buffer";
import { DecoderFlowVideo } from "./media/decoders/flow-video";
import { DecoderFlowAudio } from "./media/decoders/flow-audio";
import { TimestampManager } from "./media/decoders/timestamp-manager";
import { createConfig } from "./player-config";
import { AudioConfig } from "./audio/config";
import { AudioGapsProcessor } from "./media/processors/audio-gaps-processor";
import { LatencyController } from "./latency-controller";
import { NimioTransport } from "./nimio-transport";
import { NimioRenditions } from "./nimio-renditions";
import { NimioAbr } from "./nimio-abr";
import { NimioVolume } from "./nimio-volume";
import { NimioEvents } from "./nimio-events";
import { MetricsManager } from "./metrics/manager";
import { LoggersFactory } from "./shared/logger";
import { AudioContextProvider } from "./audio/context-provider";
import { AudioGraphController } from "./audio/graph-controller";
import { AudioVolumeController } from "./audio/volume-controller";
import { ScriptPathProvider } from "./shared/script-path-provider";
import { EventBus } from "./event-bus";
import { WorkletLogReceiver } from "./shared/worklet-log-receiver";

let scriptPath;
if (document.currentScript === null) {
  // Javascript module
  scriptPath = import.meta.url;
} else if (document.currentScript) {
  // Javascript library
  scriptPath = document.currentScript.src;
}
if (scriptPath) {
  scriptPath = scriptPath.substr(0, scriptPath.lastIndexOf("/") + 1);
}

export default class Nimio {
  constructor(options) {
    if (options && !options.instanceName) {
      options.instanceName = "nimio_" + (Math.floor(Math.random() * 10000) + 1);
    }
    this._instName = options.instanceName;
    ScriptPathProvider.getInstance(this._instName).setScriptPath(scriptPath);

    this._config = createConfig(options);
    this._logger = LoggersFactory.create(this._instName, "Nimio");
    this._logger.debug("Nimio " + this.version());
    this._workletLogReceiver = new WorkletLogReceiver(this._config.workletLogs);

    this._eventBus = EventBus.getInstance(this._instName);

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
      this._logger.warn("Both video and audio only modes are set. Skipping.");
      this._config.videoOnly = this._config.audioOnly = false;
      this._noVideo = this._noAudio = false;
    }

    this._addUiEventHandlers();
    this._ui = new Ui(
      this._config.container,
      {
        width: this._config.width, //todo get from video?
        height: this._config.height,
        metricsOverlay: this._config.metricsOverlay,
        logger: LoggersFactory.create(this._instName, "Nimio UI"),
        autoAbr: !!this._config.adaptiveBitrate,
        fullscreen: !!this._config.fullscreen && !this._noVideo,
      },
      this._eventBus,
    );
    this._pauseTimeoutId = null;

    this._metricsManager = MetricsManager.getInstance(this._instName);
    if (this._config.metricsOverlay) {
      this._debugView = this._ui.appendDebugOverlay(
        this._state,
        this._videoBuffer,
      );
    }
    this._timestampManager = TimestampManager.getInstance(this._instName);
    this._timestampManager.init({
      dropZeroDurationFrames: this._config.dropZeroDurationFrames,
    });

    this._resetPlaybackTimstamps();
    this._renderVideoFrame = this._renderVideoFrame.bind(this);
    this._ctx = this._ui.canvas.getContext("2d");

    this._decoderFlows = { video: null, audio: null };
    this._initTransport(this._instName, wsTransportUrl);
    this._context = PlaybackContext.getInstance(this._instName);
    this._sldpManager = new SLDPManager(this._instName);
    this._sldpManager.init(this._transport, this._config);

    this._audioWorkletReady = null;
    this._audioConfig = new AudioConfig(48000, 1, 1024); // default values
    this._audioCtxProvider = AudioContextProvider.getInstance(this._instName);
    this._audioGraphCtrl = AudioGraphController.getInstance(this._instName);
    this._audioVolumeCtrl = AudioVolumeController.getInstance(this._instName);

    if (this._config.adaptiveBitrate) {
      this._createAbrController();
    }
    this._createVUMeter();

    this._createLatencyController();

    if (this._config.autoplay) {
      setTimeout(() => this.play(), 0);
      setTimeout(() => {
        this._ui.hideControls(true);
      }, 1000);
    }
  }

  play() {
    const initialPlay = !this._state.isPaused();

    if (this._pauseTimeoutId !== null) {
      clearTimeout(this._pauseTimeoutId);
      this._pauseTimeoutId = null;
    }

    this._state.start();
    this._latencyCtrl.start();
    if (this._isAutoAbr()) {
      this._startAbrController();
    }
    this._eventBus.emit("nimio:play", this._instName, this._config.container);

    requestAnimationFrame(this._renderVideoFrame);

    if (initialPlay) {
      this._sldpManager.start(this._config.streamUrl, this._config.startOffset);
      if (this._debugView) {
        this._debugView.start();
      }
    } else if (this._audioCtxProvider.isSuspended()) {
      this._audioCtxProvider.get().resume();
    }

    this._ui.drawPause();
  }

  pause() {
    this._state.pause();
    this._latencyCtrl.pause();
    if (this._isAutoAbr()) this._abrController.stop();
    this._pauseTimeoutId = setTimeout(() => {
      this._logger.debug("Auto stop");
      this.stop(true); // TODO: check possibility to reuse socket
    }, this._config.pauseTimeout);
  }

  stop(closeConnection) {
    this._state.stop();
    if (this._isAutoAbr()) {
      this._abrController.stop({ hard: true });
    }

    this._sldpManager.stop(!!closeConnection);
    if (this._debugView) {
      this._debugView.stop();
    }

    this._videoBuffer.reset();
    this._noVideo = this._config.audioOnly;

    this._stopAudio();
    this._noAudio = this._config.videoOnly;
    if (this._audioBuffer) {
      this._audioBuffer.reset();
    }
    this._latencyCtrl.reset();

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
    this._state.setVideoLatestTsUs(0);
    this._state.setAudioLatestTsUs(0);
    this._state.resetCurrentTsSmp();
    this._resetPlaybackTimstamps();

    this._ui.drawPlay();
    this._ctx.clearRect(0, 0, this._ctx.canvas.width, this._ctx.canvas.height);
    this._pauseTimeoutId = null;

    this._vuMeterSvc.stop();
    this._audioGraphCtrl.dismantle();
    this._audioCtxProvider.reset();
    this._workletLogReceiver.reset();
  }

  destroy() {
    this.stop(true);
    this._ui.destroy();
    this._vuMeterSvc.clear();
    this._removeUiEventHandlers();
  }

  version() {
    return __NIMIO_VERSION__;
  }

  static version() {
    return __NIMIO_VERSION__;
  }

  _addUiEventHandlers() {
    this._onPlayPauseClick = this._onPlayPauseClick.bind(this);
    this._onMuteUnmuteClick = this._onMuteUnmuteClick.bind(this);
    this._onVolumeChange = this._onVolumeChange.bind(this);
    this._onRenditionChange = this._onRenditionChange.bind(this);

    this._eventBus.on("ui:play-pause-click", this._onPlayPauseClick);
    this._eventBus.on("ui:mute-unmute-click", this._onMuteUnmuteClick);
    this._eventBus.on("ui:volume-change", this._onVolumeChange);
    this._eventBus.on("ui:rendition-change", this._onRenditionChange);
  }

  _removeUiEventHandlers() {
    this._eventBus.off("ui:play-pause-click", this._onPlayPauseClick);
    this._eventBus.off("ui:mute-unmute-click", this._onMuteUnmuteClick);
    this._eventBus.off("ui:volume-change", this._onVolumeChange);
    this._eventBus.off("ui:rendition-change", this._onRenditionChange);
  }

  _onPlayPauseClick = function (isPlayClicked) {
    isPlayClicked ? this.play() : this.pause();
  };

  _renderVideoFrame() {
    if (this._noVideo || !this._state.isPlaying()) return true;

    requestAnimationFrame(this._renderVideoFrame);
    if (null === this._audioWorkletReady || 0 === this._playbackStartTsUs) {
      return true;
    }

    let curPlayedTsUs;
    if (this._audioCtxProvider.isSuspended()) {
      curPlayedTsUs = this._latencyCtrl.incCurrentVideoTime(this._speed);
    } else {
      curPlayedTsUs = this._latencyCtrl.getCurrentTsUs();
    }
    this._updateBufferLevelMetrics();

    if (this._latencyCtrl.isPending()) return true;

    const frame = this._videoBuffer.popFrameForTime(curPlayedTsUs);
    if (!frame) {
      // this._logger.debug(`No frame for ${curPlayedTsUs}, 1 frame=${this._videoBuffer.firstFrameTs}, last frame=${this._videoBuffer.lastFrameTs}, buffer length=${this._videoBuffer.length}`);
      return true;
    }

    this._ctx.drawImage(
      frame,
      0,
      0,
      this._ctx.canvas.width,
      this._ctx.canvas.height,
    );
    frame.close();
  }

  // TODO: move this function with renderVideoFrame to a separate component
  _setSpeed(speed, availableMs) {
    if (this._speed === speed) return;
    this._speed = speed;
    this._logger.debug(`speed ${speed}`, availableMs);
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
    decoderFlow.onSwitchResult = (done) => {
      this._onRenditionSwitchResult(type, done);
    };
    decoderFlow.onInputCancel = () => {
      this._sldpManager.cancelStream(decoderFlow.trackId);
    };
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

  async _onVideoStartTsNotSet(frame) {
    if (this._playbackStartTsUs !== 0) return true;
    if (this._firstVideoFrameTsUs === 0) {
      this._firstVideoFrameTsUs = frame.timestamp;
      if (this._firstAudioFrameTsUs > 0) {
        this._setPlaybackStartTs();
        return true;
      }
    }

    if (this._noAudio || this._videoBuffer.getTimeCapacity() >= 0.5) {
      if (!this._audioContext) {
        this._setPlaybackStartTs("video");
      }

      if (!this._noAudio && this._audioCtxProvider.isRunning()) {
        await this._startNoAudioMode();
      }
    }

    return true;
  }

  async _onAudioStartTsNotSet(frame) {
    if (
      this._audioConfig.sampleRate !== frame.sampleRate ||
      this._audioConfig.numberOfChannels !== frame.numberOfChannels
    ) {
      this._logger.error(
        `Audio config (sampleRate=${this._audioConfig.sampleRate}, channels=${this._audioConfig.numberOfChannels}) differs from the actual (sampleRate=${frame.sampleRate}, channels=${frame.numberOfChannels}). Abort audio processor initialization.`,
      );
      return false;
    }

    // The following workaround is possible for the case when the ASC header contains channels count equal to 0,
    // which means that the channel layout should be taken from the PCE of the RAW AAC data.
    // if (this._audioConfig.numberOfChannels === 0) {
    //   this._audioConfig.numberOfChannels = frame.numberOfChannels;
    //   if (this._audioBuffer) this._audioBuffer.reset();
    //   if (!this._prepareAudioOutput(this._audioConfig.get())) {
    //     return false;
    //   }
    //   this._decoderFlows["audio"].setBuffer(this._audioBuffer, this._state);
    // }

    // create AudioContext with correct sampleRate on first frame
    await this._initAudioProcessor(frame.sampleRate, frame.numberOfChannels);

    if (!this._audioContext || !this._audioNode) {
      this._logger.error("Audio context is not initialized. Can't play audio.");
      this._audioContext = this._audioNode = null;
      return false;
    }

    if (this._firstAudioFrameTsUs === 0) {
      this._firstAudioFrameTsUs = frame.decTimestamp;
      if (this._firstVideoFrameTsUs) {
        this._setPlaybackStartTs();
      } else if (this._noVideo) {
        this._setPlaybackStartTs("audio");
      }
    }

    return true;
  }

  _setPlaybackStartTs(mode) {
    this._playbackStartTsUs =
      mode === "video" ? this._firstVideoFrameTsUs :
      mode === "audio" ? this._firstAudioFrameTsUs :
      Math.max(this._firstAudioFrameTsUs, this._firstVideoFrameTsUs);
    this._logger.warn(`set playback start ts us: ${this._playbackStartTsUs}, mode: ${mode}, video: ${this._firstVideoFrameTsUs}, audio: ${this._firstAudioFrameTsUs}`);
    this._state.setPlaybackStartTsUs(this._playbackStartTsUs);
  }

  _resetPlaybackTimstamps() {
    this._playbackStartTsUs = 0;
    this._firstAudioFrameTsUs = this._firstVideoFrameTsUs = 0;
  }

  _onDecodingError(kind) {
    // TODO: show error message in UI
    if (kind === "video") this._setNoVideo();
    if (kind === "audio") this._setNoAudio();

    if (this._noVideo && this._noAudio) {
      this.stop(true);
    }
  }

  _prepareAudioOutput(config) {
    this._logger.debug("prepareAudioOutput");
    if (!config || config.numberOfChannels < 1) {
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
      this._bufferSec * 2, // reserve 2 times buffer size for development (TODO: reduce later)
      config.sampleRate,
      config.numberOfChannels,
      config.sampleCount,
    );

    this._audioBuffer.addPreprocessor(
      new AudioGapsProcessor(
        this._audioConfig.sampleCount,
        this._audioConfig.sampleRate,
        this._logger,
      ),
    );

    return true;
  }

  async _initAudioProcessor(sampleRate, channels, idle) {
    if (!this._audioContext) {
      this._audioCtxProvider.init(sampleRate);
      this._audioCtxProvider.setChannelCount(channels);
      this._audioContext = this._audioCtxProvider.get();

      if (sampleRate !== this._audioContext.sampleRate) {
        this._logger.error(
          "Unsupported sample rate",
          sampleRate,
          this._audioContext.sampleRate,
        );
      }

      // load processor
      this._audioWorkletReady = this._audioContext.audioWorklet
        .addModule(audioProcUrl)
        .catch((err) => {
          this._logger.error("Audio worklet error", err);
        });

      this._vuMeterSvc.setAudioInfo({ sampleRate, channels });
    }

    await this._audioWorkletReady;
    if (this._audioNode) return;

    let procOptions = {
      instanceName: this._config.instanceName,
      sampleRate: sampleRate,
      stateSab: this._sab,
      latency: this._config.latency,
      idle: idle || false,
      videoEnabled: !this._noVideo,
      logLevel: this._config.logLevel,
      enableLogs: this._config.workletLogs,
    };

    if (!idle && this._audioBuffer) {
      procOptions.sampleCount = this._audioConfig.sampleCount;
      procOptions.audioSab = this._audioBuffer.buffer;
      procOptions.capacity = this._audioBuffer.bufferCapacity;
    }

    this._audioNode = new AudioWorkletNode(
      this._audioContext,
      "audio-nimio-processor",
      {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [channels],
        processorOptions: procOptions,
      },
    );
    this._workletLogReceiver.add(this._audioNode);

    this._audioVolumeCtrl.init(this._config);
    this._audioGraphCtrl.setSource(this._audioNode, channels);
    let vIdx = this._audioGraphCtrl.appendNode(this._audioVolumeCtrl.node);
    this._audioGraphCtrl.assemble(["src", vIdx], [vIdx, "dst"]);
    if (this._audioCtxProvider.isSuspended()) {
      this._audioContext.resume();
    }

    if (this._vuMeterSvc.isInitialized() && !this._vuMeterSvc.isStarted()) {
      this._vuMeterSvc.start();
    }
  }

  _setNoVideo(yes) {
    if (yes === undefined) yes = true;
    this._noVideo = !!yes;
    this._latencyCtrl.videoEnabled = !yes;
  }

  _setNoAudio(yes) {
    if (yes === undefined) yes = true;
    this._noAudio = !!yes;
    this._latencyCtrl.audioEnabled = !yes;
  }

  async _startNoAudioMode() {
    this._setNoAudio();
    await this._initAudioProcessor(48000, 1, true);
    this._logger.debug("No audio mode started");
  }

  _stopAudio() {
    this._logger.debug("stopAudio");
    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = this._audioNode = this._audioWorkletReady = null;
    }
    this._setNoAudio(false);
  }

  _updateBufferLevelMetrics() {
    if (this._isAutoAbr()) {
      let curTimeMs = performance.now();
      if (this._lastBufUpdMs > 0 && curTimeMs - this._lastBufUpdMs >= 100) {
        this._reportBufferLevel(this._latencyCtrl.availableMs("video"));
        this._lastBufUpdMs = curTimeMs;
      }
    }
  }

  _reportBufferLevel(ms) {
    let trackId = this._decoderFlows["video"].trackId;
    this._metricsManager.reportBufLevel(trackId, ms / 1000);
    if (ms < this._lowBufferMs) {
      this._metricsManager.reportLowBuffer(trackId);
    }
  }

  _createLatencyController() {
    this._latencyCtrl = new LatencyController(
      this._config.instanceName,
      this._state,
      this._audioConfig,
      {
        latency: this._config.latency,
        video: !this._noVideo,
        audio: !this._noAudio,
      },
    );
    this._speed = 1.0;
    this._latencyCtrl.speedFn = this._setSpeed.bind(this);
  }
}

Object.assign(Nimio.prototype, NimioEvents);
Object.assign(Nimio.prototype, NimioTransport);
Object.assign(Nimio.prototype, NimioRenditions);
Object.assign(Nimio.prototype, NimioAbr);
Object.assign(Nimio.prototype, NimioVolume);
