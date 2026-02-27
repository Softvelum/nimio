import { ReadableAudioBuffer } from "./readable-audio-buffer";
import { PortMessaging } from "@/shared/port-messaging";
import { currentTimeGetterMs } from "@/shared/helpers";

export class ReadableTransAudioBuffer extends ReadableAudioBuffer {
  constructor(sharedBuf, capacity, sampleRate, numChannels, sampleCount) {
    super(sharedBuf, capacity, sampleRate, numChannels, sampleCount);
    this._getCurTimeMs = currentTimeGetterMs();
    this.init();
  }

  init() {
    this._initMessaging();
    this._startMsgDispatcher();
    this._msgIvalMs = (3 * 1000 * this._sampleCount) / this.sampleRate; // 3 frames
  }

  reset() {
    this._yieldFrames();
    this._stopMsgDispatcher();
    super.reset();
    this._sendMessage({ type: "tb:reset" });
    this._resetMessaging();
  }

  read(startTsNs, outputChannels, step = 1) {
    if (this._dispData.rIdx === undefined) {
      this._dispData.rIdx = this.getReadIdx();
    }

    let processed = super.read(startTsNs, outputChannels, step);
    if (this.ensureCapacity()) {
      return processed;
    }

    if (this._getCurTimeMs() - this._dispData.timeMs >= this._msgIvalMs) {
      this._sendReadStatus(this._dispData.rIdx);
    }
    return processed;
  }

  ensureCapacity() {
    const r = this.getReadIdx();
    const w = this.getWriteIdx();
    if (r === w) return false;

    const minr = this._dispData.rIdx ?? r;
    const free = this._dist(w, minr);
    if (free < this._overflowShift) {
      let freeSize = 2 * this._overflowShift;
      if (r === minr || this._dist(minr, w) - this._dist(r, w) < freeSize) {
        this.setReadIdx(minr + freeSize);
      }
      this._sendReadStatus(minr);
      return true;
    }
    return false;
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

    this._dispData.timeMs = this._getCurTimeMs();
    this._dispData.rIdx = curIdx;
  }

  _yieldFrames() {
    let r = this._dispData.rIdx ?? this.getReadIdx();
    this.setReadIdx(this.getWriteIdx());
    this._sendReadStatus(r);
  }

  _handlePortMessage(event) {
    const msg = event.data;
    if (!msg || msg.aux) return;

    try {
      if (msg.type === "tb:frames") {
        let idx;
        for (let i = 0, n = msg.idxs.length; i < n; i++) {
          idx = msg.idxs[i];
          this._timestamps[idx] = msg.tss[i] || 0;
          this._rates[idx] = msg.rates[i];
          this._frames[idx] = msg.frames[i];
        }
        this.setWriteIdx(idx + 1);
      } else if (msg.type === "tb:overflow") {
        this.ensureCapacity();
      } else if (msg.type === "tb:reset") {
        this.reset();
      }
    } catch (err) {
      console.error("Port message failed", msg.type, err);
    }
  }

  _startMsgDispatcher() {
    this._dispData = { timeMs: this._getCurTimeMs() };
  }

  _stopMsgDispatcher() {
    this._dispData.timeMs = this._dispData.rIdx = undefined;
  }
}

Object.assign(ReadableTransAudioBuffer.prototype, PortMessaging);
