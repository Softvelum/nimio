import { RingBuffer } from "@/shared/ring-buffer";
import LoggersFactory from "@/shared/logger.js";

const STAT_SIZE = 3; // 3 seconds
const STAT_BUCKETS_COUNT = STAT_SIZE * 4; // 6 seconds of 250ms buckets

export class MetricsStore {
  constructor(instanceName, id, type) {
    this._id = id;
    this._type = type;
    this._logger = LoggersFactory.create(instanceName, `MetricsStore ${id}`);

    this._pickCustom = false;
    this._bytesCustom = 0;

    this._framesCount = 0;
    this._bytesTotal = 0;
    this._bytes1sec = 0;
    this._lastBytes = 0;

    this._bytes500msec = 0;
    this._rate500msec = 0;

    this._lowBufTotal = 0;
    this._lowBuf1sec = 0;

    this._bufferLevel = 0;

    // this._buckets = new RingBuffer(`${instanceName} stats`, STAT_BUCKETS_COUNT);
    this._bw1sec = new RingBuffer(`${instanceName} bw`, STAT_SIZE);
    this._rate1sec = new RingBuffer(`${instanceName} rate`, STAT_SIZE);
    this._lb1sec = new RingBuffer(`${instanceName} lb`, STAT_SIZE);
    this._buf1sec = new RingBuffer(`${instanceName} buf`, STAT_SIZE);
    this._buf500msec = new RingBuffer(`${instanceName} buf500`, STAT_SIZE * 2);

    this._buf1secSum = 0;
    this._buf1secCnt = 0;
    this._buf500msSum = 0;
    this._buf500msCnt = 0;

    this._timerCounter = 0;
    this._freqFrameDur = 0;
    this._tss = [];
  }

  destroy() {
    this._clear500msecInterval();

    this._bw1sec.reset();
    this._rate1sec.reset();
    this._lb1sec.reset();
    this._buf1sec.reset();
    this._buf500msec.reset();
    this._tss.length = 0;
  }

  stop() {
    this._enabled = false;
    this._stopTime = this._lastRepTime;
    this._clear500msecInterval();
  }

  start() {
    if (this._enabled) return;

    this._enabled = true;
    this._clearCounters();
    this._startTime = undefined;
    this._interval500msec = setInterval(this._interval500msecHandler, 500);
  }

  isStarted() {
    return this._enabled;
  }

  startCustom() {
    if (this._pickCustom) return;

    this._pickCustom = true;
    this._customStart = undefined;
    this._customStop = undefined;
    this._bytesCustom = 0;
    this._rateCustomTs1 = undefined;
    this._rateCustomTs2 = undefined;
  }

  stopCustom() {
    if (!this._pickCustom) return;

    this._pickCustom = false;
    this._customStop = this._lastRepTime;
  }

  customRangeBandwidth() {
    let result = 0;
    if (this._customStart) {
      if (this._customStart === this._customStop) {
        this._customStop = performance.now();
      }
      let customRange = this._customStop - this._customStart;
      if (customRange > 0) {
        result = this._rateInBps(this._bytesCustom, customRange);
      }
    }
    return result;
  }

  customRangeRate() {
    let result = 0;
    let tsInt = this._rateCustomTs2 - this._rateCustomTs1 + this.getFrameDuration();
    if (tsInt > 0) {
      result = this._rateInBps(this._bytesCustom, tsInt / 1000);
    }
    return result;
  }

  reportBandwidth(bytes, timestamp) {
    if (!this.isStarted()) return;

    let curTime = performance.now();
    if (undefined !== timestamp) {
      let subt = curTime - timestamp / 1000;
      if (undefined == this._latencySubt || subt < this._latencySubt) {
        this._latencySubt = subt;
      }
      this._framesCount++;

      this._updateFrameDuration(timestamp);
      this._updateTimestamps("_rate500msecTs1", "_rate500msecTs2", timestamp);
      this._updateTimestamps("_rate1secTs1", "_rate1secTs2", timestamp);
      this._updateTimestamps("_rateTotalTs1", "_rateTotalTs2", timestamp);

      if (undefined === this._startTime) this._startTime = curTime;
      if (undefined === this._bwTime1) {
        this._bwTime1 = this._effBwTime1 = curTime;
      }
      this._bwTime2 = curTime;
    }
    this._lastRepTime = curTime;

    this._lastBytes = bytes;
    this._bytes500msec += bytes;
    this._bytes1sec += bytes;
    this._bytesTotal += bytes;
    if (this._pickCustom) {
      if (undefined === this._customStart) this._customStart = curTime;
      this._bytesCustom += bytes;
      if (undefined !== timestamp) {
        this._updateTimestamps("_rateCustomTs1", "_rateCustomTs1", timestamp);
      }
    }
  }

