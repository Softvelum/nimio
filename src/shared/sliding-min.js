import { RingQueue } from "./ring-queue";

export class SlidingMin {
  constructor(instName, windowSizeMs, capacity = 512) {
    this._windowSize = windowSizeMs;
    this._vals = new RingQueue(instName, capacity);
    this._times = new RingQueue(instName, capacity);
  }

  push(value, timeMs) {
    // Remove all larger values from the tail
    while (!this._vals.isEmpty() && this._vals.back > value) {
      this._vals.popBack();
      this._times.popBack();
    }

    this._vals.pushBack(value);
    this._times.pushBack(timeMs);

    this._expire(timeMs);
  }

  getMin(timeMs) {
    this._expire(timeMs);

    if (this._vals.length === 0) return null;
    return this._vals.front;
  }

  clear() {
    this._times.clear();
    this._vals.clear();
  }

  _expire(timeMs) {
    // Remove old items outside the window (from the head)
    const cutoff = timeMs - this._windowSize;
    while (!this._times.isEmpty() && this._times.front < cutoff) {
      this._times.popFront();
      this._vals.popFront();
    }
  }
}
