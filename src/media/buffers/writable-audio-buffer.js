import { SharedAudioBuffer } from "./shared-audio-buffer";

export class WritableAudioBuffer extends SharedAudioBuffer {
  constructor(sharedBuffer, capacity, sampleRate, numChannels, sampleCount) {
    super(sharedBuffer, capacity, sampleRate, numChannels, sampleCount);
    this._preprocessors = [];
    this._port = null;
    this._pendingMessages = [];
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
    if (!this.isShareable) {
      this._sendMessage({ type: "audio:reset" });
    }
  }

  pushFrame(audioFrame) {
    if (audioFrame.numberOfFrames !== this.sampleCount) {
      throw new Error(
        `audioFrame must contain ${this.sampleCount} samples, got ${audioFrame.numberOfFrames}`,
      );
    }

    for (let i = 0; i < this._preprocessors.length; i++) {
      let pRes = this._preprocessors[i].process(audioFrame, this);
      if (!pRes) return;
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
    if (!this.isShareable) {
      this._sendFrame(audioFrame);
    }
    return true;
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

  pushSilence(timestamp) {
    const writeIdx = this.getWriteIdx();
    this.timestamps[writeIdx] = timestamp;
    this.frames[writeIdx].fill(0.0);
    this.setWriteIdx(writeIdx + 1);
    if (!this.isShareable) {
      this._sendMessage({
        type: "audio:silence",
        timestamp,
        sampleCount: this.sampleCount,
        channels: this.numChannels,
      });
    }
    return true;
  }

  pushPcm(timestamp, pcmData) {
    if (!(pcmData instanceof Float32Array)) {
      throw new Error("pcmData must be a Float32Array");
    }
    if (pcmData.length !== this.frameSize) {
      throw new Error(
        `pcmData length mismatch: expected ${this.frameSize}, got ${pcmData.length}`,
      );
    }
    const writeIdx = this.getWriteIdx();
    this.timestamps[writeIdx] = timestamp;
    this.frames[writeIdx].set(pcmData);
    this.setWriteIdx(writeIdx + 1);
    return true;
  }

  setPort(port) {
    if (this._port === port) return;
    this._port = port;
    if (this._port?.start) this._port.start();

    if (this._pendingMessages.length) {
      for (let i = 0; i < this._pendingMessages.length; i++) {
        this._postMessage(
          this._pendingMessages[i].data,
          this._pendingMessages[i].transfer,
        );
      }
      this._pendingMessages.length = 0;
    }
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

  _sendFrame(audioFrame) {
    // Send a copy of PCM data to the worklet to avoid relying on transferable AudioData in non-COOP/COEP mode.
    let idx = this.getWriteIdx() - 1;
    if (idx < 0) idx += this.capacity;
    const pcmCopy = this.frames[idx].slice();
    this._sendMessage(
      {
        type: "audio:pcm",
        timestamp: this.timestamps[idx],
        pcm: pcmCopy,
      },
      [pcmCopy.buffer],
    );
  }

  _sendMessage(data, transfer = []) {
    if (!this._port) {
      this._pendingMessages.push({ data, transfer });
      return;
    }
    this._postMessage(data, transfer);
  }

  _postMessage(data, transfer) {
    if (!this._port) return;
    try {
      this._port.postMessage(data, transfer);
    } catch (e) {
      // If posting fails, keep the message to retry later.
      this._pendingMessages.push({ data, transfer });
    }
  }
}
