import { LoggersFactory } from "@/shared/logger";
import { RingBuffer } from "@/shared/ring-buffer";

export class FrameBuffer {
  constructor(instName, type, maxFrames = 100) {
    // TODO: length in uSec?
    this._frames = new RingBuffer(`${instName} ${type}`, maxFrames);
    this._logger = LoggersFactory.create(instName, "${type} Buffer");
    this._firstFrameTs = this._lastFrameTs = 0;
    this._hasOutOfOrder = false;
    this._reorderStats = { count: 0, totalMs: 0, maxMs: 0 };
    this._reorderLogEvery = 30;
  }

  pushFrame(frame) {
    if (this._frames.isFull()) {
      const removed = this._frames.pop();
      // this._logger.warn(`overflow, removed old frame ${removed.timestamp}`);
      this._disposeFrame(removed);
      this._updateFirstFrameTs();
    }

    if (this._lastFrameTs && frame.timestamp < this._lastFrameTs) {
      this._hasOutOfOrder = true;
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

    if (this._hasOutOfOrder) {
      return this._popFrameForTimeOutOfOrder(currentTime);
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
      } else {
        this._disposeFrame(frame);
      }
    });

    frameBuffer.reset({ keepFrames: true });
  }

  reset(opts = {}) {
    if (!opts.keepFrames) {
      this._frames.forEach((frame) => {
        this._disposeFrame(frame);
      });
    }

    this._frames.reset();
    this._firstFrameTs = this._lastFrameTs = 0;
    this._hasOutOfOrder = false;
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

  _popFrameForTimeOutOfOrder(currentTime) {
    const doStats =
      typeof LoggersFactory.isDebugEnabled === "function" &&
      LoggersFactory.isDebugEnabled();
    const startMs = doStats
      ? typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now()
      : 0;
    const frames = this._frames.toArray();
    let candidate = null;
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      if (!frame) continue;
      if (frame.timestamp <= currentTime) {
        if (!candidate || frame.timestamp > candidate.timestamp) {
          candidate = frame;
        }
      }
    }

    if (!candidate) return null;

    let splitIdx = -1;
    let scanned = 0;
    for (let i = 1; i < frames.length; i++) {
      const prev = frames[i - 1];
      const cur = frames[i];
      scanned += 1;
      if (!prev || !cur) continue;
      if (cur.timestamp < prev.timestamp) {
        splitIdx = i - 1;
        break;
      }
    }

    const prefix = splitIdx >= 0 ? frames.slice(0, splitIdx + 1) : frames;
    const tail = splitIdx >= 0 ? frames.slice(splitIdx + 1) : [];
    if (tail.length > 1) {
      tail.sort((a, b) => a.timestamp - b.timestamp);
    }

    const remaining = [];
    let pIdx = 0;
    let tIdx = 0;
    let disposed = 0;
    while (pIdx < prefix.length || tIdx < tail.length) {
      let frame;
      if (pIdx >= prefix.length) {
        frame = tail[tIdx++];
      } else if (tIdx >= tail.length) {
        frame = prefix[pIdx++];
      } else if (prefix[pIdx].timestamp <= tail[tIdx].timestamp) {
        frame = prefix[pIdx++];
      } else {
        frame = tail[tIdx++];
      }

      if (!frame) continue;
      if (frame === candidate) continue;
      if (frame.timestamp <= candidate.timestamp) {
        this._disposeFrame(frame);
        disposed += 1;
      } else {
        remaining.push(frame);
      }
    }

    this._frames.reset();
    this._firstFrameTs = this._lastFrameTs = 0;
    for (let i = 0; i < remaining.length; i++) {
      this._frames.push(remaining[i], true);
      if (remaining[i].timestamp > this._lastFrameTs) {
        this._lastFrameTs = remaining[i].timestamp;
      }
      if (this._firstFrameTs === 0) {
        this._firstFrameTs = remaining[i].timestamp;
      }
    }

    this._hasOutOfOrder = false;
    if (doStats) {
      const endMs =
        typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      const durMs = endMs - startMs;
      this._reorderStats.count += 1;
      this._reorderStats.totalMs += durMs;
      if (durMs > this._reorderStats.maxMs) this._reorderStats.maxMs = durMs;
      if (this._reorderStats.count % this._reorderLogEvery === 0) {
        const avgMs = this._reorderStats.totalMs / this._reorderStats.count;
        this._logger.debug(
          `Reorder stats: count=${this._reorderStats.count}, avg=${avgMs.toFixed(
            3,
          )}ms, max=${this._reorderStats.maxMs.toFixed(
            3,
          )}ms, frames=${frames.length}, scanned=${scanned}, tail=${tail.length}, disposed=${disposed}`,
        );
      }
    }
    return candidate;
  }
}
