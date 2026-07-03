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
import { MediaGrabber } from "./grabber";
import { NimioLiveContext } from "./nimio-live-context";
import { NimioOffscreenWrapper } from "./nimio-offscreen-wrapper";

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
    const offscreen = !!this._config.offscreenCanvas;
    this._offscreenCanvas = offscreen;
    this._sab = createSharedBuffer(Uint32Array.BYTES_PER_ELEMENT * idxCount);
    const isShared = isSharedBuffer(this._sab);
    this._sabShared = isShared;
    this._state = new StateManager(this._sab, { shared: this._sabShared, name: "Live" });
    if (offscreen && !isShared) {
      this._liveContextChannel = new MessageChannel()
    }
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

    if (this._config.syncBuffer > 0) {
      this._createSyncModeParams();
    }

    if (offscreen) {
      this.setupOffscreenLiveContext(isShared);
    } else {
      this.setupLiveContext(isShared);
    }

    this._playCb = this.play.bind(this);
    if (this._config.autoplay) {
      setTimeout(this._playCb, 0);
      setTimeout(() => {
        if (this._ui) this._ui.hideControls(true);
      }, 1000);
    }

    if (this._config.screenshots) {
      this._createMediaGrabber(this._config.screenshots);
    }
  }

  setupLiveContext(isShared) {
    let ui = this.ui;
    this._liveContext = new NimioLiveContext(this._instName, config, isShared);
    this._liveContext.onResponse = this.handleLiveContext.bind(this);
    this._liveContext.getFrame = this.popFrameForTime.bind(this);
    this._liveContext.isSuspended = this.isSuspended.bind(this)
    this._liveContext.onDrawFrame = (frame) => ui.drawFrame(frame);
    this._state.stop();
  }

  setupOffscreenLiveContext(isShared) {
    let url = new URL("nimio-offscreen-renderer.js", import.meta.url);
    let worker = new Worker(url, { type: 'module' });
    this._offscreenRenderer = worker;
    this._liveContext = new NimioOffscreenWrapper(this._offscreenRenderer);
    const filteredConfig = JSON.parse(JSON.stringify(this._config));
    const msg = {
      type: "init",
      options: {
        instanceName: this._instName,
        config: filteredConfig,
        sab: this._sab
      }
    }
    worker.postMessage(msg);
    this._ui.setOffscreenWorker(worker);
    this._eventBus.on("transp:frame-decoded", (ev) => {
      if (ev.type == "video") {
        for (let i = 0; i < 3; i++) {
          const frame = this._videoBuffer.popFirstFrame();
          if (frame == null) break;
          const msg = {
            type: "videoFrame",
            frame: frame
          }
          worker.postMessage(msg, [frame]);
        }
      }
    })


    this._offscreenRenderer.onmessage = (ev) => {
      
      //TODO
      this.handleLiveContext()
    }

  }

  

  popFrameForTime(ts) {
    let frame = this._videoBuffer.popFrameForTime(ts);
    if (!frame) {
      this._logger.debug(`No frame for ${ts}, 1 frame=${this._videoBuffer.firstFrameTs}, last frame=${this._videoBuffer.lastFrameTs}, buffer length=${this._videoBuffer.length}`);
    }
    return frame;
  }

  isSuspended() {
    return this._audioCtxProvider.isSuspended()
  }


  handleLiveContext(cmd, params) {
     switch (cmd) {
       case "updateBufferLevel":
         this._updateBufferLevelMetrics(params);
        break;
     }
  }

  play() {
    if (this._state.isPlaying()) return;

    const initialPlay = !this._state.isPaused();
    this._cancelPauseTimeout();

    this._state.start();
    this._liveContext.play();
    if (this._isAutoAbr()) {
      this._startAbrController();
    }
    this._eventBus.emit("nimio:play", { mode: MODE.LIVE });

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
    this._liveContext.pause();
    this._reconnect.stop();
    if (this._isAutoAbr()) this._abrController.stop();
    this._pauseTimeoutId = setTimeout(() => {
      this._logger.debug("Auto stop");
      this.stop({ keepConnection: true });
      this._sldpManager.keepAliveConnection();
    }, this._config.pauseTimeout);

    this._eventBus.emit("nimio:pause", { mode: MODE.LIVE });
  }

  stop(opts = {}) {
    const isStopped = this._state.isStopped();
    const closeConnection = !opts.keepConnection;
    if (!isStopped || (closeConnection && this._transport.connected)) {
      this._sldpManager.stop({ closeConnection });
    }
    if (!isStopped) {
      this._state.stop();
    }

    this._reconnect.reset();
    if (this._debugView) this._debugView.stop();

    if (this._isAutoAbr()) {
       this._abrController.stop({ hard: true });
    }
    this._resetPlayback();
    this._grabber?.stop();
    if (closeConnection) {
      this._eventBus.emit("nimio:playback-end", { mode: MODE.LIVE });
    }    
    this._liveContext.stop();
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

    this._attachUI(ui);

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
    this._liveContext.onAttach();
    if (this._isAutoAbr()) {
      this._startAbrController();
    }
    //requestAnimationFrame(this._renderVideoFrame);

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
    this.stop({ keepConnection: true });
    this._sldpManager.keepAliveConnection();

    if (this._debugView) {
      this._debugView.clear();
    }
    this._detachUI();

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
    this.stop();
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
      this._liveContext.updateLatencyParams(latencyParams);
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

  getCaptionTracks() {
    if (!this._ui || !this._ui.captionController) return {};
    return this._ui.captionController.getCaptionTracks();
  }

  getCurrentCaptionTrack() {
    if (!this._ui || !this._ui.captionController) return {};
    return this._ui.captionController.getCurrentCaptionTrack();
  }

  setCaptionTrack(name) {
    if (!this._ui || !this._ui.captionController) return false;
    return this._ui.captionController.setCaptionTrack(name);
  }

  getCurrentTimestamp() {
    // if (this._audioCtxProvider.isSuspended()) {
    //   return this._latencyCtrl.getCurrentVideoTime();
    // } else {
    //   return this._latencyCtrl.getCurrentTsUs();
    // }
    // TODO: complete implementation of this method
    return 0;
  }

  _attachUI(ui) {
    this._ui = ui;
    this._ui.toggleMode(MODE.LIVE);
  }

  _detachUI() {
    this._ui.setDetached();
    this._ui = undefined;
  }

  _addUIEventHandlers() {
    this._eventBus.on("ui:play-pause-click", this._onPlayPauseClick);
    this._eventBus.on("ui:rendition-select", this._onRenditionChange);
  }

  _removeUIEventHandlers() {
    this._eventBus.off("ui:play-pause-click", this._onPlayPauseClick);
    this._eventBus.off("ui:rendition-select", this._onRenditionChange);
  }

  _onPlayPauseClick(data) {
    if (data.mode !== MODE.LIVE) return;
    data.play ? this.play() : this.pause();
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
    //this._liveContext.setPlaybackStartTsUs(this._playbackStartTsUs);
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

    this._stopAudio();
    this._vuMeterSvc.stop();
    this._noAudio = this._config.videoOnly;
    if (this._audioBuffer) {
      this._audioBuffer.reset();
      this._audioBuffer = null;
    }
    this._liveContext.resetPlayback();
    if (this._syncModeParams) this._syncModeParams = {};

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
    if (this._nalProcessor) this._nalProcessor.reset();

    this._grabber?.stop();

    //this._liveContext.resetTimestamps();
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
    if (kind === "audio") {
      if (!this._noVideo && this._playbackStartTsUs > 0) {
        // audio decoding failed after video started
        // start no audio mode to continue playback with video only
        this._startNoAudioMode();
      } else {
        this._setNoAudio();
      }
    }

    if (this._noVideo && this._noAudio) {
      this._eventBus.emit("aux:playback-error", {
        type: "NO_SRC",
        mode: MODE.LIVE,
        stop: true,
      });
      this.stop();
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
      let err;
      if (!this._audioContext) {
        err = "Audio context is not initialized. Can't play audio.";
      } else if (sampleRate !== this._audioContext.sampleRate) {
        err = `Unsupported sample rate ${sampleRate}, audio context has ${this._audioContext.sampleRate}`;
      } else if (!this._audioContext.audioWorklet) {
        err = "AudioWorklet is not supported in this environment";
      }
      if (err) {
        this._logger.error(err);
        this._setNoAudio();
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
      // if (this._liveContextChannel) {
      //   procOptions.auxPort = this._liveContextChannel.port1;
      // }
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
    if (this._audioBuffer && !this._audioBuffer.isShareable) {
      this._audioBuffer.setPort(this._audioNode.port);
    }
    this._state.attachPort(this._audioNode.port, this._liveContextChannel.port1);
    this._liveContext.attachPort(this._liveContextChannel.port2);

    this._audioNode.port.start();
    this._audioCtrl.connectSource(this._audioNode, channels);

    if (this._config.syncBuffer > 0) {
      let smc = new SyncModeClock(this._audioNode.port);
      await smc.sync();
      this._applySyncModeParams();
    }
    this._liveContext.sendPendingAdvertizerActions();

    if (this._vuMeterSvc.isInitialized() && !this._vuMeterSvc.isStarted()) {
      this._vuMeterSvc.start();
    }
  }

  _setNoVideo(yes) {
    if (yes === undefined) yes = true;
    this._noVideo = yes;
    this._liveContext.setNoVideo(yes);
  }

  _setNoAudio(yes) {
    if (yes === undefined) yes = true;
    this._noAudio = yes;
    this._liveContext.setNoAudio(yes);

    if (this._audioWorkletReady && this._audioNode) {
      this._audioNode.port.postMessage({
        type: "audio-status",
        data: { enabled: !yes },
      });
    }
    this._logger.debug("Set no audio:", yes);
  }

  async _startNoAudioMode() {
    this._setNoAudio();
    try {
      await this._initAudioProcessor(48000, 1, true);
    } catch (err) {
      this._logger.error("Failed to start no audio mode", err);
    }
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

  _updateBufferLevelMetrics(params) {
    if (this._isAutoAbr()) {
      let curTimeMs = performance.now();
      if (this._lastBufUpdMs > 0 && curTimeMs - this._lastBufUpdMs >= 100 && params.videoBuferLevel) {
        this._reportBufferLevel(params.videoBuferLevel);
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

  _createMediaGrabber(params) {
    this._grabber = MediaGrabber.getInstance(this._instName);
    const rate = params?.rate ?? -1;
    this._grabber.setRate(rate);
    this._grabber.onScreenshotReady((img, ts) => {
      this._eventBus.emit("nimio:screenshot", img, ts);
    });
  }
}

Object.assign(NimioLive.prototype, NimioTransport);
Object.assign(NimioLive.prototype, NimioRenditions);
Object.assign(NimioLive.prototype, NimioAbr);
Object.assign(NimioLive.prototype, NimioSyncMode);
