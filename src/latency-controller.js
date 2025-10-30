import { LoggersFactory } from "./shared/logger";

export class LatencyController {
  constructor(instName, stateMgr, audioConfig, params) {
    this._instName = instName;
    this._logger = LoggersFactory.create(instName, "Latency ctrl", params.port);
    this._stateMgr = stateMgr;
    this._latencyMs = params.latency;
    this._hysteresis = this._latencyMs < 1000 ? 1.5 : 1.2;

    this._audioConfig = audioConfig;
    this._startTsUs = 0;
    this._startThreshUs = this._latencyMs * 1000;
    this._minThreshUs = 0.1 * this._startThreshUs;


    this._audio = !!params.audio;
    this._video = !!params.video;
    this._availableUs = 0;

    this._logger.debug(
      `initialized: latency=${this._latencyMs}ms, start threshold=${this._startThreshUs}us, video=${this._video}, audio=${this._audio}`,  
    );
  }

  incAudioSamples(sampleCount) {
    this._calculateAvailable();
    if (this._startThreshUs > 0 && this._availableUs <= this._startThreshUs) {
      return this._curTsUs;
    }

    this._startThreshUs = 0;
    this._stateMgr.incCurrentTsSmp(sampleCount);
    this._controlPlaybackLatency(this._availableUs / 1000);

    return this._curTsUs;
  }

  checkCurrentVideoTime() {
    let expCurTime = performance.now() - this._latencyMs;
    if (this._startTsUs === 0) {
      this._startTsUs = this._stateMgr.getPlaybackStartTsUs();
    }
    let curTsUs = (expCurTime - this._firstFrameTime) * 1000;
    this._state.setCurrentTsSmp(this._audioConfig.tsUsToSmpCnt(curTsUs));
  }

  _calculateAvailable() {
    if (this._startTsUs === 0) {
      this._startTsUs = this._stateMgr.getPlaybackStartTsUs();
    }

    let curSmpCnt = this._stateMgr.getCurrentTsSmp();
    this._curTsUs = this._audioConfig.smpCntToTsUs(curSmpCnt) + this._startTsUs;

    let aAvailableUs, vAvailableUs;
    if (this._audio) {
      aAvailableUs = this._stateMgr.getAudioLatestTsUs() - this._curTsUs;
      if (aAvailableUs < 0) this._aAvailableUs = 0;
      this._stateMgr.setAvailableAudioMs((aAvailableUs / 1000 + 0.5) >>> 0);
    }
    if (this._video) {
      vAvailableUs = this._stateMgr.getVideoLatestTsUs() - this._curTsUs;
      if (vAvailableUs < 0) vAvailableUs = 0;
      this._stateMgr.setAvailableVideoMs((vAvailableUs / 1000 + 0.5) >>> 0);
    }
    if (this._video && this._audio) {
      this._availableUs = Math.min(aAvailableUs, vAvailableUs);
    } else if (this._audio) {
      this._availableUs = aAvailableUs;
    } else {
      this._availableUs = vAvailableUs;
    }
  }

  isPending() {
    return (this._startTsUs === 0);
  }

  isFilling() {
    return this._availableUs <= this._minThreshUs ||
    (this._startThreshUs > 0 && this._availableUs <= this._startThreshUs);
  }

  set speedFn(fn) {
    this._setSpeed = fn;
  }

  _controlPlaybackLatency(availableMs) {
    if (availableMs <= this._latencyMs) {
      this._setSpeed(1.0, availableMs);
    } else if (availableMs > this._latencyMs * this._hysteresis) {
      this._setSpeed(1.1, availableMs); // speed boost
    }
  }
}
