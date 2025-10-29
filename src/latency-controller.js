export class LatencyController {
  constructor(instName, stateMgr, audioConfig, latencyMs) {
    this._instName = instName;
    this._stateMgr = stateMgr;
    this._latencyMs = latencyMs;
    this._hysteresis = this._latencyMs < 1000 ? 1.5 : 1.2;

    this._audioConfig = audioConfig;
    this._startTsUs = 0;
    this._startThreshUs = this._latencyMs * 1000;
    this._minThreshUs = 0.1 * this._startThreshUs;

    this._audAvailableUs = 0;
    this._vidAvailableUs = 0;
  }

  incAudioSamples(sampleCount) {
    if (this._startTsUs === 0) {
      this._startTsUs = this._stateMgr.getPlaybackStartTsUs();
    }

    let curSmpCnt = this._stateMgr.incCurrentTsSmp(sampleCount);
    let curTsUs = this._audioConfig.smpCntToTsUs(curSmpCnt) + this._startTsUs;

    let lastTsUs = this._stateMgr.getAudioLatestTsUs();
    if (lastTsUs !== 0) {
      this._audAvailableUs = lastTsUs - curTsUs;
      if (this._audAvailableUs < 0) this._audAvailableUs = 0;
    }


    // this._startThreshold = 0;

    this._vidAvailableUs = this._stateMgr.getVideoLatestTsUs() - curTsUs;
    if (this._vidAvailableUs < 0) this._vidAvailableUs = 0;

    let availableMs = Math.min(this._audAvailableUs, vidAvailableUs) / 1000;
    this._controlPlaybackLatency(availableMs);
    this._stateMgr.setAvailableAudioMs((availableMs + 0.5) >>> 0);

    return this._audioConfig.smpCntToTsUs(curSmpCnt) + this._startTsUs;
  }

  isPending() {
    return (this._startTsUs === 0);
  }

  isFilling() {
    return this._audAvailableUs <= this._minThreshUs ||
    (this._startThreshUs > 0 && this._audAvailableUs <= this._startThreshUs);
  }

  _controlPlaybackLatency(availableMs) {
    if (availableMs <= this._latencyMs) {
      this._setSpeed(1.0);
    } else if (availableMs > this._latencyMs * this._hysteresis) {
      this._setSpeed(1.1); // speed boost
    }
    this._logger.debug("speed 1.0", availableMs, this._latencyMs);
  }
}
