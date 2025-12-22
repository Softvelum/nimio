import { BaseProcessor } from "./base-processor";

export class WsolaProcessor extends BaseProcessor {
  constructor(channels, sampleCount, logger) {
    super(logger);

    this._channels = channels;
    this._interBlocks = new Array(channels);
    for (let i = 0; i < channels; i++) {
      this._interBlocks[i] = new Float32Array(sampleCount);
    }

    this._N = sampleCount;
    this._Ha = this._N >> 1; // 512 (analysis hop)
    this._minHs = (1 + this._N / 3) >>> 0;
    this._maxDelta = 120;

    this._hw = this._makeHannWindow(this._N);
  }

  _applyOverlapAddTo(frame, oFrame, hs) {
    let bestPos = this._findBestOlaPos(frame, hs, 256);
    let bestPos2 = hs;
    // let delta = bestPos - this._Ha;
    // if (this._prevDelta !== undefined) {
    //   delta = 0.6 * this._prevDelta + 0.4 * delta;
    //   bestPos = this._Ha + delta;
    //   this._prevDelta = delta;
    // }
    this._logger.debug("WSOLA best pos", bestPos);
    let chShift = 0;
    for (let ch = 0; ch < this._channels; ch++) {
      let iBlock = this._interBlocks[ch];
      iBlock.set(frame.subarray(chShift + bestPos, chShift + this._N), 0);
      iBlock.set(oFrame.subarray(chShift, chShift + bestPos), this._N - bestPos);

      if (ch === 0) {
        bestPos2 = this._findBestOlaPos(iBlock, hs, 256);
      }

      let olaOff = chShift + hs;
      for (let i = 0; i < bestPos2; i++) {
        frame[olaOff + i] =
          (frame[olaOff + i] * this._hw[hs + i] + iBlock[i] * this._hw[i]) /
          (this._hw[hs + i] + this._hw[i]);
      }
      olaOff += bestPos2;

      let trans = this._N - hs - bestPos2;
      for (let i = 0; i < trans; i++) {
        oFrame[chShift + i] =
          (oFrame[chShift + i] * this._hw[i] +
            frame[olaOff + i] * this._hw[hs + bestPos2 + i] +
            iBlock[bestPos2 + i] * this._hw[bestPos2 + i]) /
          (this._hw[i] + this._hw[bestPos2 + i] + this._hw[hs + bestPos2 + i]);
      }
      for (let i = 0; i < hs; i++) {
        oFrame[chShift + trans + i] =
          (oFrame[chShift + trans + i] * this._hw[trans + i] +
            iBlock[hs + trans + i] * this._hw[hs + trans + i]) /
          (this._hw[trans + i] + this._hw[hs + trans + i]);
      }
      chShift += this._N;
    }

    return hs + bestPos2;
  }

  process(readParams) {
    if (readParams.rate <= 1) return true;

    let hs = (this._Ha / readParams.rate + 0.5) >>> 0; // synthesis hop
    if (hs < this._minHs) hs = this._minHs;
    readParams.rate = this._Ha / hs;
    if (readParams.rate === 1) return true;

    let startFrame = { data: this._bufferIface.frames[readParams.startIdx] };
    let startFrameRate = this._bufferIface.rates[readParams.startIdx];
    // skip processing if the current frame is already processed or not
    // suitable for overlapping
    if (
      readParams.endIdx === readParams.startIdx &&
      (startFrameRate !== 1 || readParams.startOffset > hs)
    ) {
      // this._logger.debug(`Desired rate=${readParams.rate}. Use already specified rate ${readParams.startRate}, ${readParams.endRate}`);
      readParams.rate = 1; // use already specified frame's rate
      return true;
    }

    let nextFrame = this._bufferIface.getFrame(readParams.endIdx + 1);
    if (!nextFrame) {
      // No second frame for wsola algorithm. This isn't generally possible,
      // but we handle it just in case.
      readParams.rate = 1;
      this._logger.error("Impossible!!");
      return true;
    }

    let sCount = (this._N / readParams.rate + 0.5) >>> 0;
    if (readParams.startIdx === readParams.endIdx) {
      let skip = this._applyOverlapAddTo(startFrame.data, nextFrame.data, hs);
      readParams.rate = 2 * this._Ha / skip;
      this._bufferIface.rates[readParams.startIdx] = readParams.rate;
      readParams.startCount = readParams.endCount = sCount;
      readParams.startRate = readParams.endRate = readParams.rate;
      readParams.startOffset = this._bufferIface.calcSamplePos(
        readParams.startTsNs,
        readParams.sfStartTsNs,
        readParams.startCount,
      );
      readParams.endOffset = readParams.startOffset + readParams.outLength;
    // this._logger.debug(`Apply wsola to cur idx=${readParams.startIdx}, start=${readParams.startOffset}, end=${readParams.endOffset}, cnt = ${readParams.startCount}, rate=${readParams.startRate}`);
    } else {
      let endFrame = { data: this._bufferIface.frames[readParams.endIdx] };
      let skip = this._applyOverlapAddTo(endFrame.data, nextFrame.data, hs);
      readParams.rate = 2 * this._Ha / skip;
      this._bufferIface.rates[readParams.endIdx] = readParams.rate;
      readParams.endCount = sCount;
      readParams.endRate = readParams.rate;
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
      // this._logger.debug(`Apply wsola to next sidx=${readParams.startIdx}, eidx=${readParams.endIdx}, start=${readParams.startOffset}, start cnt=${readParams.startCount}, end=${readParams.endOffset}, srate=${readParams.startRate}, erate=${readParams.endRate}`);
    }

    readParams.rate = 1;
    return true;
  }

  _makeHannWindow(N) {
    let win = new Float32Array(N);
    for (var n = 0; n < N; n++) {
      win[n] = Math.sqrt(0.5 * (1 - Math.cos((2 * Math.PI * n) / N - 1)));
    }

    return win;
  }

  _findBestOlaPos(frame, hs, L) {
    const ref = frame.subarray(hs, hs + L);
  
    let bestScore = -Infinity;
    let bestPos = 0;
  
    let sOff = this._Ha - hs - 20;
    if (sOff < 0) sOff = 0;
    if (sOff > this._maxDelta) sOff = this._maxDelta;

    let maxPos = this._Ha + this._maxDelta;
    if (maxPos + L > frame.length) maxPos = frame.length - L;
    for (let i = this._Ha - sOff; i <= maxPos; i++) {
      const cand = frame.subarray(i, i + L);
      const score = this._nccScore(ref, cand, L);

      if (score > bestScore) {
        bestScore = score;
        bestPos = i;
      }
    }

    // this._logger.debug("scores", scores);
  
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
  
}
