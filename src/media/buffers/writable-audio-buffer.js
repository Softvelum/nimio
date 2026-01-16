import { SharedAudioBuffer } from "./shared-audio-buffer";

export class WritableAudioBuffer extends SharedAudioBuffer {
  constructor(sharedBuffer, capacity, sampleRate, numChannels, sampleCount) {
    super(sharedBuffer, capacity, sampleRate, numChannels, sampleCount);
    this._port = null;
    this._pendingMessages = [];
  }

  reset() {
    super.reset();
    if (!this.isShareable) {
      this._sendMessage({ type: "audio:reset" });
    }
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

    this.setWriteIdx(writeIdx + 1);
    if (!this.isShareable) {
      this._sendFrame(audioFrame);
    }
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
    this._timestamps[writeIdx] = timestamp;
    this._rates[writeIdx] = 1;
    this._frames[writeIdx].fill(0);
    this.setWriteIdx(writeIdx + 1);
    if (!this.isShareable) {
      this._sendMessage({
        type: "audio:silence",
        timestamp,
        rate: 1,
        sampleCount: this._sampleCount,
        channels: this.numChannels,
      });
    }
    return true;
  }

  pushPcm(timestamp, rate, pcmData) {
    if (timestamp === null || timestamp === undefined) {
      throw new Error("timestamp is required for pushPcm");
    }
    if (!(pcmData instanceof Float32Array)) {
      throw new Error("pcmData must be a Float32Array");
    }
    if (pcmData.length !== this.frameSize) {
      throw new Error(
        `pcmData length mismatch: expected ${this.frameSize}, got ${pcmData.length}`,
      );
    }
    const writeIdx = this.getWriteIdx();
    this._timestamps[writeIdx] = timestamp;
    this._rates[writeIdx] = rate;
    this._frames[writeIdx].set(pcmData);
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

  _sendFrame() {
    // Send a copy of PCM data to the worklet to avoid relying on transferable AudioData in non-COOP/COEP mode.
    let idx = this.getWriteIdx() - 1;
    if (idx < 0) idx += this._capacity;
    const pcmCopy = this._frames[idx].slice();
    this._sendMessage(
      {
        type: "audio:pcm",
        timestamp: this._timestamps[idx],
        rate: this._rates[idx],
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
