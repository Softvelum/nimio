import { SharedAudioBuffer } from "./shared-audio-buffer";

export class WritableAudioBuffer extends SharedAudioBuffer {
  constructor(sharedBuf, capacity, sampleRate, numChannels, sampleCount) {
    super(sharedBuf, capacity, sampleRate, numChannels, sampleCount);
    sharedBuf ? this._attachTempBuffers() : this._allocTempBuffers();
    this._frameUs = this._frameNs / 1000;
    this._sampleUs = this._sampleNs / 1000;
    this._s16Norm = 1 / 32768;
    this._s32Norm = 1 / 2147483648;
    this._interIdx = 0;
    this._interTs = 0;
  }

  reset() {
    this._interIdx = 0;
    this._interTs = 0;
    super.reset();
  }

  pushFrame(audioFrame) {
    // TODO: remove the line after completion
    if (audioFrame.numberOfFrames !== this._sampleCount) {
      debugger;
    }

    for (let i = 0; i < this._preprocessors.length; i++) {
      let pRes = this._preprocessors[i].process(audioFrame);
      if (!pRes) return;
    }

    let writeIdx = this.getWriteIdx();
    if (this._interIdx === 0) {
      this._timestamps[writeIdx] = audioFrame.decTimestamp;
      this._rates[writeIdx] = 1;
    }

    let pushStartTs = audioFrame.decTimestamp;
    let frameCount = audioFrame.numberOfFrames;
    let pushEndTs = pushStartTs + frameCount * this._sampleUs;
    if (pushEndTs <= this._interTs) {
      // skip somehow misordered frame
      console.warn(
        `Skip frame with decTimestamp ${audioFrame.decTimestamp} as it's earlier than interTs ${this._interTs}`,
      );
      return writeIdx;
    }

    let curFrameEndTs = this._timestamps[writeIdx] + this._frameUs;
    if (pushStartTs > curFrameEndTs) {
      console.warn(
        `Gap detected before pushing frame: pushStartTs ${pushStartTs} > curFrameEndTs ${curFrameEndTs}, fill with silence`,
      );
      this._pushSilenceInterRange(pushStartTs, writeIdx);
      writeIdx = this.getWriteIdx();
      this._timestamps[writeIdx] = pushStartTs;
      this._rates[writeIdx] = 1;
      curFrameEndTs = pushStartTs + this._frameUs;
    }

    let skipCount = 0;
    if (pushStartTs < this._interTs) {
      skipCount = Math.floor((this._interTs - pushStartTs) / this._sampleUs);
    } else if (pushStartTs - this._interTs > this._sampleUs) {
      this._pushSilenceInterRange(pushStartTs, writeIdx);
    }

    // if (pushEndTs <= curFrameEndTs) {
    //   this._copyFrame(audioFrame, this._frames[writeIdx]);
    //   this._interIdx += frameCount;
    //   if (this._interIdx === this._sampleCount) {
    //     this._interIdx = 0;
    //     this._incWriteIdx(writeIdx);
    //   }
    //   return writeIdx;
    // }

    // if (this._interIdx + audioFrame.numberOfFrames >= this._sampleCount) {
    //   this._interIdx += audioFrame.numberOfFrames - this._sampleCount;
    //   this._interTs += this._frameUs;
    // }

    this._copyFrame(audioFrame, this._frames[writeIdx]);

    this._incWriteIdx(writeIdx);
    return writeIdx;
  }

  pushSilence(ts) {
    const writeIdx = this.getWriteIdx();
    if (this._interIdx === 0) {
      return this._pushSilenceFrame(ts, writeIdx);
    }

    let pushedFrameEndTs = ts + this._frameUs;
    if (pushedFrameEndTs <= this._interTs) return writeIdx;

    let curFrameEndTs = this._timestamps[writeIdx] + this._frameUs;
    if (pushedFrameEndTs < curFrameEndTs) {
      return this._pushSilenceInterRange(pushedFrameEndTs, writeIdx);
    }

    this._fillSilence(this._frames[writeIdx], this._interIdx);
    const nextIdx = this._incWriteIdx(writeIdx);
    this._rates[nextIdx] = 1;
    this._timestamps[nextIdx] = ts > curFrameEndTs ? ts : curFrameEndTs;
    this._interIdx = 0;
    this._interTs = this._timestamps[nextIdx];
    return this._pushSilenceInterRange(pushedFrameEndTs, nextIdx);
  }

  absorb(frameBuffer) {
    let lastTs = this.lastFrameTs;
    frameBuffer.forEach((frame) => {
      if (frame.decTimestamp > lastTs) {
        this.pushFrame(frame);
      }
    });

    frameBuffer.reset({ keepFrames: true });
  }

  _attachTempBuffers() {
    let offset = this._sabOffset;
    this._tempF32 = new Float32Array(this._sab, offset, this._frameSize);
    offset += this._frameBytes;
    this._tempS32 = new Int32Array(this._sab, offset, this._frameSize);
    offset += this._frameSize * Int32Array.BYTES_PER_ELEMENT;
    this._tempI16 = new Int16Array(this._sab, offset, this._frameSize);
  }

