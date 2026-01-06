import { BaseProcessor } from "./base-processor";

export class WsolaProcessor extends BaseProcessor {
  constructor(channels, sampleCount, logger) {
    super(logger);

    this._channels = channels;
    this._props.fastForward = true;

    this._N = sampleCount;
    this._Ha = this._N;
    this._minFrameCnt = 3;
    this._maxFrameCnt = 8;

    this._maxOv = this._N >> 1;
    this._minHs = this._maxOv >> 2;
    this._srchRange = this._maxOv - this._minHs;
  }

  // rate = segment / (segment - overlap)
  // overlap = segment * (rate - 1) / rate;
  // segment = overlap * rate / (rate - 1);

  process(readParams) {
    if (readParams.prelimRate <= 1) return true;

    this._calcOverlap(readParams.prelimRate);
    let segLen = this._frameCnt * this._Ha;
    readParams.prelimRate = segLen / (segLen - this._overLen);
    if (readParams.prelimRate === 1) return true;
    
    let hs = this._Ha - this._overLen - this._srchRange;
    if (hs < this._minHs) hs = this._minHs;
    readParams.rate = 1; // from now on read process will be handled by readParams only

    let bufferRates = this._bufferIface.rates;
    let startFrame = { data: this._bufferIface.frames[readParams.startIdx] };
    let startFrameRate = bufferRates[readParams.startIdx];
    if (
      readParams.endIdx === readParams.startIdx &&
      (startFrameRate !== 1 || readParams.startOffset > hs)
    ) {
      // skip processing if the current frame is already processed or not
      // suitable for overlapping
      return true;
    }

    let nextFrame = this._bufferIface.getFrame(readParams.endIdx + 1);
    if (!nextFrame) {
      // No second frame for wsola algorithm. This isn't generally possible,
      // but we handle it just in case.
      this._logger.error("The next frame isn't available!");
      return true;
    }

    let sCount, ovRate;
    if (readParams.startIdx === readParams.endIdx) {
      sCount = this._applyOverlapAddTo(startFrame.data, nextFrame.data);
      ovRate = this._Ha / sCount;
      bufferRates[readParams.startIdx] = ovRate;
      readParams.startCount = readParams.endCount = sCount;
      readParams.startRate = readParams.endRate = ovRate;
      readParams.startOffset = this._bufferIface.calcSamplePos(
        readParams.startTsNs,
        readParams.sfStartTsNs,
        readParams.startCount,
      );
      readParams.endOffset = readParams.startOffset + readParams.outLength;
      if (readParams.endOffset > readParams.endCount) {
        readParams.endIdx = nextFrame.idx;
        readParams.endOffset -= readParams.endCount;
        readParams.efStartTsNs = nextFrame.timestamp * 1000;
      }
    } else if (bufferRates[readParams.endIdx] === 1) {
      let endFrame = { data: this._bufferIface.frames[readParams.endIdx] };
      sCount = this._applyOverlapAddTo(endFrame.data, nextFrame.data);
      ovRate = this._Ha / sCount;
      bufferRates[readParams.endIdx] = ovRate;
      readParams.endCount = sCount;
      readParams.endRate = ovRate;
      let rest = readParams.startCount - readParams.startOffset;
      if (rest >= readParams.outLength) {
        readParams.endIdx = readParams.startIdx;
        readParams.efStartTsNs = readParams.sfStartTsNs;
        readParams.endOffset = readParams.startOffset + readParams.outLength;
        readParams.endCount = readParams.startCount;
        readParams.endRate = readParams.startRate;
        if (rest > readParams.outLength) {
          // get back to previously skipped buffer
          this._bufferIface.setReadIdx(readParams.endIdx);
        }
      } else {
        readParams.endOffset = readParams.outLength - rest;
      }
    }
    if (sCount > 0) {
      this._updateFrameCount(sCount, readParams.prelimRate);
      this._bufferIface.forEachAsync(function (ts, rate, data, idx, left) {
        bufferRates[idx] = 0;
      }, nextFrame.idx, this._frameCnt - 1);
    }

    return true;
  }

