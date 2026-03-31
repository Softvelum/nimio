import audioProcUrl from "./audio/nimio-processor?worker&url"; // ?worker&url - Vite initiate new Rollup build
import wsTransportUrl from "./transport/web-socket?worker&url";
import { IDX, MODE, STATE } from "./shared/values";
import { StateManager } from "./state-manager";
import { SLDPManager } from "./sldp/manager";
import { PlaybackContext } from "./playback/context";
import { FrameBuffer } from "./media/buffers/frame-buffer";
import { WritableAudioBuffer } from "./media/buffers/writable-audio-buffer";
import { WritableTransAudioBuffer } from "./media/buffers/writable-trans-audio-buffer";
import { DecoderFlowVideo } from "./media/decoders/flow-video";
import { DecoderFlowAudio } from "./media/decoders/flow-audio";
import { TimestampManager } from "./media/decoders/timestamp-manager";
import { AudioConfig } from "./audio/config";
import { AudioGapsProcessor } from "./media/processors/audio-gaps-processor";
import { LatencyController } from "./latency-controller";
import { NimioTransport } from "./nimio-transport";
import { NimioRenditions } from "./nimio-renditions";
import { NimioAbr } from "./nimio-abr";
import { NimioSyncMode } from "./nimio-sync-mode";
import { MetricsManager } from "./metrics/manager";
import { LoggersFactory } from "./shared/logger";
import { AudioContextProvider } from "./audio/context-provider";
import { EventBus } from "./event-bus";
import { WorkletLogReceiver } from "./shared/worklet-log-receiver";
import { createSharedBuffer, isSharedBuffer } from "./shared/shared-buffer";
import { Reconnector } from "./reconnector";
import { SyncModeClock } from "./sync-mode/clock";
import { AdvertizerEvaluator } from "./advertizer/evaluator";
import { VUMeterService } from "./vumeter/service";
import { AudioController } from "./audio/controller";

export class NimioLive {
  constructor(instanceName, ui, config) {
    this._instName = instanceName;
    this._config = config;
    this._ui = ui;

    this._logger = LoggersFactory.create(this._instName, "Nimio Live");
    this._workletLogReceiver = new WorkletLogReceiver(this._config.workletLogs);
    this._eventBus = EventBus.getInstance(this._instName);

    const idxCount = Object.values(IDX).reduce((total, val) => {
      total += Array.isArray(val) ? val.length : 1;
      return total;
    }, 0);
    this._sab = createSharedBuffer(Uint32Array.BYTES_PER_ELEMENT * idxCount);
    this._sabShared = isSharedBuffer(this._sab);
    this._state = new StateManager(this._sab, { shared: this._sabShared });
    this._state.stop();

    this._bufferSec = Math.ceil((this._config.fullBufferMs + 200) / 1000);
    this._videoBuffer = new FrameBuffer(this._instName, "Video", 1000);
    this._tempBuffer = new FrameBuffer(this._instName, "Temp", 1000);
    this._noVideo = this._config.audioOnly;
    this._noAudio = this._config.videoOnly;
    this._pauseTimeoutId = null;

    this._onPlayPauseClick = this._onPlayPauseClick.bind(this);
    this._onRenditionChange = this._onRenditionChange.bind(this);
    this._addUIEventHandlers();

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

    this._resetPlaybackTimestamps();
    this._renderVideoFrame = this._renderVideoFrame.bind(this);

    this._decoderFlows = { video: null, audio: null };
    this._initTransport(this._instName, wsTransportUrl);
    this._context = PlaybackContext.getInstance(this._instName);
    this._sldpManager = new SLDPManager(this._instName);
    this._sldpManager.init(this._transport, this._config);
    this._reconnect = new Reconnector(this._instName, this._config.reconnects);

    this._audioWorkletReady = null;
    this._audioConfig = new AudioConfig(48000, 1, 1024); // default values
    this._audioCtxProvider = AudioContextProvider.getInstance(this._instName);
    this._audioCtrl = AudioController.getInstance(this._instName);
    this._vuMeterSvc = VUMeterService.getInstance(this._instName);

    if (this._config.adaptiveBitrate) {
      this._createAbrController();
    }

    this._advertizerEval = new AdvertizerEvaluator(this._instName);
    this._createLatencyController();
    if (this._config.syncBuffer > 0) {
      this._createSyncModeParams();
    }

    this._playCb = this.play.bind(this);
    if (this._config.autoplay) {
      setTimeout(this._playCb, 0);
      setTimeout(() => {
        if (this._ui) this._ui.hideControls(true);
      }, 1000);
    }
  }

