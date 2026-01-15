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
    if (this._isDetached()) return -1;

    const writtenIdx = super.pushFrame(audioFrame);
    this._sendFrame(writtenIdx);
    return writtenIdx;
  }

  pushSilence(timestamp) {
    if (this._isDetached()) return -1;

    const writtenIdx = super.pushSilence(timestamp);
    this._sendFrame(writtenIdx);
    return writtenIdx;
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

  _isDetached() {
    const writeIdx = this.getWriteIdx();
    if (this._frames[writeIdx].length === 0) {
      console.warn(`Can't write to detached buffer ${writeIdx}. Read idx = ${this.getReadIdx()}. Skip it.`);
      return true;
    }
    return false;
  }

  _handlePortMessage(event) {
    const msg = event.data;
    // if (msg && msg.type === "log") {
    //   console.warn("handlePortMessage writable log");
    // }

    if (!msg || msg.type === "log") return;

    try {
      if (msg.type === "tb:read") {
        let rIdx = this.getReadIdx();
        let wIdx = this.getWriteIdx();
        console.log(`Released ${msg.start} - ${msg.end}, rIdx = ${rIdx}, wIdx = ${wIdx}`);
        if (rIdx !== msg.start) {
          console.error(`Wrong read idx received: start=${msg.start}, end=${msg.end}, cur read idx is ${rIdx}`);
        }
        let fCount = msg.end - msg.start;
        if (fCount < 0) fCount += this._capacity;
        let idx = msg.start;
        for (let i = 0; i < fCount; i++) {
          this._frames[idx++] = msg.frames[i];
          if (idx === this._capacity) idx = 0;
        }
        this.setReadIdx(msg.end);
        if (fCount === this._overflowShift) {
          let w = this.getWriteIdx();
          let r = this.getReadIdx();
          let free = r >= w ? r - w : this._capacity - w + r;
          console.log(`Returned ${this._overflowShift} frames from ${msg.start} to ${msg.end} due to overflow, free = ${free}`);
        }
      } else if (msg.type === "tb:reset") {
        this.reset();
      }
    } catch (err) {
      console.error("Port message failed", msg.type, err);
    }
  }
}

Object.assign(WritableTransAudioBuffer.prototype, PortMessaging);