  _allocTempBuffers() {
    this._tempF32 = new Float32Array(this._frameSize);
    this._tempS32 = new Int32Array(this._frameSize);
    this._tempI16 = new Int16Array(this._frameSize);
  }

  _pushSilenceFrame(ts, writeIdx) {
    this._timestamps[writeIdx] = ts;
    this._rates[writeIdx] = 1;
    this._frames[writeIdx].fill(0);
    this._incWriteIdx(writeIdx);
    return writeIdx;
  }

  _pushSilenceInterRange(endTs, writeIdx) {
    let pushedFrames = Math.round((endTs - this._interTs) / this._frameUs);
    if (pushedFrames > 0) {
      let endIdx = this._interIdx + pushedFrames;
      if (endIdx > this._sampleCount) endIdx = this._sampleCount;
      this._fillSilence(this._frames[writeIdx], this._interIdx, endIdx);
      this._interIdx = endIdx;
      this._interTs = endTs;
      if (this._interIdx === this._sampleCount) {
        this._interIdx = 0;
        this._incWriteIdx(writeIdx);
      }
    }
    return writeIdx;
  }

  _fillSilence(target, startOff, endOff) {
    let offset = startOff;
    if (endOff === undefined) endOff = this._sampleCount;
    let fillSize = endOff - startOff;
    for (let ch = 0; ch < this.numChannels; ch++) {
      target.fill(0, offset, offset + fillSize);
      offset += this._sampleCount;
    }
  }

  _copyFrame(frame, target) {
    const format = frame.format.split("-");
    // TODO: check if format option is supported in the copyTo method as per spec
    // currently it's supported in Chrome but not in Firefox, so we have to do the copying manually for now
    if (format[format.length - 1] === "planar") {
      let offset = 0;
      for (let ch = 0; ch < this.numChannels; ch++) {
        const chBuffer = target.subarray(offset, offset + this._sampleCount);
        this._copyChannelPlanar(frame, chBuffer, format[0], { planeIndex: ch });
        offset += this._sampleCount;
      }
    } else {
      this.numChannels === 1
        ? this._copyChannelPlanar(frame, target, format[0], { planeIndex: 0 })
        : this._copyInterleaved(frame, target, format[0]);
    }
  }

  _copyFrameRange(frame, target, opts) {
    const format = frame.format.split("-");
    if (format[format.length - 1] === "planar") {
    } else {
    }
  }

  _copyChannelPlanar(frame, target, format, opts) {
    const isInt16 = format === "s16";
    if (isInt16 || format === "s32") {
      let temp = isInt16 ? this._tempI16 : this._tempS32;
      frame.copyTo(temp, opts);

      let frameCount = opts.frameCount || frame.numberOfFrames;
      const norm = isInt16 ? this._s16Norm : this._s32Norm;
      for (let i = 0; i < frameCount; i++) {
        target[i] = temp[i] * norm;
      }
    } else if (format === "f32") {
      frame.copyTo(target, opts);
    } else {
      throw new Error(`Unsupported audio format: ${format}`);
    }
  }

  _copyInterleaved(frame, target, format, opts = {}) {
    let norm = 1;
    let temp = this._tempF32;

    if (format === "s16") {
      norm = this._s16Norm;
      temp = this._tempI16;
    } else if (format === "s32") {
      norm = this._s32Norm;
      temp = this._tempS32;
    } else if (format !== "f32") {
      throw new Error(`Unsupported audio format: ${format}`);
    }
    opts.planeIndex = 0;
    frame.copyTo(temp, opts);

    let frameCount = opts.frameCount || frame.numberOfFrames;
    format === "f32"
      ? this._deinterleave(temp, target, frameCount)
      : this._deinterleaveAndNormalize(temp, target, frameCount, norm);
  }

  _deinterleave(temp, target, size) {
    let channelOffset = 0;
    for (let ch = 0; ch < this.numChannels; ch++) {
      let elOffset = ch;
      for (let i = 0; i < size; i++) {
        target[channelOffset + i] = temp[elOffset];
        elOffset += this.numChannels;
      }
      channelOffset += this._sampleCount;
    }
  }

  _deinterleaveAndNormalize(temp, target, size, norm) {
    let channelOffset = 0;
    for (let ch = 0; ch < this.numChannels; ch++) {
      let elOffset = ch;
      for (let i = 0; i < size; i++) {
        target[channelOffset + i] = temp[elOffset] * norm;
        elOffset += this.numChannels;
      }
      channelOffset += this._sampleCount;
    }
  }

  _incWriteIdx(writeIdx) {
    let wIdx = this.setWriteIdx(writeIdx + 1);
    let rIdx = this.getReadIdx();
    if (rIdx === wIdx) {
      console.warn(
        `wIdx = ${wIdx}, rIdx = ${rIdx}, increment rIdx to ${rIdx + this._overflowShift}`,
      );
      this.setReadIdx(rIdx + this._overflowShift);
    }
    return wIdx;
  }
}
