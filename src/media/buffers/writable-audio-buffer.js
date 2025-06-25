import { SharedAudioBuffer } from "./shared-audio-buffer.js";

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

    if (audioFrame.format.endsWith("-planar")) {
      let offset = 0;
      for (let ch = 0; ch < this.numChannels; ch++) {
        audioFrame.copyTo(
          this.frames[writeIdx].subarray(offset, offset + this.sampleCount),
          { layout: "planar", planeIndex: ch },
        );
        offset += this.sampleCount;
      }
    } else {
      if (this.numChannels === 1) {
        audioFrame.copyTo(this.frames[writeIdx], {
          layout: "planar",
          planeIndex: 0,
        });
      } else {
        audioFrame.copyTo(this.temp, { layout: "interleaved", planeIndex: 0 });
        let channelOffset = 0;
        for (let ch = 0; ch < this.numChannels; ch++) {
          let elOffset = ch;
          for (let i = 0; i < this.sampleCount; i++) {
            this.frames[writeIdx][channelOffset + i] = this.temp[elOffset];
            elOffset += this.numChannels;
          }
          channelOffset += this.sampleCount;
        }
      }
    }

    this.setWriteIdx(writeIdx + 1);
    return true;
  }

  pushSilence(timestamp) {
    const writeIdx = this.getWriteIdx();
    this.timestamps[writeIdx] = timestamp;
    this.frames[writeIdx].fill(0.0);
    this.setWriteIdx(writeIdx + 1);
    return true;
  }
}
