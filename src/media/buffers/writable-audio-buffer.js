import { SharedAudioBuffer } from './shared-audio-buffer.js';

export class WritableAudioBuffer extends SharedAudioBuffer {

  writeFrame(audioFrame) {
    if (audioFrame.numberOfFrames !== this.sampleCount) {
      throw new Error(
        `audioFrame must contain ${this.sampleCount} samples, got ${audioFrame.numberOfFrames}`
      );
    }

    const writeIdx = this.getWriteIdx();
    this.timestamps[writeIdx] = audioFrame.timestamp;

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

}
