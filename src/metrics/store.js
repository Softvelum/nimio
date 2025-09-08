import { RingBuffer } from "@/shared/ring-buffer";
import LoggersFactory from "@/shared/logger.js";

const STAT_SIZE = 60; // 1 minute
const STAT_BUCKETS_COUNT = STAT_SIZE * 4; // 1 minute of 250ms buckets

export class MetricsStore {
  constructor(instanceName, id, type) {
    this._id = id;
    this._type = type;
    this._logger = LoggersFactory.create(instanceName, `MetricsStore ${id}`);

    this._pickCustom = false;
    this._bytesCustom = 0;

    this.framesCount = 0;
    this.bytesTotal = 0;
    this.bytes1sec = 0;
    this.lastBytes = 0;

    this.bytes500msec = 0;
    this.rate500msec = 0;

    this.lowBufTotal = 0;
    this.lowBuf1sec = 0;

    this.bufferLevel = 0;
    this.bufferEnd = 0;

    this._buckets = new RingBuffer(`${instanceName} stats`, STAT_BUCKETS_COUNT);
    this._bw1sec = new RingBuffer(`${instanceName} bw`, STAT_SIZE);
    this.rate1sec = new RingBuffer(`${instanceName} rate`, STAT_SIZE);
    this.lb1sec = new RingBuffer(`${instanceName} lb`, STAT_SIZE);
    this.buf1sec = new RingBuffer(`${instanceName} buf`, STAT_SIZE);
    this.buf500msec = new RingBuffer(`${instanceName} buf500`, STAT_SIZE);

    this.buf1secSum = 0;
    this.buf1secCnt = 0;
    this.buf500msSum = 0;
    this.buf500msCnt = 0;

    this.timerCounter = 0;
    this.rateAdditive = 0;
  }

  clearCounters() {
    this._bytesCustom = 0;
    this.customStart = undefined;
    this.customEnd = undefined;
    this.rateCustomTs1 = undefined;
    this.rateCustomTs2 = undefined;
    this.stopTime = undefined;
    this.bwTime1 = undefined;
    this.bwTime2 = undefined;
    this.effBwTime1 = undefined;
    this.lastRepTime = undefined;
    this.latencySubt = undefined;

    this.framesCount = 0;
    this.bytesTotal = 0;
    this.bytes1sec = 0;
    this.lastBytes = 0;

    this.bytes500msec = 0;
    this.rate500msec = 0;
    this.rate500msecTs1 = undefined;
    this.rate500msecTs2 = undefined;

    this.rate1secTs1 = undefined;
    this.rate1secTs2 = undefined;
    this.rateTotalTs1 = undefined;
    this.rateTotalTs2 = undefined;

    this.lowBufTotal = 0;
    this.lowBuf1sec = 0;

    this.bufferLevel = 0;
    this.bufferEnd = 0;

    this.buf1secSum = 0;
    this.buf1secCnt = 0;
    this.buf500msSum = 0;
    this.buf500msCnt = 0;

    this.timerCounter = 0;
    this.rateAdditive = 0;
  }

  destroy() {
    this._clear500msecInterval();

    this._bw1sec.reset();
    this.rate1sec.reset();
    this.lb1sec.reset();
    this.buf1sec.reset();
    this.buf500msec.reset();
  }

  stop() {
    this.enabled = false;
    this.stopTime = this.lastRepTime;
    this._clear500msecInterval();
  }

  start() {
    if (!this.enabled) {
      this.enabled = true;
      this.clearCounters();
      this.startTime = undefined;
      this.interval500msec = setInterval(this._interval500msecHandler, 500);
    }
  }

  isStarted() {
    return this.enabled;
  }

  isReady() {
    return undefined === this.enabled;
  }

  startCustom() {
    if (!this._pickCustom) {
      this._pickCustom = true;
      this.customStart = undefined;
      this.customStop = undefined;
      this._bytesCustom = 0;
      this.rateCustomTs1 = undefined;
      this.rateCustomTs2 = undefined;
    }
  }

