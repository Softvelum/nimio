import { SharedAudioBuffer } from './shared-audio-buffer.js';

export class ReadableAudioBuffer extends SharedAudioBuffer {

  readFrame(timestamp, outputChannels) {
    if (outputChannels.length !== this.numChannels) {
      throw new Error("outputChannels must match numChannels");
    }
  
    const readIdx = this.getReadIdx();
    const curTs = this.timestamps[readIdx];
  
    let offset = 0;
    for (let ch = 0; ch < this.numChannels; ch++) {
      outputChannels[ch].set(
        this.frames[readIdx].subarray(offset, offset + this.sampleCount)
      );
      offset += this.sampleCount;
    }
    this.setReadIdx(readIdx + 1)
  
    return true;
  }


}