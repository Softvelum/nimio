import { WritableAudioBuffer } from "./writable-audio-buffer";
import { PortMessaging } from "@/shared/port-messaging";

export class WritableTransAudioBuffer extends WritableAudioBuffer {
  constructor(sharedBuf, capacity, sampleRate, numChannels, sampleCount) {
    super(sharedBuf, capacity, sampleRate, numChannels, sampleCount);
    this.init();
  }

  init() {
    this._initMessaging();
    this._startMsgDispatcher();
  }

  reset(final) {
    if (!final) {
      this._stopMsgDispatcher();
      this._sendMessage({ type: "tb:reset" });
      return;
    }

    super.reset();
    this._resetMessaging();
  }

  pushFrame(audioFrame) {
    if (this._isDetached()) return -1;

    const writtenIdx = super.pushFrame(audioFrame);
    this._scheduleFrame(writtenIdx);
    return writtenIdx;
  }

  pushSilence(timestamp) {
    if (this._isDetached()) return -1;

    const writtenIdx = super.pushSilence(timestamp);
    this._scheduleFrame(writtenIdx);
    return writtenIdx;
  }

  _handlePortMessage(event) {
    const msg = event.data;
    if (!msg || msg.log || msg.aux) return;

    try {
      if (msg.type === "tb:read") {
        let rIdx = this.getReadIdx();
        let wIdx = this.getWriteIdx();
        // console.log(`Released ${msg.start} - ${msg.end}, rIdx = ${rIdx}, wIdx = ${wIdx}`);
        if (rIdx !== msg.start) {
          console.error(
            `Wrong read idx received: start=${msg.start}, end=${msg.end}, cur read idx is ${rIdx}`,
          );
        }
        let fCount = msg.end - msg.start;
        if (fCount < 0) fCount += this._capacity;
        let idx = msg.start;
        for (let i = 0; i < fCount; i++) {
          this._frames[idx++] = msg.frames[i];
          if (idx === this._capacity) idx = 0;
        }
        this.setReadIdx(msg.end);
        // if (fCount === this._overflowShift * 2) {
        //   let w = this.getWriteIdx();
        //   let r = this.getReadIdx();
        //   let free = this._dist(w, r);
        //   console.log(`Returned ${this._overflowShift * 2} frames from ${msg.start} to ${msg.end} due to overflow, free = ${free}`);
        // }
      } else if (msg.type === "tb:reset") {
        this.reset(true);
      }
    } catch (err) {
      console.error("Port message failed", msg.type, err);
    }
  }

  _isDetached() {
    const writeIdx = this.getWriteIdx();
    if (this._frames[writeIdx].length === 0) {
      console.warn(
        `Can't write to detached buffer ${writeIdx}. Read idx = ${this.getReadIdx()}. Skip it.`,
      );
      return true;
    }
    return false;
  }

  _scheduleFrame(idx) {
    this._dispData.tss.push(this._timestamps[idx]);
    this._dispData.idxs.push(idx);
    this._dispData.rates.push(this._rates[idx]);
    this._dispData.frames.push(this._frames[idx]);
    this._dispData.buffers.push(this._frames[idx].buffer);
  }

  _sendFrames() {
    if (this._dispData.idxs.length === 0) return;

    this._sendMessage(
      {
        idxs: this._dispData.idxs,
        type: "tb:frames",
        tss: this._dispData.tss,
        rates: this._dispData.rates,
        frames: this._dispData.frames,
      },
      this._dispData.buffers,
    );

    this._dispData.tss = [];
    this._dispData.idxs = [];
    this._dispData.rates = [];
    this._dispData.frames = [];
    this._dispData.buffers = [];
  }

  _startMsgDispatcher() {
    this._dispData = { tss: [], idxs: [], rates: [], frames: [], buffers: [] };
    this._runMsgDispatcher = this._sendFrames.bind(this);
    this._msgDispTimer = setInterval(this._runMsgDispatcher, 40);
  }

  _stopMsgDispatcher() {
    this._clearMsgDispatcherData();
    if (this._msgDispTimer) {
      clearInterval(this._msgDispTimer);
      this._msgDispTimer = undefined;
      this._runMsgDispatcher = undefined;
    }
  }

  _clearMsgDispatcherData() {
    this._dispData.tss.length = 0;
    this._dispData.idxs.length = 0;
    this._dispData.rates.length = 0;
    this._dispData.frames.length = 0;
    this._dispData.buffers.length = 0;
  }

  _incWriteIdx(writeIdx) {
    let wIdx = this.setWriteIdx(writeIdx + 1);
    let rIdx = this.getReadIdx();
    if (this._dist(wIdx, rIdx) < this._overflowShift) {
      console.warn(
        `wIdx = ${wIdx}, rIdx = ${rIdx}, send req to free items from the reader`,
      );
      this._sendMessage({ type: "tb:overflow" });
    }
  }
}

Object.assign(WritableTransAudioBuffer.prototype, PortMessaging);
