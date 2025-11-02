import { LoggersFactory } from "./shared/logger";

export class LatencyController {
  constructor(instName, stateMgr, audioConfig, params) {
    this._instName = instName;
    this._stateMgr = stateMgr;
    this._audioConfig = audioConfig;
    this._params = params;

    this.reset();

    this._startThreshUs = this._latencyMs * 1000;
    this._minThreshUs = 0.1 * this._startThreshUs;
    this._hysteresis = this._latencyMs < 1000 ? 1.5 : 1.2;

    this._logger = LoggersFactory.create(instName, "Latency ctrl", params.port);
    this._logger.debug(
      `initialized: latency=${this._latencyMs}ms, start threshold=${this._startThreshUs}us, video=${this._video}, audio=${this._audio}`,  
    );
  }

  reset() {
    this._startTsUs = 0;
    this._availableUs = 0;
    this._prevVideoTime = 0;

    this._audioAvailUs = this._videoAvailUs = undefined;

    this._audio = !!this._params.audio;
    this._video = !!this._params.video;
    this._latencyMs = this._params.latency;
  }

  start() {
    if (this._pauseTime > 0) {
      let pauseDuration = performance.now() - this._pauseTime;
      this._prevVideoTime += pauseDuration;
      this._pauseTime = 0;
    }
  }

  pause() {
    this._pauseTime = performance.now();
  }

  availableMs(type) {
    const isVideo = type === "video";
    if (isVideo && this._video && this._videoAvailUs === undefined) {
      this._getVideoAvailableUs();
    }
    if (!isVideo && this._audio && this._audioAvailUs === undefined) {
      this._getAudioAvailableUs();
    }

    let res = isVideo ? this._videoAvailUs : this._audioAvailUs;
    return (res / 1000 + 0.5) >>> 0;
  }

  incAudioSamples(sampleCount) {
    this._calculateAvailable();
    if (this._startThreshUs > 0 && this._availableUs <= this._startThreshUs) {
      return this._curTsUs;
    }

    this._startThreshUs = 0;
    this._stateMgr.incCurrentTsSmp(sampleCount);
    this._adjustPlaybackLatency();

    return this._curTsUs;
  }

  incCurrentVideoTime(speed) {
    this._calculateAvailable();
    let prevVideoTime = this._prevVideoTime;
    this._prevVideoTime = performance.now();
    if (
      this._startThreshUs > 0 && this._availableUs <= this._startThreshUs ||
      prevVideoTime === 0
    ) {
      return this._curTsUs;
    }

    this._startThreshUs = 0;
    let timeUsPast = (performance.now() - prevVideoTime) * speed * 1000;
    this._stateMgr.incCurrentTsSmp(this._audioConfig.tsUsToSmpCnt(timeUsPast));
    this._adjustPlaybackLatency();

    return this._curTsUs;
  }

  getCurrentTsUs() {
    this._getCurrentTsUs();
    this._getVideoAvailableUs();

    return this._curTsUs;
  }

  _getCurrentTsUs() {
    if (this._startTsUs === 0) {
      this._startTsUs = this._stateMgr.getPlaybackStartTsUs();
    }

    let curSmpCnt = this._stateMgr.getCurrentTsSmp();
    this._curTsUs = this._audioConfig.smpCntToTsUs(curSmpCnt) + this._startTsUs;
  }

  _getVideoAvailableUs() {
    this._videoAvailUs = this._stateMgr.getVideoLatestTsUs() - this._curTsUs;
    if (this._videoAvailUs < 0) this._videoAvailUs = 0;
  }

  _getAudioAvailableUs() {
    this._audioAvailUs = this._stateMgr.getAudioLatestTsUs() - this._curTsUs;
    if (this._audioAvailUs < 0) this._audioAvailUs = 0;
  }

  _calculateAvailable() {
    this._getCurrentTsUs();

    let availableMs = 0;
    if (this._audio) {
      this._getAudioAvailableUs();
      availableMs = (this._audioAvailUs / 1000 + 0.5) >>> 0;
      this._stateMgr.setAvailableAudioMs(availableMs);
    }
    if (this._video) {
      this._getVideoAvailableUs();
      availableMs = (this._videoAvailUs / 1000 + 0.5) >>> 0;
      this._stateMgr.setAvailableVideoMs(availableMs);
    }
    if (this._video && this._audio) {
      this._availableUs = Math.min(this._audioAvailUs, this._videoAvailUs);
      // this._logger.debug(`Available ms: audio=${this._audioAvailUs / 1000}, video=${this._videoAvailUs / 1000}, used=${this._availableUs / 1000}`);
    } else if (this._audio) {
      this._availableUs = this._audioAvailUs;
    } else {
      this._availableUs = this._videoAvailUs;
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

  set videoEnabled(val) {
    this._video = val;
  }

  set audioEnabled(val) {
    this._audio = val;
  }

  _adjustPlaybackLatency() {
    let availableMs = this._availableUs / 1000;
    if (availableMs <= this._latencyMs) {
      this._setSpeed(1.0, availableMs);
    } else if (availableMs > this._latencyMs * this._hysteresis) {
      this._setSpeed(1.1, availableMs); // speed boost
    }
  }

  // _adjustPlaybackLatency(availableMs) {
  //   let targetLatencyMs = 1.1 * this._config.latency;
  //   if (availableMs > targetLatencyMs) {
  //     this._startTime -= availableMs - targetLatencyMs;
  //   } else if (availableMs < 0.2 * targetLatencyMs) {
  //     this._startTime += targetLatencyMs;
  //   }
  // }
}
