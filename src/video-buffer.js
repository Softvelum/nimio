import LoggersFactory from "./shared/logger.js";
import { RingBuffer } from "./utils/ring-buffer.js";

export class VideoBuffer {
  constructor(instName, maxFrames = 100) {
    // TODO: length in uSec?
    this._frames = new RingBuffer(instName, maxFrames);
    this._logger = LoggersFactory.create(instName, "Video Buffer");
    this._lastFrameTs = 0;
  }

  addFrame(frame, timestamp) {
    if (this._frames.isFull()) {
      const removed = this._frames.pop();
      this._logger.warn(
        `VideoBuffer: overflow, removed old frame ${removed.timestamp}`,
      );
      removed.frame.close();
    }

    this._frames.push({ frame, timestamp });
    if (timestamp > this._lastFrameTs) {
      this._lastFrameTs = timestamp;
    }
  }

  getFrameForTime(currentTime) {
    if (this._frames.isEmpty()) {
      // this._logger.warn(`VideoBuffer: empty at ts: ${currentTime.toFixed(3)}`);
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
      if (frame && frame.frame) {
        frame.frame.close();
      }
    }

    const frame = this._frames.pop();
    // return the last frame earlier than currentTime
    return frame.frame;
  }

  clear() {
    this._frames.forEach(({ frame, _ }) => {
      frame.close();
    });
    this._frames.reset();
    this._lastFrameTs = 0;
  }

  get length() {
    return this._frames.length;
  }

  get lastFrameTs() {
    return this._lastFrameTs;
  }
}
