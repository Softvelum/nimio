import { LoggersFactory } from "./logger";

export class RingQueue {
  constructor(instName, capacity = 512) {
    this._logger = LoggersFactory.create(instName, "RingQueue");
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw `Invalid capacity ${capacity}`;
    }

    this._buf = new Array(capacity);
    this._cap = capacity;
    this.clear();
  }

  clear() {
    this._head = this._tail = this._length = 0;
  }

  isFull() {
    return this._length === this._cap;
  }

  isEmpty() {
    return this._length === 0;
  }

  pushBack(v) {
    this._buf[this._tail] = v;
    this._tail = this._next(this._tail);
    if (this._length < this._cap) {
      this._length++;
    } else {
      this._logger.warn("pushBack() overflow");
      this._head = this._next(this._head);
    }
  }

  popBack() {
    if (this.isEmpty()) return null;

    this._tail = this._prev(this._tail);
    const v = this._buf[this._tail];
    this._length--;
    return v;
  }

  pushFront(v) {
    this._head = this._prev(this._head);
    this._buf[this._head] = v;
    if (this._length < this._cap) {
      this._length++;
    } else {
      this._logger.warn("pushFront() overflow");
      this._tail = this._prev(this._tail);
    }
  }

  popFront() {
    if (this.isEmpty()) return null;

    const v = this._buf[this._head];
    this._head = this._next(this._head);
    this._length--;
    return v;
  }

  front() {
    return this.isEmpty() ? null : this._buf[this._head];
  }

  back() {
    return this.isEmpty() ? null : this._buf[this._prev(this._tail)];
  }

  get length() {
    return this._length;
  }

  _next(i) {
    return (i + 1) % this._cap;
  }

  _prev(i) {
    return (i - 1 + this._cap) % this._cap;
  }
}