  play() {
    if (this._state.isPlaying()) return;

    const initialPlay = !this._state.isPaused();
    this._cancelPauseTimeout();

    this._state.start();
    this._latencyCtrl.start();
    if (this._isAutoAbr()) {
      this._startAbrController();
    }
    this._eventBus.emit("nimio:play", { mode: MODE.LIVE });

    this._playbackStarted = false;
    requestAnimationFrame(this._renderVideoFrame);

    if (initialPlay) {
      this._sldpManager.start(this._config.streamUrl, this._config.startOffset);
      if (this._debugView) {
        this._debugView.start();
      }
    } else if (this._audioCtxProvider.isSuspended()) {
      this._audioCtxProvider.get().resume();
    }
  }

  pause() {
    if (this._state.isPaused()) return;

    this._state.pause();
    this._latencyCtrl.pause();
    this._reconnect.stop();
    if (this._isAutoAbr()) this._abrController.stop();
    this._pauseTimeoutId = setTimeout(() => {
      this._logger.debug("Auto stop");
      this.stop(true); // TODO: check possibility to reuse socket
    }, this._config.pauseTimeout);

    this._eventBus.emit("nimio:pause", { mode: MODE.LIVE });
  }

  stop(closeConnection) {
    const isStopped = this._state.isStopped();
    if (!isStopped || (closeConnection && this._transport.connected)) {
      this._sldpManager.stop({ closeConnection });
    }
    if (isStopped) return;

    this._state.stop();
    this._reconnect.reset();
    if (this._debugView) this._debugView.stop();

    if (this._isAutoAbr()) {
      this._abrController.stop({ hard: true });
    }
    this._resetPlayback();

    this._eventBus.emit("nimio:playback-end", { mode: MODE.LIVE });
  }

  attachUI(ui) {
    this._ui = ui;
    this._ui.toggleMode(MODE.LIVE);
  }

  attach(ui, params) {
    if (this._ui) return false;

    if (!params) params = { latency: 0 };
    let latencyMs = params.latency * 1000;
    if (
      latencyMs > 0 &&
      !this._config.syncBuffer &&
      this._config.latency !== latencyMs
    ) {
      params.latency = latencyMs;
      if (this._config.latencyTolerance > 0) {
        let tolerDiff = this._config.latencyTolerance - this._config.latency;
        if (tolerDiff < 50) tolerDiff = 50;
        params.latencyTolerance = latencyMs + tolerDiff;
      }
      this.setParameters(params);
    }

    this.attachUI(ui);

    if (params.pbError) {
      // the stream isn't in fact discontinued, but it couldn't be played
      // via both live and vod players, so the error notification should be shown
      this._eventBus.emit("aux:playback-error", {
        type: "NO_SRC",
        mode: MODE.LIVE,
        stop: true,
      });

      return true;
    }

    this._state.start();
    this._latencyCtrl.start();
    if (this._isAutoAbr()) {
      this._startAbrController();
    }
    this._playbackStarted = false;
    requestAnimationFrame(this._renderVideoFrame);

    this._transport.connected && this._context.state?.value !== STATE.PAUSED
      ? this._sldpManager.requestCurrentStreams()
      : this._sldpManager.start(
          this._config.streamUrl,
          this._config.startOffset,
        );
    if (this._debugView) this._debugView.start();
    return true;
  }

  detach(callback) {
    if (!this._ui) {
      if (callback) callback();
      return false;
    }

    this._context.setState(this._state.value, false);
    this.stop();
    this._sldpManager.keepAliveConnection();

    if (this._debugView) {
      this._debugView.clear();
    }
    this._ui = undefined;

    if (callback) callback();

    return true;
  }

