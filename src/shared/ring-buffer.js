import LoggersFactory from "./logger";

export class RingBuffer {
  constructor(instName, capacity) {
    this._logger = LoggersFactory.create(instName, "RingBuffer");
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw `Invalid capacity ${capacity}`;
    }

    this.buffer = new Array(capacity);
    this.capacity = capacity;
    this.head = this.tail = this.length = 0;
  }

  isFull() {
    return this.length === this.capacity;
  }

  isEmpty() {
    return this.length === 0;
  }

  push(item, force = false) {
    if (this.isFull()) {
      if (!force) {
        this._logger.error(`Ring buffer is full. Capacity: ${this.capacity}`);
        return;
      }

      this.length--; // decrease length to allow increment below
      this.head++;
      if (this.head === this.capacity) this.head = 0;
    }

    this.buffer[this.tail++] = item;
    if (this.tail === this.capacity) this.tail = 0;
    this.length++;
  }

  pop() {
    if (this.isEmpty()) {
      this._logger.warn("Can't pop from empty ring buffer");
      return null;
    }

    const item = this.buffer[this.head];
    this.skip();

    return item;
  }

  get(idx) {
    if (this.isEmpty()) {
      this._logger.warn("Can't get from empty ring buffer", idx);
      return null;
    }

    let i = idx;
    if (i < 0) i += this.length;
    if (i < 0 || i >= this.length || i == undefined) {
      this._logger.error("Invalid index for get", idx, this.length);
      return null;
    }

    let index = this.head + i;
    if (index >= this.capacity) index -= this.capacity;
    return this.buffer[index];
  }

  skip() {
    this.buffer[this.head] = undefined;
    this.length--;
    this.head++;
    if (this.head === this.capacity) this.head = 0;
  }

  reset() {
    this.head = this.tail = this.length = 0;
    this.buffer.length = 0; // fast reset of the array
    this.buffer.length = this.capacity;
  }

  forEach(fn) {
    let index = this.head;
    for (let i = 0; i < this.length; i++) {
      fn(this.buffer[index++]);
      if (index >= this.capacity) index -= this.capacity;
    }
  }

  toArray() {
    const result = [];
    this.forEach(function (item) {
      result.push(item);
    });
    return result;
  }
}