  stopCustom() {
    if (this._pickCustom) {
      this._pickCustom = false;
      this.customStop = this.lastRepTime;
    }
  }

  customRangeBandwidth() {
    let result = 0;
    if (this.customStart) {
      if (this.customStart === this.customStop) {
        this.customStop = performance.now();
      }
      let customRange = this.customStop - this.customStart;
      if (customRange > 0) {
        result = (1000 * this._bytesCustom) / (customRange * 128);
      }
    }
    return result;
  }

  customRangeRate() {
    let result = 0;
    let tsInterval =
      this.rateCustomTs2 - this.rateCustomTs1 + this.rateAdditive;
    if (tsInterval > 0) {
      result = this._bytesCustom / (tsInterval * 128);
    }
    return result;
  }

  reportBandwidth(bytes, timestamp) {
    if (this.isStarted()) {
      let curTime = performance.now() * 1000;
      if (undefined !== timestamp) {
        let subt = curTime - timestamp;
        if (undefined == this.latencySubt || subt < this.latencySubt) {
          this.latencySubt = subt;
        }
        this.framesCount++;

        if (undefined === this.rate500msecTs1) this.rate500msecTs1 = timestamp;
        this.rate500msecTs2 = timestamp;
        if (undefined === this.rate1secTs1) this.rate1secTs1 = timestamp;
        this.rate1secTs2 = timestamp;
        if (undefined === this.rateTotalTs1) this.rateTotalTs1 = timestamp;
        this.rateTotalTs2 = timestamp;
        if (undefined === this.startTime) this.startTime = curTime;
        if (undefined === this.bwTime1) {
          this.bwTime1 = curTime;
          this.effBwTime1 = curTime;
        }
        this.bwTime2 = curTime;
      }
      this.lastRepTime = curTime;

      this.lastBytes = bytes;
      this.bytes500msec += bytes;
      this.bytes1sec += bytes;
      this.bytesTotal += bytes;
      if (this._pickCustom) {
        if (undefined === this.customStart) this.customStart = curTime;
        this._bytesCustom += bytes;
        if (undefined !== timestamp) {
          if (undefined === this.rateCustomTs1) this.rateCustomTs1 = timestamp;
          this.rateCustomTs2 = timestamp;
        }
      }
    }
  }

  reportLowBuffer() {
    if (this.isStarted()) {
      this.lowBufTotal++;
      this.lowBuf1sec++;
    }
  }

  reportBufLevel(lvl, bufEnd) {
    if (this.isStarted()) {
      if (lvl < 0) lvl = 0;
      this.bufferLevel = lvl;
      this.bufferEnd = bufEnd;

      this.buf500msSum += lvl;
      this.buf500msCnt += 1;

      this.buf1secSum += lvl;
      this.buf1secCnt += 1;
    }
  }

  avgBandwidth(fromNow) {
    let result = 0;
    let endTime;
    if (fromNow) {
      endTime = performance.now() * 1000;
    } else {
      endTime = undefined !== this.stopTime ? this.stopTime : this.lastRepTime;
      if (endTime === this.startTime) {
        endTime = performance.now() * 1000;
      }
    }
    let timeInterval = endTime - this.startTime;
    if (timeInterval > 0) {
      result = (1000 * this.bytesTotal) / (timeInterval * 128);

      // 8 / 1024 == 1 / 128
    }
    return result;
  }

  avgRate() {
    let result = 0;
    let tsInterval = this.rateTotalTs2 - this.rateTotalTs1 + this.rateAdditive;
    if (tsInterval > 0) {å
      result = this.bytesTotal / (tsInterval * 128 / 1_000_000);
    }
    return result;
  }

  curRate1sec() {
    let result = 0;
    let tsInterval = this.rate1secTs2 - this.rate1secTs1 + this.rateAdditive;
    if (tsInterval > 0) {
      result = this.bytes1sec / (tsInterval * 128 / 1_000_000);
    }
    return result;
  }

