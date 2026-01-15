import { ReadableAudioBuffer } from "./readable-audio-buffer";
import { PortMessaging } from "@/shared/port-messaging";

export class ReadableTransAudioBuffer extends ReadableAudioBuffer {
  constructor(sharedBuf, capacity, sampleRate, numChannels, sampleCount) {
    super(sharedBuf, capacity, sampleRate, numChannels, sampleCount);
    this._initMessaging();
    this._minFreeSpan = this._overflowShift - 1;
  }

  read(startTsNs, outputChannels, step = 1) {
    let curIdx = this.getReadIdx();
    let processed = super.read(startTsNs, outputChannels, step);
    this._sendReadStatus(curIdx);

    return processed;
  }

  ensureCapacity() {
    const r = this.getReadIdx();
    const w = this.getWriteIdx();
    const free = r >= w ? r - w : this._capacity - w + r;
    if (free < this._minFreeSpan) {
      console.warn("ensure Capacity!");
      this.setReadIdx(r + this._overflowShift);
      this._sendReadStatus(r);
    }

  }

  reset() {
    super.reset();
    this._sendMessage({ type: "tb:reset" });
    this._resetMessaging();
  }

  _sendReadStatus(startIdx) {
    let curIdx = this.getReadIdx();
    let fCount = curIdx - startIdx;
    if (fCount < 0) fCount += this._capacity;
    if (fCount === 0) return;

    let transfer = [];
    let frames = [];
    let idx = startIdx;
    for (let i = 0; i < fCount; i++) {
      transfer.push(this._frames[idx].buffer);
      frames.push(this._frames[idx]);
      idx++;
      if (idx === this._capacity) idx = 0;
    }
    this._sendMessage(
      {
        type: "tb:read",
        start: startIdx,
        end: curIdx,
        frames,
      },
      transfer,
    );
  }

  _handlePortMessage(event) {
    const msg = event.data;
    // if (msg && msg.type === "log") {
    //   console.warn("handlePortMessage readable log");
    // }

    if (!msg || msg.type === "log") return;

    try {
      if (msg.type === "tb:frame" && msg.frame) {
        this._timestamps[msg.idx] = msg.ts || 0;
        this._rates[msg.idx] = msg.rate;
        this._frames[msg.idx] = msg.frame;
        this.setWriteIdx(msg.idx);
      } else if (msg.type === "tb:reset") {
        this.reset();
      }
    } catch (err) {
      console.error("Port message failed", msg.type, err);
    }
  }
}

Object.assign(ReadableTransAudioBuffer.prototype, PortMessaging);
