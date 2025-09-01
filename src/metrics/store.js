import { RingBuffer } from "@/shared/ring-buffer";
import LoggersFactory from "@/shared/logger.js";

export class MetricsStore {
  constructor(instanceName, id, type, timescale) {
    this.id = id;
    this.type = type;
    this.timescale = timescale;
    this._logger = LoggersFactory.create(instanceName, `MetricsStore ${id}`);

    this.pickCustom = false;
    this.bytesCustom = 0;

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

    this.bw1sec = new RingBuffer(instanceName, BUFFER_SIZE);
    this.rate1sec = new RingBuffer(instanceName, BUFFER_SIZE);
    this.lb1sec = new RingBuffer(instanceName, BUFFER_SIZE);
    this.buf1sec = new RingBuffer(instanceName, BUFFER_SIZE);
    this.buf500msec = new RingBuffer(instanceName, BUFFER_SIZE);

    this.buf1secSum = 0;
    this.buf1secCnt = 0;
    this.buf500msSum = 0;
    this.buf500msCnt = 0;

    this.timerCounter = 0;
    this.rateAdditive = 0;
  }

  clearCounters() {
    this.bytesCustom = 0;
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

    this.bw1sec.clear();
    this.rate1sec.clear();
    this.lb1sec.clear();
    this.buf1sec.clear();
    this.buf500msec.clear();
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
    if (!this.pickCustom) {
      this.pickCustom = true;
      this.customStart = undefined;
      this.customStop = undefined;
      this.bytesCustom = 0;
      this.rateCustomTs1 = undefined;
      this.rateCustomTs2 = undefined;
    }
  }

  stopCustom() {
    if (this.pickCustom) {
      this.pickCustom = false;
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
        result = (1000 * this.bytesCustom) / (customRange * 128);
      }
    }
    return result;
  }

  customRangeRate() {
    let result = 0;
    let tsInterval =
      this.rateCustomTs2 - this.rateCustomTs1 + this.rateAdditive;
    if (tsInterval > 0) {
      result = (this.timescale * this.bytesCustom) / (tsInterval * 128);
    }
    return result;
  }

  reportBandwidth(bytes, timestamp) {
    if (this.isStarted()) {
      let curTime = performance.now();
      if (undefined !== timestamp) {
        let subt = curTime / 1000 - timestamp / this.timescale;
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
      if (this.pickCustom) {
        if (undefined === this.customStart) this.customStart = curTime;
        this.bytesCustom += bytes;
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
      endTime = performance.now();
    } else {
      endTime = undefined !== this.stopTime ? this.stopTime : this.lastRepTime;
      if (endTime === this.startTime) {
        endTime = performance.now();
      }
    }
    let timeInterval = endTime - this.startTime;
    if (timeInterval > 0) {
      result = (1000 * this.bytesTotal) / (timeInterval * 128);
    }
    return result;
  }

  avgRate() {
    let result = 0;
    let tsInterval = this.rateTotalTs2 - this.rateTotalTs1 + this.rateAdditive;
    if (tsInterval > 0) {
      result = (this.timescale * this.bytesTotal) / (tsInterval * 128);
    }
    return result;
  }

  curRate1sec() {
    let result = 0;
    let tsInterval = this.rate1secTs2 - this.rate1secTs1 + this.rateAdditive;
    if (tsInterval > 0) {
      result = (this.timescale * this.bytes1sec) / (tsInterval * 128);
    }
    return result;
  }

  curRate500msec() {
    let result = 0;
    let tsInterval =
      this.rate500msecTs2 - this.rate500msecTs1 + this.rateAdditive;
    if (tsInterval > 0) {
      result = (this.timescale * this.bytes500msec) / (tsInterval * 128);
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
    if (this.bw1sec.length() > 0) {
      let lastBw = this.bw1sec.get(-1);
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
    this.bw1sec.push(curBw);
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
}