  curRate500msec() {
    let result = 0;
    let tsInterval =
      this.rate500msecTs2 - this.rate500msecTs1 + this.rateAdditive;
    if (tsInterval > 0) {
      result = this.bytes500msec / (tsInterval * 128 / 1_000_000);
    }
    return result;
  }

  curBw1sec() {
    let result = 0;
    if (this.bwTime1) {
      let endTime = undefined !== this.stopTime ? this.stopTime : this.bwTime2;
      if (endTime === this.bwTime1) {
        endTime = performance.now();
      }
      let timeInterval = endTime - this.effBwTime1;
      if (timeInterval > 0) {
        result = (1000 * this.bytes1sec) / (timeInterval * 128);
      }
    }
    return result;
  }

  latestBandwidth() {
    let result = this.curBw1sec();
    if (this._bw1sec.length() > 0) {
      let lastBw = this._bw1sec.get(-1);
      if (0 === result) {
        result = lastBw;
      } else {
        result = (result + lastBw) / 2;
      }
    }
    return result;
  }

  latestRate() {
    let result = this.curRate1sec();
    if (this.rate1sec.length() > 0) {
      let lastRate = this.rate1sec.get(-1);
      if (0 == result) {
        result = lastRate;
      } else {
        result = (result + lastRate) / 2;
      }
    }
    return result;
  }

  hasLatest500msecBytesArrived() {
    return this.bytes500msec > 0 || this.rate500msec > 0;
  }

  latestLowBufferCount() {
    let result = this.lowBuf1sec;
    for (let i = 0; i < 2; i++) {
      if (this.lb1sec.length() > i) {
        result += this.lb1sec.get(-1 * (i + 1));
      }
    }
    return result;
  }

  latestBufLevel() {
    let result = this.bufferLevel || 0;
    if (this.buf1secCnt > 0) {
      result = this.buf1secSum / this.buf1secCnt;
    }
    return result;
  }

  avgBufLevel() {
    return this.buf1sec.mean() || this.bufferLevel;
  }

  avg3secBufLevel() {
    return this.buf500msec.mean() || this.bufferLevel;
  }

  _updateRate500msec(curTime) {
    this.rate500msec = this.curRate500msec();
    if (undefined !== this.bwTime2 && curTime - this.bwTime2 <= 500) {
      this.rate500msecTs1 = this.rate500msecTs2;
      this.bytes500msec = this.lastBytes;
    } else {
      this.rate500msecTs1 = undefined;
      this.bytes500msec = 0;
    }
    this.rate500msecTs2 = this.rate500msecTs1;
  }

  _updateBwRate1sec(curTime) {
    var curBw = this.curBw1sec();
    this._bw1sec.push(curBw);
    this.rate1sec.push(this.curRate1sec());
    if (undefined !== this.bwTime2 && curTime - this.bwTime2 <= 1000) {
      this.rate1secTs1 = this.rate1secTs2;
      this.bwTime1 = this.bwTime2;
      this.effBwTime1 = this.bwTime2 - (7.8125 * this.lastBytes) / curBw;
      this.bytes1sec = this.lastBytes;
    } else {
      this.rate1secTs1 = undefined;
      this.bwTime1 = undefined;
      this.effBwTime1 = undefined;
      this.bytes1sec = 0;
    }
    this.rate1secTs2 = this.rate1secTs1;
    this.bwTime2 = this.bwTime1;
  }