  reportLowBuffer() {
    if (!this.isStarted()) return;

    this._lowBufTotal++;
    this._lowBuf1sec++;
  }

  reportBufLevel(lvl) {
    if (!this.isStarted()) return;

    if (lvl < 0) lvl = 0;
    this._bufferLevel = lvl;

    this._buf500msSum += lvl;
    this._buf500msCnt += 1;

    this._buf1secSum += lvl;
    this._buf1secCnt += 1;
  }

  avgBandwidth(fromNow) {
    let result = 0;
    let endTime;
    if (fromNow) {
      endTime = performance.now();
    } else {
      endTime = this._stopTime > 0 ? this._stopTime : this._lastRepTime;
      if (endTime === this._startTime) {
        endTime = performance.now();
      }
    }
    let timeInterval = endTime - this._startTime;
    if (timeInterval > 0) {
      result = this._rateInBps(this._bytesTotal, timeInterval);
    }
    return result;
  }

  avgRate() {
    let result = 0;
    let tsInt = this._rateTotalTs2 - this._rateTotalTs1 + this.getFrameDuration();
    if (tsInt > 0) {
      result = this._rateInBps(this._bytesTotal, tsInt / 1000);
    }
    return result;
  }

  curRate1sec() {
    let result = 0;
    let tsInt = this._rate1secTs2 - this._rate1secTs1 + this.getFrameDuration();
    if (tsInt > 0) {
      result = this._rateInBps(this._bytes1sec, tsInt / 1000);
    }
    return result;
  }

  curRate500msec() {
    let result = 0;
    let tsInt = this._rate500msecTs2 - this._rate500msecTs1 + this.getFrameDuration();
    if (tsInt > 0) {
      result = this._rateInBps(this._bytes500msec, tsInt / 1000);
    }
    return result;
  }

  curBw1sec() {
    let result = 0;
    if (this._bwTime1) {
      let endTime = this._stopTime > 0 ? this._stopTime : this._bwTime2;
      if (endTime === this._bwTime1) {
        endTime = performance.now();
      }
      let timeInterval = endTime - this._effBwTime1;
      if (timeInterval > 0) {
        result = this._rateInBps(this._bytes1sec, timeInterval);
      }
    }
    return result;
  }

