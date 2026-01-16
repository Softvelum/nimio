import { SharedAudioBuffer } from "./shared-audio-buffer";

export class WritableAudioBuffer extends SharedAudioBuffer {
  constructor(sharedBuf, capacity, sampleRate, numChannels, sampleCount) {
    super(sharedBuf, capacity, sampleRate, numChannels, sampleCount);
    sharedBuf ? this._attachTempBuffers() : this._allocTempBuffers();
  }

  pushFrame(audioFrame) {
    if (audioFrame.numberOfFrames !== this._sampleCount) {
      throw new Error(
        `audioFrame must contain ${this._sampleCount} samples, got ${audioFrame.numberOfFrames}`,
      );
    }

    for (let i = 0; i < this._preprocessors.length; i++) {
      let pRes = this._preprocessors[i].process(audioFrame);
      if (!pRes) return;
    }

    const writeIdx = this.getWriteIdx();
    this._timestamps[writeIdx] = audioFrame.decTimestamp;
    this._rates[writeIdx] = 1;

    const format = audioFrame.format.split("-");
    if (format[format.length - 1] === "planar") {
      let offset = 0;
      for (let ch = 0; ch < this.numChannels; ch++) {
        this._copyChannelPlanar(
          audioFrame,
          this._frames[writeIdx].subarray(offset, offset + this._sampleCount),
          ch,
          format[0],
        );
        offset += this._sampleCount;
      }
    } else {
      if (this.numChannels === 1) {
        this._copyChannelPlanar(
          audioFrame,
          this._frames[writeIdx],
          0,
          format[0],
        );
      } else {
        this._copyInterleaved(audioFrame, this._frames[writeIdx], format[0]);
      }
    }

    this._incWriteIdx(writeIdx);
    return writeIdx;
  }

  pushSilence(timestamp) {
    const writeIdx = this.getWriteIdx();
    this._timestamps[writeIdx] = timestamp;
    this._rates[writeIdx] = 1;
    this._frames[writeIdx].fill(0);
    this._incWriteIdx(writeIdx);
    return writeIdx;
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
    this._tempI16 = new Int16Array(this._sab, offset, this._frameSize);
  }

  _allocTempBuffers() {
    this._tempF32 = new Float32Array(this._frameSize);
    this._tempI16 = new Int16Array(this._frameSize);
  }

  _copyChannelPlanar(audioFrame, target, chIdx, format) {
    if (format === "s16") {
      audioFrame.copyTo(this._tempI16, { layout: "planar", planeIndex: chIdx });
      for (let i = 0; i < this._sampleCount; i++) {
        target[i] = this._tempI16[i] / 32768;
      }
    } else {
      audioFrame.copyTo(target, { layout: "planar", planeIndex: chIdx });
    }
  }

  _copyInterleaved(audioFrame, target, format) {
    const isInt16 = format === "s16";
    let temp = isInt16 ? this._tempI16 : this._tempF32;
    audioFrame.copyTo(temp, { layout: "interleaved", planeIndex: 0 });

    let channelOffset = 0;
    for (let ch = 0; ch < this.numChannels; ch++) {
      let elOffset = ch;
      for (let i = 0; i < this._sampleCount; i++) {
        let val = isInt16 ? temp[elOffset] / 32768 : temp[elOffset];
        target[channelOffset + i] = val;
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
  }
}
