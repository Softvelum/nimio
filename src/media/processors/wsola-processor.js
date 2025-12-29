import { BaseProcessor } from "./base-processor";

export class WsolaProcessor extends BaseProcessor {
  constructor(channels, sampleCount, logger) {
    super(logger);

    this._channels = channels;
    this._props.fastForward = true;

    this._N = sampleCount;
    this._Ha = this._N;
    this._maxOv = this._N >> 1;
    this._minHs = this._maxOv - 128;
  }

  _applyOverlapAddTo(frame, oFrame, hs) {
    let overlap = 4 * (this._Ha - hs);
    if (overlap > this._maxOv) overlap = this._maxOv;
    hs = this._Ha - overlap;

    let bestPos = this._findBestOlaPos(frame, oFrame, hs);
    this._logger.debug("WSOLA best pos", bestPos);

    this._overlap(frame, oFrame, bestPos);

    return bestPos;
  }

  process(readParams) {
    if (readParams.prelimRate <= 1) return true;

    let hs = this._Ha / readParams.prelimRate & ~1; // synthesis hop
    if (hs < this._minHs) hs = this._minHs;
    readParams.prelimRate = this._Ha / hs;
    if (readParams.prelimRate === 1) return true;

    readParams.rate = 1; // from now on read process will be handled by readParams only
    let startFrame = { data: this._bufferIface.frames[readParams.startIdx] };
    let startFrameRate = this._bufferIface.rates[readParams.startIdx];
    // skip processing if the current frame is already processed or not
    // suitable for overlapping
    if (
      readParams.endIdx === readParams.startIdx &&
      (startFrameRate !== 1 || readParams.startOffset > hs) // TODO: decide on offset > hs condition
    ) {
      // this._logger.debug(`Desired rate=${readParams.prelimRate}. Use already specified rate ${readParams.startRate}, ${readParams.endRate}`);
      return true;
    }

    let nextFrame = this._bufferIface.getFrame(readParams.endIdx + 1);
    if (!nextFrame) {
      // No second frame for wsola algorithm. This isn't generally possible,
      // but we handle it just in case.
      this._logger.error("The next frame isn't available!");
      return true;
    }

    if (readParams.startIdx === readParams.endIdx) {
      let sCount = this._applyOverlapAddTo(startFrame.data, nextFrame.data, hs);
      this._bufferIface.rates[nextFrame.idx] = 0;
      let tmpIdx = (nextFrame.idx + 1) % this._bufferIface.bufferCapacity;
      this._bufferIface.rates[tmpIdx] = 0;
      tmpIdx = (nextFrame.idx + 2) % this._bufferIface.bufferCapacity;
      this._bufferIface.rates[tmpIdx] = 0;
      let ovRate = this._Ha / sCount;
      this._logger.debug(`Rate after overlap ${ovRate}, count = ${sCount}`);
      this._bufferIface.rates[readParams.startIdx] = ovRate;
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
      this._logger.debug(`Apply wsola to cur idx=${readParams.startIdx}, start=${readParams.startOffset}, end=${readParams.endOffset}, cnt = ${readParams.startCount}, rate=${readParams.startRate}`);
    } else if (this._bufferIface.rates[readParams.endIdx] === 1) {
      let endFrame = { data: this._bufferIface.frames[readParams.endIdx] };
      let sCount = this._applyOverlapAddTo(endFrame.data, nextFrame.data, hs);
      this._bufferIface.rates[nextFrame.idx] = 0;
      let tmpIdx = (nextFrame.idx + 1) % this._bufferIface.bufferCapacity;
      this._bufferIface.rates[tmpIdx] = 0;
      tmpIdx = (nextFrame.idx + 2) % this._bufferIface.bufferCapacity;
      this._bufferIface.rates[tmpIdx] = 0;
      let ovRate = this._Ha / sCount;
      this._logger.debug(`Rate 2 after overlap ${ovRate}, count = ${sCount}`);
      this._bufferIface.rates[readParams.endIdx] = ovRate;
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
      this._logger.debug(`Apply wsola to next sidx=${readParams.startIdx}, eidx=${readParams.endIdx}, start=${readParams.startOffset}, start cnt=${readParams.startCount}, end=${readParams.endOffset}, srate=${readParams.startRate}, erate=${readParams.endRate}`);
    }

    return true;
  }

  _findBestOlaPos(frame1, frame2, hs) {
    let overlap = this._Ha - hs;
    const cand = frame2.subarray(0, overlap);

    let bestDiff = Infinity;
    let bestPos = 0;

    let off = hs - Math.min(overlap, 128);
    if (off < this._minHs) off = this._minHs;

    for (let i = off; i <= hs; i++) {
      const ref = frame1.subarray(i, i + overlap);
      const diff = this._difference(ref, cand, overlap);

      if (diff < bestDiff) {
        bestDiff = diff;
        bestPos = i;
      }
    }
  
    return bestPos;
  }

  _overlap(src, dst, pos) {
    let overlapLen = this._Ha - pos;
    let fadeStep = 1.0 / overlapLen;

    let chShift = 0;
    for (let ch = 0; ch < this._channels; ch++) {
      let sIdx = chShift + pos;
      let dIdx = chShift;
      let fadeIn = 0;
      for (let i = 0; i < overlapLen; i++) {
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