  goto(latencySec) {
    if (!latencySec) return false;

    let latencyMs = latencySec * 1000;
    if (this._config.syncBuffer > 0 || this._config.latency === latencyMs) {
      return false;
    }

    let params = { latency: latencyMs };
    if (this._config.latencyTolerance > 0) {
      let tolerDiff = this._config.latencyTolerance - this._config.latency;
      if (tolerDiff < 50) tolerDiff = 50;
      params.latencyTolerance = latencyMs + tolerDiff;
    }
    this.setParameters(params);

    return true;
  }

  destroy() {
    this.stop(true);
    this._removeUIEventHandlers();
  }

  setParameters(params) {
    let latencyParams = { count: 0 };
    for (let p in params) {
      switch (p) {
        case "latency":
          if (this._config.syncBuffer > 0) {
            this._logger.error(
              "Latency parameter can't be set if buffer synchronization is enabled",
            );
            break;
          }
          let latency = parseInt(params.latency);
          if (isNaN(latency) || latency < 0) {
            this._logger.error(
              "Latency parameter isn't a number or is negative. Skipping.",
            );
            break;
          }
          if (latency !== this._config.latency) {
            latencyParams.prevLatency = this._config.latency;
            latencyParams.latency = latency;
            latencyParams.count++;
            this._config.latency = latency;
          }
          break;
        case "latencyTolerance":
          if (this._config.syncBuffer > 0) {
            this._logger.error(
              "Latency tolerance can't be set if buffer synchronization is enabled",
            );
            break;
          }

          let latencyTolerance = parseInt(params.latencyTolerance);
          if (isNaN(latencyTolerance) || latencyTolerance < 0) {
            this._logger.error(
              "Latency tolerance isn\'t a number or is negative. Skipping.",
            );
            break;
          }

          if (
            latencyTolerance > 0 &&
            latencyTolerance < this._config.latency + 50
          ) {
            this._logger.warn(
              `Latency tolerance can't be less or too close to the latency parameter. Automatically adjusting latency tolerance to ${this._config.latency + 50}`,
            );
            latencyTolerance = this._config.latency + 50;
          }

          if (latencyTolerance !== this._config.latencyTolerance) {
            this._config.latencyTolerance = latencyTolerance;
            latencyParams.latencyTolerance = latencyTolerance;
            latencyParams.count++;
          }
          break;
        default:
          this._logger.warn(
            `Attempt to set not permitted parameter ${p} = ${params[p]}`,
          );
          break;
      }
    }
    if (latencyParams.count > 0) {
      this._updateLatencyParams(latencyParams);
      if (latencyParams.latency > 0 && this._abrController) {
        // TODO: update abr controller buffering with the new latency value
        if (
          this._config.latency >= latencyParams.prevLatency + 50 &&
          this._context.autoAbr
        ) {
          this._abrController.stop({ hard: true });
          this._abrController.start();
        }
        this._abrController.setBuffering(this._config.latency);
      }
    }
  }

  _addUIEventHandlers() {
    this._eventBus.on("ui:play-pause-click", this._onPlayPauseClick);
    this._eventBus.on("ui:rendition-select", this._onRenditionChange);
  }

  _removeUIEventHandlers() {
    this._eventBus.off("ui:play-pause-click", this._onPlayPauseClick);
    this._eventBus.off("ui:rendition-select", this._onRenditionChange);
  }

  _onPlayPauseClick = function (data) {
    if (data.mode !== MODE.LIVE) return;
    data.play ? this.play() : this.pause();
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
      curPlayedTsUs = this._latencyCtrl.loadCurrentTsUs();
    }
    this._updateBufferLevelMetrics();

    if (this._latencyCtrl.isPending()) return true;

    const frame = this._videoBuffer.popFrameForTime(curPlayedTsUs);
    if (!frame) {
      // this._logger.debug(`No frame for ${curPlayedTsUs}, 1 frame=${this._videoBuffer.firstFrameTs}, last frame=${this._videoBuffer.lastFrameTs}, buffer length=${this._videoBuffer.length}`);
      return true;
    }

    if (!this._playbackStarted) {
      this._eventBus.emit("nimio:playback-start", { mode: MODE.LIVE });
      this._playbackStarted = true;
    }
    this._ui.drawFrame(frame);
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
    decoderFlow.onSwitchResult = (done, msg) => {
      if (msg && !done) {
        this._logger.error(msg);
      }
      this._onRenditionSwitchResult(type, done);
    };
    decoderFlow.onInputCancel = () => {
      this._sldpManager.cancelStream(decoderFlow.trackId);
    };
    decoderFlow.setConfig(data.config);
    this._eventBus.emit("transp:track-action", {
      op: "main",
      id: data.trackId,
      type,
    });
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

