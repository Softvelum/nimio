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

    this._hw = this._makeHannWindow(this._N);
  }

  _applyOverlapAddTo(frame, oFrame, hs) {
    let chShift = 0;
    for (let ch = 0; ch < this._channels; ch++) {
      let iBlock = this._interBlocks[ch];
      iBlock.set(frame.subarray(chShift + this._Ha, chShift + this._N), 0);
      iBlock.set(oFrame.subarray(chShift, chShift + this._Ha), this._Ha);

      let olaOff = chShift + hs;
      for (let i = 0; i < hs; i++) {
        frame[olaOff + i] =
          (frame[olaOff + i] * this._hw[hs + i] + iBlock[i] * this._hw[i]) /
          (this._hw[hs + i] + this._hw[i]);
      }
      olaOff += hs;

      let trans = this._N - 2 * hs;
      for (let i = 0; i < trans; i++) {
        oFrame[chShift + i] =
          (oFrame[chShift + i] * this._hw[i] +
            frame[olaOff + i] * this._hw[2 * hs + i] +
            iBlock[hs + i] * this._hw[hs + i]) /
          (this._hw[i] + this._hw[hs + i] + this._hw[2 * hs + i]);
      }
      for (let i = 0; i < hs; i++) {
        oFrame[chShift + trans + i] =
          (oFrame[chShift + trans + i] * this._hw[trans + i] +
            iBlock[hs + trans + i] * this._hw[hs + trans + i]) /
          (this._hw[trans + i] + this._hw[hs + trans + i]);
      }
      chShift += this._N;
    }
  }

  process(readParams) {
    if (readParams.rate <= 1) return true;

    let hs = (this._Ha / readParams.rate + 0.5) >>> 0; // synthesis hop
    if (hs < this._minHs) hs = this._minHs;
    readParams.rate = this._Ha / hs;

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
      this._applyOverlapAddTo(startFrame.data, nextFrame.data, hs);
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
      this._applyOverlapAddTo(endFrame.data, nextFrame.data, hs);
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
      win[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / N - 1));
    }

    return win;
  }
}
