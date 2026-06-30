import { IDX, MODE, STATE } from "./shared/values";
import { StateManager } from "./state-manager";
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
import { MetricsManager } from "./metrics/manager";
import { LoggersFactory } from "./shared/logger";
import { AudioContextProvider } from "./audio/context-provider";
import { EventBus } from "./event-bus";
import { WorkletLogReceiver } from "./shared/worklet-log-receiver";
import { createSharedBuffer, isSharedBuffer } from "./shared/shared-buffer";
import { Reconnector } from "./reconnector";
import { SyncModeClock } from "./sync-mode/clock";
import { MediaGrabber } from "./grabber";
import { AdvertizerEvaluator } from "./advertizer/evaluator";


export class NimioLiveContext {
  constructor(instanceName, ui, config, sab) {
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
    this._sab = sab;
    this._sabShared = isSharedBuffer(sab);
    this._state = new StateManager(sab, { shared: this._sabShared });
    this._state.stop();
    this._audioConfig = new AudioConfig(48000, 1, 1024); // default values
    this._renderVideoFrame = this._renderVideoFrame.bind(this);
    this.onResponse = () => {};
    this._advertizerEval = new AdvertizerEvaluator(this._instName);
    this._createLatencyController();
    this._eventBus.on("transp:track-action", this.onTrackAction.bind(this));
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
    this._latencyCtrl.speedFn = this.setSpeed.bind(this);
  }

  updateAudioConfig(config) {
    this._audioConfig.updateFrom(config);
  }

  updateLatencyParams(params) {
    if (this.port) {
      this._messagePort.postMessage({
        type: "latency-params",
        data: params,
      });
    }
    this._latencyCtrl.setParams(params);
  }  


  play() {
    //if (this._state.isPlaying()) return;

    //const initialPlay = !this._state.isPaused();
    //this._cancelPauseTimeout();

    //this._state.start();
    this._latencyCtrl.start();
    // if (this._isAutoAbr()) {
    //   this._startAbrController();
    // }
    //this._eventBus.emit("nimio:play", { mode: MODE.LIVE });

    this._playbackStarted = false;
    requestAnimationFrame(this._renderVideoFrame);

    // this.notifyParent("play", {initialPlay: initialPlay})
    //
    // if (initialPlay) {
    //   this._sldpManager.start(this._config.streamUrl, this._config.startOffset);
    //   if (this._debugView) {
    //     this._debugView.start();
    //   }
    // } else if (this._audioCtxProvider.isSuspended()) {
    //   this._audioCtxProvider.get().resume();
    // }
  }

  pause() {
    // if (this._state.isPaused()) return;

    // this._state.pause();
    this._latencyCtrl.pause();
    // this._reconnect.stop();
    // this.notifyParent("pause", {})

    // this._eventBus.emit("nimio:pause", { mode: MODE.LIVE });
  }  

  stop(opts = {}) {
    // const isStopped = this._state.isStopped();
    // const closeConnection = !opts.keepConnection;
    // if (!isStopped || (closeConnection && this._transport.connected)) {
    //   this._sldpManager.stop({ closeConnection });
    // }
    // if (!sStopped) {
    //   this._state.stop();
    // }

    // this.notifyParent("stop", {wasStopped: isStopped, closeConnection: !!opts.closeConnection});

    // this._reconnect.reset();
    // if (this._debugView) this._debugView.stop();

    // if (this._isAutoAbr()) {
    //   this._abrController.stop({ hard: true });
    // }
    // this._resetPlayback();
    // this._grabber?.stop();

    // if (closeConnection) {
    //    this._eventBus.emit("nimio:playback-end", { mode: MODE.LIVE });
    // }
  }

  setSpeed(speed, availableMs) {
    if (this._speed === speed) return;
    this._speed = speed;
    this._logger.debug(`speed ${speed}`, availableMs);
  }

  setPlaybackStartTsUs(ts) {
    this._playbackStartTsUs = ts;
    this._state.setPlaybackStartTsUs(ts);
  }

  resetTimestamps() {
    this._state.setPlaybackStartTsUs(0);
    this._state.setVideoLatestTsUs(0);
    this._state.setAudioLatestTsUs(0);
    this._state.resetCurrentTsSmp();
  }

  resetPlayback() {
    this._latencyCtrl.reset();
    this._playbackStarted = false;
    this._advertizerEval.reset();
  }

  attachPort(port) {
    this._messagePort = port;
    if (!this._state.isShared()) {
      this._state.attachPort(this._audioNode.port);
    }
  }


  onAttach() {
    this._state.start();
    this._latencyCtrl.start();
    this._playbackStarted = false;
  }
  
  notifyParent(op, params) {
    this.onResponse(op, params);
  }

  _renderVideoFrame() {
    //this._noVideo
    if (!this._state.isPlaying()) return true; 

    requestAnimationFrame(this._renderVideoFrame);
    if (null === this._audioWorkletReady || 0 === this._playbackStartTsUs) {
      return true;
    }

    let curPlayedTsUs;
     if (this.isSuspended()) {
       curPlayedTsUs = this._latencyCtrl.incCurrentVideoTime(this._speed);
     } else {
      curPlayedTsUs = this._latencyCtrl.checkStateAndLoadCurrentTsUs();
    }
    this._updateBufferLevelMetrics();

    if (this._latencyCtrl.isPending()) {
      this._logger.debug("latencyCtrl isPending ")
      return true;
    }
    //this._logger.debug("drawFrame1")

    const frame = this.popVideoFrame(curPlayedTsUs);
    if (!frame) {
       //this._logger.debug(`No frame for ${curPlayedTsUs}, 1 frame=${this._videoBuffer.firstFrameTs}, last frame=${this._videoBuffer.lastFrameTs}, buffer length=${this._videoBuffer.length}`);
      return true;
    }

    if (!this._playbackStarted) {
      this._eventBus.emit("nimio:playback-start", { mode: MODE.LIVE });
      this._playbackStarted = true;
      this._grabber?.start(MODE.LIVE);
    }
    // if (this._offscreenCanvas) {
    //   this._ui.drawOffscreen(frame);
    //   return;
    // }
    this._ui.drawFrame(frame);
    if (this._grabber) {
      this._grabber.handleLiveFrame(frame);
    }
    frame.close();
  }

  popVideoFrame(ts) {
    return this.getFrame(ts)
  }

  _updateBufferLevelMetrics() {
    //TODO: pass to NimioLive 
  }

  sendPendingAdvertizerActions() {
    if (!this._advertizerEval.hasPendingActions()) return;
    const hdlr = (event) => {
      if (event.data != "transp-discont-eval-ready") return;
      let pa = this._advertizerEval.pendingActions;
      for (let i = 0; i < pa.length; i++) {
        this._messagePort.postMessage({
          type: "transp-track-action",
          data: pa[i],
        });
      }
      this._advertizerEval.clearPendingActions();
      this._messagePort.removeEventListener("message", hdlr);
    };
    this._messagePort.addEventListener("message", hdlr);
    
  }


  onTrackAction(data) {
    this._advertizerEval.handleAction(data);
    if (!this._messagePort) {
      this._advertizerEval.pendingActions.push(data);
      return;
    }

    this._messagePort.postMessage({ type: "transp-track-action", data });
  }
}