    if (
      this._noAudio ||
      (!this._audioContext && this._videoBuffer.getTimeCapacity() >= 0.5)
    ) {
      this._setPlaybackStartTs("video");

      if (
        !this._noAudio &&
        !this._audioBuffer &&
        this._audioCtxProvider.isRunning()
      ) {
        // it doesn't make sense to start no audio mode via audio worklet
        // if audio context is suspended
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
    //   if (!this._prepareAudioOutput()) {
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
      mode === undefined
        ? Math.max(this._firstAudioFrameTsUs, this._firstVideoFrameTsUs)
        : mode === "video"
          ? this._firstVideoFrameTsUs
          : this._firstAudioFrameTsUs;
    this._logger.warn(
      `set playback start ts us: ${this._playbackStartTsUs}, mode: ${mode}, video: ${this._firstVideoFrameTsUs}, audio: ${this._firstAudioFrameTsUs}`,
    );
    this._state.setPlaybackStartTsUs(this._playbackStartTsUs);
  }

  _cancelPauseTimeout() {
    if (this._pauseTimeoutId === null) return;
    clearTimeout(this._pauseTimeoutId);
    this._pauseTimeoutId = null;
  }

  _resetPlayback() {
    this._ui.clear();
    this._videoBuffer.reset();
    this._noVideo = this._config.audioOnly;
    this._playbackStarted = false;

    this._stopAudio();
    this._vuMeterSvc.stop();
    this._noAudio = this._config.videoOnly;
    if (this._audioBuffer) {
      this._audioBuffer.reset();
      this._audioBuffer = null;
    }
    this._latencyCtrl.reset();
    if (this._syncModeParams) this._syncModeParams = {};
    this._advertizerEval.reset();

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
    this._resetPlaybackTimestamps();

    this._cancelPauseTimeout();
    this._workletLogReceiver.reset();
  }

  _resetPlaybackTimestamps() {
    this._playbackStartTsUs = 0;
    this._firstAudioFrameTsUs = this._firstVideoFrameTsUs = 0;
  }

  _onDecodingError(kind) {
    if (kind === "video") this._setNoVideo();
    if (kind === "audio") this._setNoAudio();

    if (this._noVideo && this._noAudio) {
      this._eventBus.emit("aux:playback-error", {
        type: "NO_SRC",
        mode: MODE.LIVE,
        stop: true,
      });
      this.stop(true);
    }
  }

  _prepareAudioOutput() {
    this._logger.debug("prepareAudioOutput");
    if (this._audioConfig.numberOfChannels < 1) {
      if (!this._noAudio) {
        this._startNoAudioMode();
      }
      return false;
    }

    if (this._noAudio) {
      // Stop no audio mode if it was started previously
      this._stopAudio();
    }

    if (!this._audioBuffer) {
      let AudioBufferClass = this._sabShared
        ? WritableAudioBuffer
        : WritableTransAudioBuffer;
      this._audioBuffer = AudioBufferClass.allocate(
        this._bufferSec * 6, // reserve 6 times buffer size for development (TODO: reduce later)
        this._audioConfig.sampleRate,
        this._audioConfig.numberOfChannels,
        this._audioConfig.sampleCount,
      );

      this._audioBuffer.addPreprocessor(
        new AudioGapsProcessor(
          this._audioConfig.sampleCount,
          this._audioConfig.sampleRate,
          this._logger,
        ),
      );
    }

    return true;
  }

  async _initAudioProcessor(sampleRate, channels, idle) {
    this._logger.debug(
      `Initialize audio processor, sampleRate=${sampleRate}, channels=${channels}, idle=${idle}, audio context exists=${!!this._audioContext}`,
    );

    if (!this._audioContext || this._audioContext.sampleRate !== sampleRate) {
      this._audioContext = this._audioCtrl.initContext(sampleRate, channels);
      if (!this._audioContext) {
        this._logger.error(
          "Audio context is not initialized. Can't play audio.",
        );
        this._setNoAudio(true);
        return;
      }

      if (sampleRate !== this._audioContext.sampleRate) {
        this._logger.error(
          "Unsupported sample rate",
          sampleRate,
          this._audioContext.sampleRate,
        );
      }

      if (!this._audioContext.audioWorklet) {
        this._logger.error("AudioWorklet is not supported in this environment");
        this._setNoAudio(true);
        return;
      }

      // load processor
      this._audioWorkletReady = this._audioContext.audioWorklet
        .addModule(audioProcUrl)
        .catch((err) => {
          this._logger.error("Audio worklet error", err);
        });

      this._audioCtrl.initVolume(this._config.volumeId, this._config.muted);
      this._vuMeterSvc.setAudioInfo({ sampleRate, channels });
    }

    await this._audioWorkletReady;
    if (this._audioNode) return;

    let procOptions = {
      instanceName: this._config.instanceName,
      sampleRate: sampleRate,
      stateSab: this._sab,
      stateSabShared: this._sabShared,
      latency: this._config.latency,
      latencyTolerance: this._config.latencyTolerance,
      latencyAdjustMethod: this._config.latencyAdjustMethod,
      idle: idle || false,
      videoEnabled: !this._noVideo,
      logLevel: this._config.logLevel,
      enableLogs: this._config.workletLogs,
    };

    if (!idle && this._audioBuffer) {
      procOptions.sampleCount = this._audioConfig.sampleCount;
      procOptions.capacity = this._audioBuffer.bufferCapacity;
      if (this._audioBuffer.isShareable) {
        procOptions.audioSab = this._audioBuffer.buffer;
      }
      if (this._config.syncBuffer > 0) {
        procOptions.syncBuffer = this._config.syncBuffer;
      }
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

    this._audioNode.port.start();
    this._workletLogReceiver.add(this._audioNode);
    if (!this._state.isShared()) {
      this._state.attachPort(this._audioNode.port);
    }
    if (!procOptions.audioSab && this._audioBuffer) {
      this._audioBuffer.setPort(this._audioNode.port);
    }

    this._audioCtrl.setSource(this._audioNode, channels);

    if (this._config.syncBuffer > 0) {
      let smc = new SyncModeClock(this._audioNode.port);
      await smc.sync();
      this._applySyncModeParams();
    }
    this._sendPendingAdvertizerActions();

    if (this._vuMeterSvc.isInitialized() && !this._vuMeterSvc.isStarted()) {
      this._vuMeterSvc.start();
    }
  }

  _setNoVideo(yes) {
    if (yes === undefined) yes = true;
    this._noVideo = yes;
    this._latencyCtrl.videoEnabled = !yes;
  }

  _setNoAudio(yes) {
    if (yes === undefined) yes = true;
    this._noAudio = yes;
    this._latencyCtrl.audioEnabled = !yes;
    this._logger.debug("Set no audio:", yes);
  }

  async _startNoAudioMode() {
    this._setNoAudio();
    await this._initAudioProcessor(48000, 1, true);
    this._logger.debug("No audio mode started");
  }

  _stopAudio() {
    this._logger.debug("stopAudio");
    if (this._audioContext) {
      this._audioCtrl.reset();
      this._audioContext = this._audioNode = this._audioWorkletReady = null;
    }
    if (this._audioBuffer) {
      this._audioBuffer.reset();
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
      this._advertizerEval,
      {
        latency: this._config.latency,
        tolerance: this._config.latencyTolerance,
        adjustMethod: this._config.latencyAdjustMethod,
        video: !this._noVideo,
        audio: !this._noAudio,
        syncBuffer: this._config.syncBuffer,
      },
    );
    this._speed = 1;
    this._latencyCtrl.speedFn = this._setSpeed.bind(this);
  }

  _updateLatencyParams(params) {
    if (this._audioNode) {
      this._audioNode.port.postMessage({
        type: "latency-params",
        data: params,
      });
    }
    this._latencyCtrl.setParams(latencyParams);
  }
}

Object.assign(NimioLive.prototype, NimioTransport);
Object.assign(NimioLive.prototype, NimioRenditions);
Object.assign(NimioLive.prototype, NimioAbr);
Object.assign(NimioLive.prototype, NimioSyncMode);