  latestBandwidth() {
    let result = this.curBw1sec();
    if (this._bw1sec.length > 0) {
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
    if (this._rate1sec.length > 0) {
      let lastRate = this._rate1sec.get(-1);
      if (0 == result) {
        result = lastRate;
      } else {
        result = (result + lastRate) / 2;
      }
    }
    return result;
  }

  latestLowBufferCount() {
    let result = this._lowBuf1sec;
    for (let i = 0; i < 2; i++) {
      if (this._lb1sec.length > i) {
        result += this._lb1sec.get(-1 * (i + 1));
      }
    }
    return result;
  }

  latestBufLevel() {
    let result = this._bufferLevel || 0;
    if (this._buf1secCnt > 0) {
      result = this._buf1secSum / this._buf1secCnt;
    }
    return result;
  }

  avgBufLevel() {
    let res;
    if (this._buf1sec.length > 0) {
      res = this._mean(this._buf1sec);
    } else if (this._buf500msCnt > 0) {
      res = this._bufferLevel;
    }
    // undefined means that no metric is gathered
    return res;
  }

  avg3secBufLevel() {
    let res;
    if (this._buf1sec.length > 0) {
      res = this._mean(this._buf1sec);
    } else if (this._buf500msCnt > 0) {
      res = this._buf500msSum / this._buf500msCnt;
    }
    // undefined means that no metric is gathered
    return res;
  }

  getFrameDuration() {
    if (this._freqFrameDur === 0) this._calcFrameDuration();
    return this._freqFrameDur;
  }

  _updateTimestamps(lower, higher, val) {
    if (!(this[lower] <= val)) {
      this[lower] = val;
    }
    if (!(this[higher] >= val)) {
      this[higher] = val;
    }
  }

  _rateInBps(bytes, ms) {
    return ms > 0 ? (8 * 1000 * bytes) / ms : 0;
  }

  _mean(buffer) {
    let result = 0;
    buffer.forEach(function (v) {
      result += v;
    });
    return result === 0 ? result : result / buffer.length;
  }

  _clearCounters() {
    this._bytesCustom = 0;
    this._customStart = undefined;
    this._customStop = undefined;
    this._rateCustomTs1 = undefined;
    this._rateCustomTs2 = undefined;
    this._stopTime = undefined;
    this._bwTime1 = undefined;
    this._bwTime2 = undefined;
    this._effBwTime1 = undefined;
    this._lastRepTime = undefined;
    this._latencySubt = undefined;

    this._framesCount = 0;
    this._bytesTotal = 0;
    this._bytes1sec = 0;
    this._lastBytes = 0;

    this._bytes500msec = 0;
    this._rate500msec = 0;
    this._rate500msecTs1 = undefined;
    this._rate500msecTs2 = undefined;

    this._rate1secTs1 = undefined;
    this._rate1secTs2 = undefined;
    this._rateTotalTs1 = undefined;
    this._rateTotalTs2 = undefined;

    this._lowBufTotal = 0;
    this._lowBuf1sec = 0;

    this._bufferLevel = 0;

    this._buf1secSum = 0;
    this._buf1secCnt = 0;
    this._buf500msSum = 0;
    this._buf500msCnt = 0;

    this._timerCounter = 0;
    this._freqFrameDur = 0;
  }

  _updateRate500msec(curTime) {
    this._rate500msec = this.curRate500msec();
    if (undefined !== this._bwTime2 && curTime - this._bwTime2 <= 500) {
      this._rate500msecTs1 = this._rate500msecTs2;
      this._bytes500msec = this._lastBytes;
    } else {
      this._rate500msecTs1 = undefined;
      this._bytes500msec = 0;
    }
    this._rate500msecTs2 = this._rate500msecTs1;
  }

  _updateBwRate1sec(curTime) {
    var curBw = this.curBw1sec();
    this._bw1sec.push(curBw, true);
    this._rate1sec.push(this.curRate1sec(), true);
    if (undefined !== this._bwTime2 && curTime - this._bwTime2 <= 1000) {
      this._rate1secTs1 = this._rate1secTs2;
      this._bwTime1 = this._bwTime2;
      this._effBwTime1 = this._bwTime2 - (8 * this._lastBytes) / curBw;
      this._bytes1sec = this._lastBytes;
    } else {
      this._rate1secTs1 = undefined;
      this._bwTime1 = undefined;
      this._effBwTime1 = undefined;
      this._bytes1sec = 0;
    }
    this._rate1secTs2 = this._rate1secTs1;
    this._bwTime2 = this._bwTime1;
  }

  _interval500msecHandler = function () {
    if (!this.isStarted()) return;
    this._timerCounter++;

    var curTime = performance.now();
    this._updateRate500msec(curTime);

    var avgBuf;
    if (this._buf500msCnt > 0) {
      avgBuf = this._buf500msSum / this._buf500msCnt;
      this._buf500msSum = this._buf500msCnt = 0;
      this._buf500msec.push(avgBuf, true);
    }

    // TODO: rework for better handling of timer delays
    if (2 === this._timerCounter) {
      this._updateBwRate1sec(curTime);

      if (this._buf1secCnt > 0) {
        avgBuf = this._buf1secSum / this._buf1secCnt;
        this._buf1secSum = this._buf1secCnt = 0;
        this._buf1sec.push(avgBuf, true);
      }

      this._lb1sec.push(this._lowBuf1sec, true);
      this._lowBuf1sec = 0;
      this._timerCounter = 0;
    }
  }.bind(this);

  _clear500msecInterval() {
    if (this._interval500msec) {
      clearInterval(this._interval500msec);
      this._interval500msec = undefined;
    }
    this._timerCounter = 0;
  }

  _updateFrameDuration(ts) {
    if (this._tss.length >= 90) return;

    let i = 0;
    for (i = 0; i < this._tss.length; i++) {
      if (ts < this._tss[i]) break;
    }
    this._tss.splice(i, 0, ts);
    this._freqFrameDur = 0;
  }

  _calcFrameDuration() {
    this._freqFrameDur = 0;

    let i;
    let durCounts = {};
    for (i = 1; i < this._tss.length; i++) {
      let dur = this._tss[i] - this._tss[i - 1];
      durCounts[dur] = durCounts[dur] > 0 ? durCounts[dur] + 1 : 1;
    }
    let maxCount = 0;
    for (i in durCounts) {
      if (durCounts[i] > maxCount) {
        let dur = parseInt(i);
        if (dur > 0) {
          this._freqFrameDur = dur;
          maxCount = durCounts[i];
        }
      }
    }
  }

  // _percentile(sortedArr, q) {
  //   if (!sortedArr.length) return 0;
  //   const pos = q * (sortedArr.length - 1);
  //   const base = Math.floor(pos);
  //   const rest = pos - base;
  //   if (sortedArr[base + 1] !== undefined) {
  //     return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base]);
  //   }
  //   return sortedArr[base];
  // }

  // _computeMetricsForWindow(buckets, windowMs) {
  //   const totalBytes = buckets.reduce((a, b) => a + b.bytes, 0);
  //   const spanMs =
  //     buckets[buckets.length - 1].startMs - buckets[0].startMs || 1;
  //   const bandwidthBps = (totalBytes * 1000) / spanMs;

  //   const allTs = buckets.flatMap((b) => b.timestampsUs);
  //   let rateBps = 0;
  //   if (allTs.length > 1) {
  //     const sortedTs = [...allTs].sort((a, b) => a - b);
  //     const firstTs = sortedTs[0];
  //     const lastTs = sortedTs[sortedTs.length - 1];
  //     const estLastDur =
  //       sortedTs.length > 1
  //         ? sortedTs[sortedTs.length - 1] - sortedTs[sortedTs.length - 2]
  //         : 0;
  //     const effectiveSpanUs = lastTs - firstTs + estLastDur;
  //     rateBps = (totalBytes * 1e6) / effectiveSpanUs;
  //   }

  //   const sustainability =
  //     bandwidthBps > 0 && rateBps > 0 ? bandwidthBps / rateBps : 0;

  //   const bufNorm = buckets.flatMap((b) =>
  //     b._bufferLevelsSec.map((v) => v / this.targetBufferSec),
  //   );
  //   bufNorm.sort((a, b) => a - b);
  //   const p10 = this._percentile(bufNorm, 0.1);
  //   const p50 = this._percentile(bufNorm, 0.5);
  //   const p95 = this._percentile(bufNorm, 0.95);

  //   const lowEvents = buckets.reduce((a, b) => a + b.lowBufferCount, 0);
  //   const lowBufferEventsPerSec = lowEvents / (windowMs / 1000);

  //   const arrTimes = buckets.flatMap((b) => b.arrivalTimes);
  //   let jitterMs = 0;
  //   if (arrTimes.length > 1) {
  //     const diffs = [];
  //     for (let i = 1; i < arrTimes.length; i++)
  //       diffs.push(arrTimes[i] - arrTimes[i - 1]);
  //     const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  //     const varSum = diffs.reduce((a, b) => a + (b - mean) ** 2, 0);
  //     jitterMs = Math.sqrt(varSum / diffs.length);
  //   }

  //   // Stall risk
  //   const risk =
  //     Math.min(1, Math.max(0, 1 - p10)) *
  //     Math.min(1, jitterMs / (0.5 * this.targetBufferSec * 1000));

  //   let bufferHealth = "stable";
  //   if (sustainability < 0.9 || p50 < 0.5 || risk > 0.7) {
  //     bufferHealth = "weak";
  //   } else if (risk > 0.4 || p95 - p50 > 1.5) {
  //     bufferHealth = "unstable";
  //   } else if (sustainability > 1.2 && p50 > 0.8 && risk < 0.3) {
  //     bufferHealth = "strong";
  //   }

  //   return {
  //     bandwidthBps,
  //     rateBps,
  //     sustainability,
  //     bufferPercentiles: { p10, p50, p95 },
  //     lowBufferEventsPerSec,
  //     jitterMs,
  //     stallRisk: risk,
  //     bufferHealth,
  //   };
  // }
}
