import { LatencyBufferMeter } from "@/latency/buffer-meter";
import { LoggersFactory } from "@/shared/logger";
import { currentTimeGetterMs } from "@/shared/helpers";
import { clamp } from "@/shared/helpers";
import { SyncModePolicy } from "./sync-mode/policy";

export class LatencyController {
  constructor(instName, stateMgr, audioConfig, params) {
    this._instName = instName;
    this._stateMgr = stateMgr;
    this._audioConfig = audioConfig;

    this._params = params;
    this._audio = !!this._params.audio;
    this._video = !!this._params.video;
    this._latencyMs = this._params.latency;

    this._shortWindowMs = 300;
    this._longWindowMs = 1500;
    this._bufferMeter = new LatencyBufferMeter(
      instName,
      this._shortWindowMs,
      this._longWindowMs,
    );

    this._startThreshUs = this._startingBufferLevel();
    this._minThreshUs = 50_000; // 50ms

    this._warmupMs = 3000;
    this._holdMs = 500;
    this._startHoldMs = 100;
    this._minRate = 0.9;
    this._minRateStep = 1 / 128;
    this._maxRate = 1.25;
    this._rateK = 0.00015; // proportional gain: rate = 1 + rateK * deltaMs
    this._rateK = 0.0002;

    this._minLatencyDelta = 40;
    this._allowedLatencyDelta = params.tolerance - this._latencyMs;
    if (this._allowedLatencyDelta < this._minLatencyDelta) {
      this._allowedLatencyDelta = this._minLatencyDelta;
    }
    this._minRateChangeIntervalMs = 500;
    this._minSeekIntervalMs = 4000; // don't seek more frequently

    this._getCurTimeMs = currentTimeGetterMs();
    this.reset();

    this._logger = LoggersFactory.create(instName, "Latency ctrl", params.port);
    this._latencyControlFn = this._adjustPlaybackLatency;
    this._adjustFn = params.adjustMethod === "seek" ? this._seek : this._zap;
    if (params.syncBuffer > 0) {
      this._latencyControlFn = this._syncPlaybackLatency;
      this._syncModePolicy = new SyncModePolicy(params.syncBuffer, params.port);
      this._syncModePolicy.logger = this._logger;
    }

    this._logger.debug(
      `initialized: latency=${this._latencyMs}ms, start threshold=${this._startThreshUs}us, video=${this._video}, audio=${this._audio}`,
    );
  }

  reset() {
    this._startTsUs = 0;
    this._availableUs = 0;
    this._prevVideoTime = 0;
    this._bufferMeter.reset();

    this._startTimeMs = -1;
    this._lastActionTime = -this._minSeekIntervalMs;
    this._audioAvailUs = this._videoAvailUs = undefined;
    this._pendingStableSince = null;
    this._restoreLatency = false;
  }

  start() {
    if (this._pauseTime > 0) {
      let pauseDuration = this._getCurTimeMs() - this._pauseTime;
      this._prevVideoTime += pauseDuration;
      this._pauseTime = 0;
    }
  }

