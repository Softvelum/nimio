import { LoggersFactory } from "@/shared/logger";
import { RingBuffer } from "@/shared/ring-buffer";
import { mean } from "@/shared/helpers";

export class LatencyController {
  constructor(instName, stateMgr, audioConfig, params) {
    this._instName = instName;
    this._stateMgr = stateMgr;
    this._audioConfig = audioConfig;
    this._params = params;

    this._availables = new RingBuffer(`${instName} latency ctrl`, 6);

    this.reset();

    this._startThreshUs = this._startingBufferLevel();
    this._minThreshUs = 0.25 * this._latencyMs * 1000;
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
    this._availables.reset();

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
      this._startThreshUs = this._startingBufferLevel();
    }
    let res = this.isStarting();
    if (!res) this._startThreshUs = 0;
    return res;
  }

  _calculateAvailable() {
    this._getCurrentTsUs();

    let availableMs = Number.MAX_VALUE;
    if (this._audio) {
      this._getAudioAvailableUs();
      availableMs = (this._audioAvailUs / 1000 + 0.5) >>> 0;
      this._stateMgr.setAvailableAudioMs(availableMs);
      this._availableUs = this._audioAvailUs;
    }
    if (this._video) {
      this._getVideoAvailableUs();
      availableMs = (this._videoAvailUs / 1000 + 0.5) >>> 0;
      this._stateMgr.setAvailableVideoMs(availableMs);
      this._availableUs = Math.min(this._availableUs, this._videoAvailUs);
    }

    this._availables.push(this._availableUs, true);
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

  _adjustPlaybackLatency() {
    let availableMs = mean(this._availables) / 1000;
    if (availableMs <= this._latencyMs) {
      if (this._speed !== 1) {
        this._logger.debug("avails1", this._availables.toArray());
      }
      this._setSpeed(1.0, availableMs);
      this._speed = 1;
    } else if (availableMs > this._latencyMs * this._hysteresis) {
      if (this._speed !== 1.1) {
        this._logger.debug("avails2", this._availables.toArray());
      }
      this._setSpeed(1.1, availableMs); // speed boost
      this._speed = 1.1;
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