  _applyOverlapAddTo(frame, oFrame) {
    let bestPos = this._findBestOlaPos(frame, oFrame);
    this._overlap(frame, oFrame, bestPos);
    return bestPos;
  }

  _findBestOlaPos(frame1, frame2) {
    const cand = frame2.subarray(0, this._overLen);

    let bestDiff = Infinity;
    let bestPos = 0;

    let end = this._Ha - this._overLen;
    let start = end - Math.min(this._overLen * 3, this._srchRange);
    if (start < this._minHs) start = this._minHs;

    for (let i = start; i <= end; i++) {
      const ref = frame1.subarray(i, i + this._overLen);
      const diff = this._difference(ref, cand, this._overLen);

      if (diff < bestDiff) {
        bestDiff = diff;
        bestPos = i;
      }
    }
  
    // this._logger.debug(`Best pos = ${bestPos}, overlap = ${this._overLen}, frameCnt = ${this._frameCnt}`);
    return bestPos;
  }

  _updateFrameCount(overPos, rate) {
    let actOver = this._Ha - overPos;
    if (actOver < this._overLen * 1.2 || this._frameCnt === this._maxFrameCnt) {
      return;
    }

    let segLen = this._frameCnt * this._Ha;
    let bestRate = segLen / (segLen - actOver);
    let bestAdd = 0;
    for (let i = 1; i <= this._maxFrameCnt - this._frameCnt; i++) {
      segLen = (this._frameCnt + i) * this._Ha;
      let updRate = segLen / (segLen - actOver);
      if (Math.abs(updRate - rate) < Math.abs(bestRate - rate)) {
        bestRate = updRate;
        bestAdd = i;
      }
    }

    if (bestAdd > 0) {
      this._logger.debug(`Updated frame cnt from ${this._frameCnt} to ${this._frameCnt + bestAdd}`);
    }
    this._logger.debug(`Current rate = ${bestRate}, overPos = ${overPos}, cnt = ${this._frameCnt}, actOver = ${actOver}`);
    this._frameCnt += bestAdd;
  }

  _calcOverlap(rate) {
    let rateMult = (rate - 1) / rate;
    this._overLen = 0;
    this._frameCnt = this._minFrameCnt;
    for (let i = this._minFrameCnt; i <= this._maxFrameCnt; i++) {
      this._overLen = (i * this._Ha * rateMult + 0.5) >>> 0;
      if (this._overLen > this._maxOv) {
        this._overLen = this._maxOv;
        break;
      }
      this._frameCnt = i;
    }
  }

  _overlap(src, dst, pos) {
    // let size = this._Ha - pos;
    let size = this._overLen;
    let fadeStep = 1.0 / size;

    let chShift = 0;
    for (let ch = 0; ch < this._channels; ch++) {
      let sIdx = chShift + pos;
      let dIdx = chShift;
      let fadeIn = 0;
      for (let i = 0; i < size; i++) {
        dst[dIdx] = dst[dIdx] * fadeIn + src[sIdx] * (1.0 - fadeIn);
        dIdx++;
        sIdx++;
        fadeIn += fadeStep;
      }
      chShift += this._N;
    }
  }

  _difference(a, b, len) {
    let diff0 = 0, diff1 = 0, diff2 = 0, diff3 = 0;
    let v0 = 0, v1 = 0, v2 = 0, v3 = 0;

    let i = 0;
    const limit = len & ~3;
    // SIMD optimisation
    for (; i < limit; i += 4) {
      v0 = a[i] - b[i];
      v1 = a[i + 1] - b[i + 1];
      v2 = a[i + 2] - b[i + 2];
      v3 = a[i + 3] - b[i + 3];
      diff0 += v0 * v0;
      diff1 += v1 * v1;
      diff2 += v2 * v2;
      diff3 += v3 * v3;
    }
    let diff = diff0 + diff1 + diff2 + diff3;

    // count tail
    for (; i < len; i++) {
      v0 = a[i] - b[i];
      diff += v0 * v0;
    }

    return diff;
  }
  
}
