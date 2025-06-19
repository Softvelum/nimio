import LoggersFactory from "../../shared/logger.js";
import { RingBuffer } from "../../shared/ring-buffer.js";

export class VideoBuffer {

  constructor(instName, maxFrames = 100) {
    // TODO: length in uSec?
    this._frames = new RingBuffer(`${instName} Video`, maxFrames);
    this._logger = LoggersFactory.create(instName, "Video Buffer");
    this._firstFrameTs = this._lastFrameTs = 0;
  }

  addFrame(frame, timestamp) {
    if (this._frames.isFull()) {
      const removed = this._frames.pop();
      this._logger.warn(`overflow, removed old frame ${removed.timestamp}`);
      this._disposeFrame(removed);
      this._updateFirstFrameTs();
    }

    this._frames.push({ frame, timestamp });
    if (timestamp > this._lastFrameTs) {
      this._lastFrameTs = timestamp;
    }
    if (this._firstFrameTs === 0) {
      this._firstFrameTs = timestamp;
    }
  }

  popFrameForTime(currentTime) {
    if (this._frames.isEmpty()) {
      // this._logger.warn(`empty at ts: ${currentTime.toFixed(3)}`);
      return null;
    }

    // find a frame nearest to currentTime
    let lastIdx = -1;
    for (let i = 0; i < this._frames.length; i++) {
      let frame = this._frames.get(i);
      if (frame && frame.timestamp > currentTime) {
        break;
      }
      lastIdx = i;
    }

    // nothing to show, too early
    if (lastIdx < 0) {
      return null;
    }

    for (let i = 0; i < lastIdx; i++) {
      let frame = this._frames.pop();
      this._disposeFrame(frame);
    }

    const frame = this._frames.pop();
    this._updateFirstFrameTs();
    if (this._frames.isEmpty()) this._lastFrameTs = 0;

    // return the last frame earlier than currentTime
    return frame.frame;
  }

  clear() {
    this._frames.forEach((frame) => {
      this._disposeFrame(frame);
    });

    this._frames.reset();
    this._firstFrameTs = this._lastFrameTs = 0;
  }

  get length() {
    return this._frames.length;
  }

  get lastFrameTs() {
    return this._lastFrameTs;
  }

  getTimeCapacity() {
    if (this._frames.isEmpty()) {
      return 0;
    }
    return (this._lastFrameTs - this._firstFrameTs) / 1000_000;
  }

  _updateFirstFrameTs() {
    if (this._frames.isEmpty()) {
      this._firstFrameTs = 0;
      return;
    }
    this._firstFrameTs = this._frames.get(0).timestamp;
  }

  _disposeFrame(data) {
    if (data && data.frame) {
      data.frame.close();
    }
  }
}

