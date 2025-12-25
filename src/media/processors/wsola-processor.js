import { BaseProcessor } from "./base-processor";

export class WsolaProcessor extends BaseProcessor {
  constructor(channels, sampleCount, logger) {
    super(logger);

    this._channels = channels;
    this._props.fastForward = true;

    // TODO: delete or restore
    // this._interBlocks = new Array(channels);
    // for (let i = 0; i < channels; i++) {
    //   this._interBlocks[i] = new Float32Array(sampleCount);
    // }

    this._N = sampleCount;
    this._Ha = this._N;
    this._minHs = this._N >> 1 - 128;

    // this._hw = this._makeHannWindow(this._N);
  }

  _applyOverlapAddTo(frame, oFrame, hs) {
    let overlap = 4 * (this._Ha - hs);
    hs = this._Ha - overlap;
    let bestPos = this._findBestOlaPos(frame, oFrame, hs);
    this._logger.debug("WSOLA best pos", bestPos);

    overlap = this._Ha - bestPos;
    
    let fadeStep = 1.0 / overlap;
    let chShift = 0;
    for (let ch = 0; ch < this._channels; ch++) {

      for (let i = 0; i < overlap; i++) {
        let fadeIn = fadeStep * i;
        let fadeOut = 1.0 - fadeIn;

        oFrame[chShift + i] = oFrame[chShift + i] * fadeIn + frame[chShift + bestPos + i] * fadeOut;
      }

      chShift += this._N;
    }

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

  _makeHannWindow(N) {
    let win = new Float32Array(N);
    for (var n = 0; n < N; n++) {
      win[n] = Math.sqrt(0.5 * (1 - Math.cos((2 * Math.PI * n) / N - 1)));
    }

    return win;
  }

  _findBestOlaPos(frame1, frame2, hs) {
    let overlap = this._Ha - hs;
    const cand = frame2.subarray(0, overlap);

    let bestDiff = Infinity;
    let bestPos = 0;

    let off = hs - Math.min(overlap, 120);
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

  _nccScore(ref, cand, L) {
    let dot0 = 0, dot1 = 0, dot2 = 0, dot3 = 0;
    let reng0 = 0, reng1 = 0, reng2 = 0, reng3 = 0;
    let ceng0 = 0, ceng1 = 0, ceng2 = 0, ceng3 = 0;
  
    let i = 0;
    const limit = L & ~3;
  
    // SIMD optimisation
    for (; i < limit; i += 4) {
      const r0 = ref[i];
      const r1 = ref[i + 1];
      const r2 = ref[i + 2];
      const r3 = ref[i + 3];

      const c0 = cand[i];
      const c1 = cand[i + 1];
      const c2 = cand[i + 2];
      const c3 = cand[i + 3];
  
      dot0 += r0 * c0;
      dot1 += r1 * c1;
      dot2 += r2 * c2;
      dot3 += r3 * c3;

      reng0 += r0 * r0;
      reng1 += r1 * r1;
      reng2 += r2 * r2;
      reng3 += r3 * r3;

      ceng0 += c0 * c0;
      ceng1 += c1 * c1;
      ceng2 += c2 * c2;
      ceng3 += c3 * c3;
    }
  
    let dot = dot0 + dot1 + dot2 + dot3;
    let renergy = reng0 + reng1 + reng2 + reng3;
    let cenergy = ceng0 + ceng1 + ceng2 + ceng3;
  
    // count tail
    for (; i < L; i++) {
      const r = ref[i];
      const c = cand[i];
      dot += r * c;
      renergy += r * r;
      cenergy += c * c;
    }

    const denom = Math.sqrt(renergy * cenergy) || 1e-12;
  
    return dot / denom;
  }

  _overlap(src, dst, len, chCnt) {
    let fadeStep = 1.0 / len;

    let k = 0;
    for (let ch = 0; ch < chCnt; ch++) {
      k = ch * len;
      for (let i = 0; i < len; i++, k++) {
        let fadeIn = fadeStep * i;
        let fadeOut = 1.0 - fadeIn;
        dst[k] = dst[k] * fadeIn + src[k] * fadeOut;
      }
    }
  }

  _difference(a, b, len) {
    let diff = 0;
    for (let i = 0; i < len; i++) {
      let v = a[i] - b[i];
      diff += v * v;
    }

    return diff;
  }
  
}
