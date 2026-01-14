import { WritableAudioBuffer } from "./writable-audio-buffer";
import { PortMessaging } from "@/shared/port-messaging";

export class WritableTransAudioBuffer extends WritableAudioBuffer {
  constructor(sharedBuf, capacity, sampleRate, numChannels, sampleCount) {
    super(sharedBuf, capacity, sampleRate, numChannels, sampleCount);
    this._initMessaging();
  }

  reset() {
    super.reset();
    this._sendMessage({ type: "tb:reset" });
    this._resetMessaging();
  }

  pushFrame(audioFrame) {
    const writeIdx = super.pushFrame(audioFrame);
    this._sendFrame(writeIdx);
  }

  pushSilence(timestamp) {
    const writeIdx = super.pushSilence(timestamp);
    this._sendFrame(writeIdx);
  }

  _sendFrame(idx) {
    this._sendMessage(
      {
        idx,
        type: "tb:frame",
        ts: this._timestamps[idx],
        rate: this._rates[idx],
        frame: this._frames[idx],
      },
      [this._frames[idx].buffer],
    );
  }

  _handlePortMessage(event) {
    const msg = event.data;
    // if (msg && msg.type === "log") {
    //   console.warn("handlePortMessage writable log");
    // }

    if (!msg || msg.type === "log") return;

    try {
      if (msg.type === "tb:read") {
        let fCount = msg.end - msg.start;
        if (fCount < 0) fCount += this._capacity;
        let idx = msg.start;
        for (let i = 0; i < fCount; i++) {
          this._frames[idx++] = msg.frames[i];
          if (idx === this._capacity) idx = 0;
        }
        this.setReadIdx(msg.end);
        // this._portFramesReceived++;
        // if (this._portFramesReceived <= 3) {
        //   console.debug(
        //     "Audio PCM via port",
        //     pcm.length,
        //     this._audioBuffer.sampleRate,
        //     `${this._audioBuffer.numChannels}ch`,
        //   );
        // }
      } else if (msg.type === "tb:reset") {
        this.reset();
      }
    } catch (err) {
      console.error("Port message failed", msg.type, err);
    }
  }
}

Object.assign(WritableTransAudioBuffer.prototype, PortMessaging);
