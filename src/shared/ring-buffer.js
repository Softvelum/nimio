import { LoggersFactory } from "./logger";

export class RingBuffer {
  constructor(instName, capacity) {
    this._logger = LoggersFactory.create(instName, "RingBuffer");
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw `Invalid capacity ${capacity}`;
    }

    this._buf = new Array(capacity);
    this._cap = capacity;
    this._head = this._tail = this._length = 0;
  }

  isFull() {
    return this._length === this._cap;
  }

  isEmpty() {
    return this._length === 0;
  }

  push(item, force = false) {
    if (this.isFull()) {
      if (!force) {
        this._logger.error(`Ring buffer is full. Capacity: ${this._cap}`);
        return;
      }

      this._length--; // decrease length to allow increment below
      this._head++;
      if (this._head === this._cap) this._head = 0;
    }

    this._buf[this._tail++] = item;
    if (this._tail === this._cap) this._tail = 0;
    this._length++;
  }

  pop() {
    if (this.isEmpty()) {
      this._logger.warn("Can't pop from empty ring buffer");
      return null;
    }

    const item = this._buf[this._head];
    this.skip();

    return item;
  }

  get(idx) {
    if (this.isEmpty()) {
      this._logger.warn("Can't get from empty ring buffer", idx);
      return null;
    }

    let i = idx;
    if (i < 0) i += this._length;
    if (i < 0 || i >= this._length || i == undefined) {
      this._logger.error("Invalid index for get", idx, this._length);
      return null;
    }

    let index = this._head + i;
    if (index >= this._cap) index -= this._cap;
    return this._buf[index];
  }

  skip() {
    this._buf[this._head] = undefined;
    this._length--;
    this._head++;
    if (this._head === this._cap) this._head = 0;
  }

  reset() {
    this._head = this._tail = this._length = 0;
    this._buf.length = 0; // fast reset of the array
    this._buf.length = this._cap;
  }

  forEach(fn) {
    let index = this._head;
    for (let i = 0; i < this._length; i++) {
      fn(this._buf[index++]);
      if (index >= this._cap) index -= this._cap;
    }
  }

  toArray() {
    const result = [];
    this.forEach(function (item) {
      result.push(item);
    });
    return result;
  }

  get length() {
    return this._length;
  }
}