  pause() {
    this._pauseTime = this._getCurTimeMs();
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

  incCurrentAudioSamples(sampleCount) {
    if (this.isPending()) return this._curTsUs;
    let samplesUs = this._audioConfig.smpCntToTsUs(sampleCount);
    this._moveCurrentPosition(samplesUs, sampleCount);
    this._latencyControlFn();

    return this._curTsUs;
  }

  incCurrentVideoTime(speed) {
    this._getCurrentTsUs();
    this._calculateAvailable();
    let prevVideoTime = this._prevVideoTime;
    this._prevVideoTime = this._getCurTimeMs();
    if (this._checkPending() || prevVideoTime === 0) {
      return this._curTsUs;
    }

    let timeUsPast = (this._getCurTimeMs() - prevVideoTime) * speed * 1000;
    this._moveCurrentPosition(timeUsPast);

    this._latencyControlFn();

    return this._curTsUs;
  }

  loadCurrentTsUs() {
    this._getCurrentTsUs();
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

  set syncModePtsOffset(val) {
    if (!this._syncModePolicy) {
      this._logger.error(
        "Attempt to set pts offset, while sync mode is disabled",
      );
      return;
    }
    this._syncModePolicy.ptsOffset = val;
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
      if (this._startTimeMs < 0) {
        this._startTimeMs = this._getCurTimeMs();
      }
    }
    return res;
  }

  _calculateAvailable() {
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

    // this._logger.debug(`Available ms=${this._availableUs / 1000}, start time=${this._startTimeMs}`);
    if (this._startTimeMs >= 0) {
      this._bufferMeter.update(this._availableUs / 1000, this._getCurTimeMs());
    }
  }

  _getCurrentTsUs() {
    if (this._startTsUs === 0) {
      this._startTsUs = this._stateMgr.getPlaybackStartTsUs();
    }

    let curSmpCnt = this._stateMgr.getCurrentTsSmp();
    this._curTsUs = this._audioConfig.smpCntToTsUs(curSmpCnt) + this._startTsUs;
    return this._curTsUs;
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
    if (this._startTimeMs < 0) return; // not started yet

    const now = this._getCurTimeMs();
    this._updateBufferLevels(now);

    const age = now - this._startTimeMs;
    const bufMin = age < this._warmupMs ? this._shortB : this._longB;
    const deltaMs = bufMin - this._latencyMs;
    // const stable = Math.abs(bufMin - bufEma) < (this._latencyMs * 0.1);

    if (deltaMs > this._allowedLatencyDelta) {
      this._restoreLatency = true;
    }

    let goMove = false;
    if (deltaMs > this._minLatencyDelta && this._restoreLatency) {
      // this._logger.debug(`Delta ms=${deltaMs}, buffer ms=${bufMin}, age ms=${age}`);
      // wait for holdMs to avoid acting on single spikes
      if (!this._pendingStableSince) {
        this._pendingStableSince = now;
      } else if (now - this._pendingStableSince > this._holdMs) {
        goMove = true;
      }
    } else {
      this._pendingStableSince = null;
      this._restoreLatency = false;
    }

    if (age < this._warmupMs / 2 && this._lastActionTime < 0) {
      // Do seek on startup if possible
      if (this._tryInitialSeek(deltaMs, bufMin, now)) return;
    }

    this._adjustFn(goMove, deltaMs, bufMin, now);
  }

  _syncPlaybackLatency() {
    if (this._startTimeMs < 0) return; // not started yet

    const now = this._getCurTimeMs();
    this._updateBufferLevels(now);

    let curTimeMs = this._curTsUs / 1000;
    let availMs = this._availableUs / 1000;
    let deltaMs = this._syncModePolicy.computeAdjustment(curTimeMs, availMs);

    if (Math.abs(deltaMs) >= 2000) {
      this._seek(true, deltaMs, availMs, now);
    } else {
      this._zap(deltaMs !== 0, deltaMs, availMs, now);
    }
  }

  _startingBufferLevel() {
    return 0.98 * this._latencyMs * 1000;
  }

  _tryInitialSeek(deltaMs, buf, now) {
    if (deltaMs > this._latencyMs) {
      let stableTime = now - this._pendingStableSince;
      if (stableTime >= this._startHoldMs) {
        this._seek(true, deltaMs, buf, now);
        return true;
      }
    }
    return false;
  }

  _zap(goMove, deltaMs, curBuf, now) {
    let rate = 1;
    if (goMove) {
      if (now - this._lastActionTime < this._minRateChangeIntervalMs) {
        return;
      }
      rate = clamp(1 + this._rateK * deltaMs, this._minRate, this._maxRate);
      if (deltaMs < -0.6) {
        rate = 0; // stop reading samples to adjust latency faster
      }
      this._lastActionTime = now;
    }
    if (Math.abs(rate - 1) < this._minRateStep) rate = 1; // snap

    if (goMove) {
      this._logger.debug(`Zap with rate = ${rate}, deltaMs = ${deltaMs}`);
    }
    this._setSpeed(rate, curBuf);
  }

  _seek(goMove, deltaMs, curBuf, now) {
    if (
      !goMove ||
      deltaMs === 0 ||
      now - this._lastActionTime < this._minSeekIntervalMs
    ) {
      return;
    }
    this._lastActionTime = now;
    this._logger.debug(`Seek by ${deltaMs}ms, cur bufer ms=${curBuf}`);

    this._moveCurrentPosition(deltaMs * 1000);
  }

  _moveCurrentPosition(deltaUs, deltaSmpCnt) {
    if (deltaSmpCnt === undefined) {
      deltaSmpCnt = this._audioConfig.tsUsToSmpCnt(deltaUs);
    }

    this._stateMgr.incCurrentTsSmp(deltaSmpCnt);
    if (this._video) this._videoAvailUs -= deltaUs;
    if (this._audio) this._audioAvailUs -= deltaUs;
    this._availableUs -= deltaUs;
  }

  _updateBufferLevels(now) {
    this._shortB = this._bufferMeter.short(now);
    this._stateMgr.setMinBufferMs("short", this._shortB);
    this._longB = this._bufferMeter.long(now);
    this._stateMgr.setMinBufferMs("long", this._longB);
    this._emaB = this._bufferMeter.ema();
    this._stateMgr.setMinBufferMs("ema", this._emaB);
  }
}
