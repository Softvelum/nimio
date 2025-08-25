import { SharedAudioBuffer } from "./shared-audio-buffer";

export class WritableAudioBuffer extends SharedAudioBuffer {
  constructor(sharedBuffer, capacity, sampleRate, numChannels, sampleCount) {
    super(sharedBuffer, capacity, sampleRate, numChannels, sampleCount);
    this._preprocessors = [];
  }

  addPreprocessor(preprocessor) {
    this._preprocessors.push(preprocessor);
    preprocessor.setBufferIface(this);
  }

  reset() {
    super.reset();
    for (let i = 0; i < this._preprocessors.length; i++) {
      this._preprocessors[i].reset();
    }
    this._preprocessors.length = 0;
  }

  pushFrame(audioFrame) {
    if (audioFrame.numberOfFrames !== this.sampleCount) {
      throw new Error(
        `audioFrame must contain ${this.sampleCount} samples, got ${audioFrame.numberOfFrames}`,
      );
    }

    for (let i = 0; i < this._preprocessors.length; i++) {
      this._preprocessors[i].process(audioFrame, this);
    }

    const writeIdx = this.getWriteIdx();
    this.timestamps[writeIdx] = audioFrame.decTimestamp;

    const format = audioFrame.format.split("-");
    if (format[format.length - 1] === "planar") {
      let offset = 0;
      for (let ch = 0; ch < this.numChannels; ch++) {
        this._copyChannelPlanar(
          audioFrame,
          this.frames[writeIdx].subarray(offset, offset + this.sampleCount),
          ch,
          format[0],
        );
        offset += this.sampleCount;
      }
    } else {
      if (this.numChannels === 1) {
        this._copyChannelPlanar(
          audioFrame,
          this.frames[writeIdx],
          0,
          format[0],
        );
      } else {
        this._copyInterleaved(audioFrame, this.frames[writeIdx], format[0]);
      }
    }

    this.setWriteIdx(writeIdx + 1);
    return true;
  }

  absorb(frameBuffer) {
    let lastTs = this.getLastTimestampUs();
    frameBuffer.forEach((frame) => {
      if (frame.decTimestamp > lastTs) {
        this.pushFrame(frame);
      }
    });

    frameBuffer.reset({ keepFrames: true });
  }

  pushSilence(timestamp) {
    const writeIdx = this.getWriteIdx();
    this.timestamps[writeIdx] = timestamp;
    this.frames[writeIdx].fill(0.0);
    this.setWriteIdx(writeIdx + 1);
    return true;
  }

  _copyChannelPlanar(audioFrame, target, chIdx, format) {
    if (format === "s16") {
      audioFrame.copyTo(this.tempI16, { layout: "planar", planeIndex: chIdx });
      for (let i = 0; i < this.sampleCount; i++) {
        target[i] = this.tempI16[i] / 32768;
      }
    } else {
      audioFrame.copyTo(target, { layout: "planar", planeIndex: chIdx });
    }
  }

  _copyInterleaved(audioFrame, target, format) {
    const isInt16 = format === "s16";
    let temp = isInt16 ? this.tempI16 : this.tempF32;
    audioFrame.copyTo(temp, { layout: "interleaved", planeIndex: 0 });

    let channelOffset = 0;
    for (let ch = 0; ch < this.numChannels; ch++) {
      let elOffset = ch;
      for (let i = 0; i < this.sampleCount; i++) {
        let val = isInt16 ? temp[elOffset] / 32768 : temp[elOffset];
        target[channelOffset + i] = val;
        elOffset += this.numChannels;
      }
      channelOffset += this.sampleCount;
    }
  }
}
