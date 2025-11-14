import { LoggersFactory } from "@/shared/logger";
import { MeanValue } from "@/shared/mean-value";
import { currentTimeGetterMs } from "./shared/helpers";

export class LatencyController {
  constructor(instName, stateMgr, audioConfig, params) {
    this._instName = instName;
    this._stateMgr = stateMgr;
    this._audioConfig = audioConfig;
    this._params = params;
    this._meanAvailableUs = new MeanValue(500);

    this.reset();

    this._startThreshUs = this._startingBufferLevel();
    this._minThreshUs = 50_000; // 50ms
    this._hysteresis = this._latencyMs < 1000 ? 1.5 : 1.25;
    this._subHysteresis = this._latencyMs < 1000 ? 0.8 : 0.9;

    this._getCurTimeMs = currentTimeGetterMs();

    this._logger = LoggersFactory.create(instName, "Latency ctrl", params.port);
    this._logger.debug(
      `initialized: latency=${this._latencyMs}ms, start threshold=${this._startThreshUs}us, video=${this._video}, audio=${this._audio}`,
    );
  }

  reset() {
    this._startTsUs = 0;
    this._availableUs = 0;
    this._prevVideoTime = 0;
    this._meanAvailableUs.reset();

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
    let res = Number.MAX_VALUE;
    const isVideo = type === "video" || !type;
    if (isVideo) {
      if (!this._video) return 0;
      if (this._videoAvailUs === undefined) this._getVideoAvailableUs();
      res = this._videoAvailUs;
    }
    const isAudio = type === "audio" || !type;
    if (isAudio) {
      if (!this._audio) return 0;
      if (this._audioAvailUs === undefined) this._getAudioAvailableUs();
      res = Math.min(res, this._audioAvailUs);
    }

    return (res / 1000 + 0.5) >>> 0;
  }

  incAudioSamples(sampleCount) {
    this._calculateAvailable();
    if (this._checkPending()) return this._curTsUs;

    this._stateMgr.incCurrentTsSmp(sampleCount);
    this._adjustPlaybackLatency();

    return this._curTsUs;
  }

  incCurrentVideoTime(speed) {
    this._calculateAvailable();
    let prevVideoTime = this._prevVideoTime;
    this._prevVideoTime = performance.now();
    if (this._checkPending() || prevVideoTime === 0) {
      return this._curTsUs;
    }

    let timeUsPast = (performance.now() - prevVideoTime) * speed * 1000;
    this._stateMgr.incCurrentTsSmp(this._audioConfig.tsUsToSmpCnt(timeUsPast));
    this._adjustPlaybackLatency();

    return this._curTsUs;
  }

  getCurrentTsUs() {
    this._calculateAvailable();
    this._checkPending();

    return this._curTsUs;
  }

  isPending() {
    return this.isUnderrun() || this.isStarting();
  }

  isStarting() {
    return this._startThreshUs > 0 && this._availableUs <= this._startThreshUs;
  }

  isUnderrun() {
    return this._availableUs <= this._minThreshUs;
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

  _checkPending() {
    if (this.isUnderrun() && this._startThreshUs === 0) {
      this._logger.debug(
        `Buffer is underrun, set starting threshold. Available ms=${this._availableUs / 1000}`,
      );
      this._startThreshUs = this._startingBufferLevel();
    }

    let res = this.isStarting();
    if (!res && this._startThreshUs > 0) {
      this._logger.debug(
        `Buffer is full, starting. Available ms=${this._availableUs / 1000}`,
      );
      this._startThreshUs = 0;
    }
    return res;
  }

  _calculateAvailable() {
    this._getCurrentTsUs();

    this._availableUs = Number.MAX_VALUE;
    if (this._audio) {
      this._getAudioAvailableUs();
      let availableMs = (this._audioAvailUs / 1000 + 0.5) >>> 0;
      this._stateMgr.setAvailableAudioMs(availableMs);
      this._availableUs = this._audioAvailUs;
    }
    if (this._video) {
      this._getVideoAvailableUs();
      let availableMs = (this._videoAvailUs / 1000 + 0.5) >>> 0;
      this._stateMgr.setAvailableVideoMs(availableMs);
      this._availableUs = Math.min(this._availableUs, this._videoAvailUs);
    }

    this._meanAvailableUs.add(this._availableUs);
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


  _seek(distUs) {
    if (distUs <= 0) return;

    let tNow = this._getCurTimeMs();
    // if (speed > this._speed) {
    if (this._lastSeekTime > 0 && tNow - this._lastSeekTime < 3000) return;
    // }
    this._lastSeekTime = tNow;

    this._logger.debug(`Seek forward by ${distUs / 1000}ms, cur bufer ms=${this._availableUs / 1000}`);
    this._stateMgr.incCurrentTsSmp(this._audioConfig.tsUsToSmpCnt(distUs));
    if (this._video) this._videoAvailUs -= distUs;
    if (this._audio) this._audioAvailUs -= distUs;
    this._availableUs -= distUs;
  }

  _adjustPlaybackLatency() {
    let availableMs = this._meanAvailableUs.get() / 1000;
    if (availableMs <= this._latencyMs * this._subHysteresis) {
      // this._setSpeed(1.0, availableMs);
    } else if (availableMs > this._latencyMs * this._hysteresis) {
      // this._setSpeed(1.1, availableMs); // speed boost
      this._seek((availableMs - this._latencyMs) * 1000);
      // this._meanAvailableUs.reset();
    }
  }

  _startingBufferLevel() {
    return 0.98 * this._latencyMs * 1000;
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
