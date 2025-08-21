import LoggersFactory from "@/shared/logger.js";
import { RingBuffer } from "@/shared/ring-buffer.js";

export class FrameBuffer {
  constructor(instName, type, maxFrames = 100) {
    // TODO: length in uSec?
    this._frames = new RingBuffer(`${instName} ${type}`, maxFrames);
    this._logger = LoggersFactory.create(instName, "${type} Buffer");
    this._firstFrameTs = this._lastFrameTs = 0;
  }

  pushFrame(frame) {
    if (this._frames.isFull()) {
      const removed = this._frames.pop();
      this._logger.warn(`overflow, removed old frame ${removed.timestamp}`);
      this._disposeFrame(removed);
      this._updateFirstFrameTs();
    }

    this._frames.push(frame);
    if (frame.timestamp > this._lastFrameTs) {
      this._lastFrameTs = frame.timestamp;
    }
    if (this._firstFrameTs === 0) {
      this._firstFrameTs = frame.timestamp;
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
      this._disposeFrame(this._frames.pop());
    }

    const frame = this._frames.pop();
    this._updateFirstFrameTs();
    if (this._frames.isEmpty()) this._lastFrameTs = 0;

    // return the last frame earlier than currentTime
    return frame;
  }

  absorb(frameBuffer) {
    frameBuffer.forEach((frame) => {
      if (frame.timestamp > this._lastFrameTs) {
        this.pushFrame(frame);
      }
    });

    frameBuffer.reset({keepFrames: true});
  }

  reset(opts = {}) {
    if (!opts.keepFrames) {
      this._frames.forEach((frame) => {
        this._disposeFrame(frame);
      });
    }

    this._frames.reset();
    this._firstFrameTs = this._lastFrameTs = 0;
  }

  forEach(callback) {
    this._frames.forEach(callback);
  }

  get length() {
    return this._frames.length;
  }

  get firstFrameTs() {
    return this._firstFrameTs;
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

  _disposeFrame(frame) {
    if (frame) frame.close();
  }
}
