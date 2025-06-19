import { SharedAudioBuffer } from './shared-audio-buffer.js';

export class WritableAudioBuffer extends SharedAudioBuffer {
  constructor(sharedBuffer, capacity, sampleRate, numChannels, sampleCount) {
    super(sharedBuffer, capacity, sampleRate, numChannels, sampleCount);
    this._preprocessors = [];
  }

  addPreprocessor(preprocessor) {
    this._preprocessors.push(preprocessor);
    preprocessor.setBufferIface(this);
  }

  reset () {
    super.reset();
    for (let i = 0; i < this._preprocessors.length; i++) {
      this._preprocessors[i].reset();
    }
    this._preprocessors.length = 0;
  }

  pushFrame(audioFrame) {
    if (audioFrame.numberOfFrames !== this.sampleCount) {
      throw new Error(
        `audioFrame must contain ${this.sampleCount} samples, got ${audioFrame.numberOfFrames}`
      );
    }

    for (let i = 0; i < this._preprocessors.length; i++) {
      this._preprocessors[i].process(audioFrame, this);
    }

    const writeIdx = this.getWriteIdx();
    this.timestamps[writeIdx] = audioFrame.rawTimestamp;

    if (audioFrame.format.endsWith("-planar")) {
      let offset = 0;
      for (let ch = 0; ch < this.numChannels; ch++) {
        audioFrame.copyTo(
          this.frames[writeIdx].subarray(offset, offset + this.sampleCount),
          {planeIndex: ch}
        );
        offset += this.sampleCount;
      }
    } else {
      audioFrame.copyTo(this.frames[writeIdx], { planeIndex: 0 });
    }

    this.setWriteIdx(writeIdx + 1);
    return true;
  }

  pushSilence(timestamp) {
    const writeIdx = this.getWriteIdx();
    this.timestamps[writeIdx] = timestamp;
    this.frames[writeIdx].fill(0);
    this.setWriteIdx(writeIdx + 1);
    return true;
  }

}