  _interval500msecHandler = function () {
    if (!this.isStarted()) return;
    this.timerCounter++;

    var curTime = performance.now();
    this._updateRate500msec(curTime);

    var avgBuf;
    if (this.buf500msCnt > 0) {
      avgBuf = this.buf500msSum / this.buf500msCnt;
      this.buf500msSum = this.buf500msCnt = 0;
      this.buf500msec.push(avgBuf);
    }

    if (2 === this.timerCounter) {
      this._updateBwRate1sec(curTime);

      if (this.buf1secCnt > 0) {
        avgBuf = this.buf1secSum / this.buf1secCnt;
        this.buf1secSum = this.buf1secCnt = 0;
        this.buf1sec.push(avgBuf);
      }

      this.lb1sec.push(this.lowBuf1sec);
      this.lowBuf1sec = 0;
      this.timerCounter = 0;
    }
  }.bind(this);

  _clear500msecInterval() {
    if (this.interval500msec) {
      clearInterval(this.interval500msec);
      this.interval500msec = undefined;
    }
    this.timerCounter = 0;
  }

  _percentile(sortedArr, q) {
    if (!sortedArr.length) return 0;
    const pos = q * (sortedArr.length - 1);
    const base = Math.floor(pos);
    const rest = pos - base;
    if ((sortedArr[base + 1] !== undefined)) {
      return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base]);
    }
    return sortedArr[base];
  }

  _computeMetricsForWindow(buckets, windowMs) {
    const totalBytes = buckets.reduce((a, b) => a + b.bytes, 0);
    const spanMs = (buckets[buckets.length - 1].startMs - buckets[0].startMs) || 1;
    const bandwidthBps = (totalBytes * 1000) / spanMs;

    const allTs = buckets.flatMap(b => b.timestampsUs);
    let rateBps = 0;
    if (allTs.length > 1) {
      const sortedTs = [...allTs].sort((a, b) => a - b);
      const firstTs = sortedTs[0];
      const lastTs = sortedTs[sortedTs.length - 1];
      const estLastDur = sortedTs.length > 1 ? (sortedTs[sortedTs.length - 1] - sortedTs[sortedTs.length - 2]) : 0;
      const effectiveSpanUs = (lastTs - firstTs) + estLastDur;
      rateBps = (totalBytes * 1e6) / effectiveSpanUs;
    }

    const sustainability = (bandwidthBps > 0 && rateBps > 0) ? (bandwidthBps / rateBps) : 0;

    const bufNorm = buckets.flatMap(b => b.bufferLevelsSec.map(v => v / this.targetBufferSec));
    bufNorm.sort((a, b) => a - b);
    const p10 = this._percentile(bufNorm, 0.10);
    const p50 = this._percentile(bufNorm, 0.50);
    const p95 = this._percentile(bufNorm, 0.95);

    const lowEvents = buckets.reduce((a, b) => a + b.lowBufferCount, 0);
    const lowBufferEventsPerSec = lowEvents / (windowMs / 1000);

    const arrTimes = buckets.flatMap(b => b.arrivalTimes);
    let jitterMs = 0;
    if (arrTimes.length > 1) {
      const diffs = [];
      for (let i = 1; i < arrTimes.length; i++) diffs.push(arrTimes[i] - arrTimes[i - 1]);
      const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      const varSum = diffs.reduce((a, b) => a + (b - mean) ** 2, 0);
      jitterMs = Math.sqrt(varSum / diffs.length);
    }

    // Stall risk
    const risk = Math.min(1, Math.max(0, 1 - p10)) * Math.min(1, jitterMs / (0.5 * this.targetBufferSec * 1000));

    let bufferHealth = "stable";
    if (sustainability < 0.9 || p50 < 0.5 || risk > 0.7) {
      bufferHealth = "weak";
    } else if (risk > 0.4 || (p95 - p50) > 1.5) {
      bufferHealth = "unstable";
    } else if (sustainability > 1.2 && p50 > 0.8 && risk < 0.3) {
      bufferHealth = "strong";
    }

    return {
      bandwidthBps,
      rateBps,
      sustainability,
      bufferPercentiles: { p10, p50, p95 },
      lowBufferEventsPerSec,
      jitterMs,
      stallRisk: risk,
      bufferHealth,
    };
  }
}
