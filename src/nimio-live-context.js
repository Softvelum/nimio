import { IDX, MODE, STATE } from "./shared/values";
import { StateManager } from "./state-manager";
import { FrameBuffer } from "./media/buffers/frame-buffer";
import { DecoderFlowVideo } from "./media/decoders/flow-video";
import { AudioConfig } from "./audio/config";
import { LatencyController } from "./latency-controller";
import { LoggersFactory } from "./shared/logger";
import { EventBus } from "./event-bus";
import { WorkletLogReceiver } from "./shared/worklet-log-receiver";
import { createSharedBuffer, isSharedBuffer } from "./shared/shared-buffer";
import { Reconnector } from "./reconnector";
import { AdvertizerEvaluator } from "./advertizer/evaluator";

export class NimioLiveContext {
  constructor(instanceName, config, sab) {
    this._instName = instanceName;
    this._config = config;
    //this._ui = ui;

    this._logger = LoggersFactory.create(this._instName, "Nimio Live");
    this._workletLogReceiver = new WorkletLogReceiver(this._config.workletLogs);
    this._eventBus = EventBus.getInstance(this._instName);

    this._noVideo = config.audioOnly;
    this._noAudio = config.videoOnly;
    const idxCount = Object.values(IDX).reduce((total, val) => {
      total += Array.isArray(val) ? val.length : 1;
      return total;
    }, 0);
    this._sab = sab;
    this._sabShared = isSharedBuffer(sab);
    if (!this._sabShared) {
      const arrayCopy = new ArrayBuffer(sab.byteLength)
      this._sab = arrayCopy;
    }
    this._state = new StateManager(this._sab, {
      shared: this._sabShared, sendInit: false, name: "LiveContext" });
    this._state.stop();
    this._audioConfig = new AudioConfig(48000, 1, 1024); // default values
    this._renderVideoFrame = this._renderVideoFrame.bind(this);
    this.onResponse = () => {};
    this.onDrawFrame = () => {};
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
    if (this._messagePort) {
      this._messagePort.postMessage({
        type: "latency-params",
        data: params,
      });
    }
    this._latencyCtrl.setParams(params);
  }  


  play() {
    this._playbackStarted = false;
    requestAnimationFrame(this._renderVideoFrame);
  }

  pause() {
    this._latencyCtrl.pause();
  }  

  stop(opts = {}) {
  }

  setNoVideo(yes) {
    this._latencyCtrl.videoEnabled = !yes;
  }

  setNoAudio(yes) {
    this._latencyCtrl.audioEnabled = !yes;

  }

  setSpeed(speed, availableMs) {
    if (this._speed === speed) return;
    this._speed = speed;
    this._logger.debug(`speed ${speed}`, availableMs);
  }

  // setPlaybackStartTsUs(ts) {
  //   this._logger.debug("LiveContext: setPlaybackStartTsUs", ts);
  //   this._playbackStartTsUs = ts;
  //   this._state.setPlaybackStartTsUs(ts);
  // }

  resetTimestamps() {
    this._logger.debug("LiveContext: resetPlaybackStartTsUs");
    this._playbackStartTsUs = 0;
    this._state.setPlaybackStartTsUs(0);
    this._state.setVideoLatestTsUs(0);
    this._state.setAudioLatestTsUs(0);
    this._state.resetCurrentTsSmp();
  }

  resetPlayback() {
    this._latencyCtrl.reset();
    this._playbackStarted = false;
    this._advertizerEval.reset();
    this.resetTimestamps();
  }

  attachPort(port, auxPort) {
    this._messagePort = auxPort ?? port;
    if (!this._state.isShared()) {
      this._state.attachPort(port, auxPort);
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
    this._logger.debug(`renderVideoFrame ${this._noVideo} ${this._state.isPlaying()}`);
    //as[p're gjklofi0cm-,weas[ghrtyˆ∆ø¨≤kif (this._noVideo || !this._state.isPlaying()) return;

    requestAnimationFrame(this._renderVideoFrame);
    if (0 === this._playbackStartTsUs) {
      this._playbackStartTsUs = this._state.getPlaybackStartTsUs();
    }

    if (null === this._audioWorkletReady || 0 === this._playbackStartTsUs) {
      return true;
    }

    let curPlayedTsUs;
     //
     // if (this.isSuspended()) {
     //  curPlayedTsUs = this._latencyCtrl.incCurrentVideoTime(this._speed);
     //} else {
      curPlayedTsUs = this._latencyCtrl.checkStateAndLoadCurrentTsUs();
    //}
    this._updateBufferLevelMetrics();

    // if (this._latencyCtrl.isPending()) {
    //   return;
    // }

    const frame = this.popVideoFrame(curPlayedTsUs);
    if (!frame) {
      return;
    }

    this._logger.debug("drawFrame", frame.timestamp);

    if (!this._playbackStarted) {
      this._eventBus.emit("nimio:playback-start", { mode: MODE.LIVE });
      this._playbackStarted = true;
      this._grabber?.start(MODE.LIVE);
    }
    this.onDrawFrame(frame);
    if (this._grabber) {
      this._grabber.handleLiveFrame(frame);
    }
    frame.close();
  }

  popVideoFrame(ts) {
    return this.getFrame(ts)
  }

  _updateBufferLevelMetrics() {
    const level = this._latencyCtrl.availableMs("video")
    this.notifyParent("updateBufferLevel", {videoBuferLevel: level});
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

  stuffState(msg) {
    msg.type = "state:update";
    this._state._handlePortMessage({data: msg});
  }
}
