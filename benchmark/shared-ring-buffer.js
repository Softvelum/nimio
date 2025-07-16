const META = {
  READ_OFFSET: 0,
  WRITE_OFFSET: 1,
  FRAME_COUNT: 2,
  NOTIFY_FLAG: 3,
  UNRELEASED_OFFSET: 4,
  LAST_FRAME_START: 5,
};

class SharedRingBuffer {
  static META_READ_OFFSET = 0;
  static META_WRITE_OFFSET = 1;
  static META_FRAME_COUNT = 2;
  static META_NOTIFY_FLAG = 3;
  static META_FIRST_UNRELEASED_OFFSET = 4;
  static META_LAST_FRAME_START = 5;

  constructor(dataBuffer, metaBuffer, capacity) {
    this._data = new Uint8Array(dataBuffer);
    this._meta = new Int32Array(metaBuffer); // META
    this._view = new DataView(this._data.buffer);
    this._capacity = capacity;
    this._pending = [];
  }

  static allocate(bufferSec, frameSize, frameRate) {
    if (!bufferSec || !frameSize || !frameRate) {
      throw new Error("Invalid parameters for SharedTransportBuffer allocation");
    }
    
    const capacity = Math.ceil(bufferSec * frameSize * frameRate);
    const dataBuffer = new SharedArrayBuffer(capacity * Uint8Array.BYTES_PER_ELEMENT);
    const metaCnt = Object.keys(META).length;
    const metaBuffer = new SharedArrayBuffer(metaCnt * Int32Array.BYTES_PER_ELEMENT);

    return new this(
      dataBuffer,
      metaBuffer,
      capacity,
    );
  }

  write(frame) {
    const frameLength = frame.length;
    const totalSize = 4 + frameLength;
    if (totalSize > this._capacity) return false;

    let readOffset = Atomics.load(this._meta, META.READ_OFFSET);
    let writeOffset = Atomics.load(this._meta, META.WRITE_OFFSET);
    let firstUnreleasedOffset = Atomics.load(this._meta, META.UNRELEASED_OFFSET);
    const limitOffset = firstUnreleasedOffset || readOffset;

    let available;
    if (writeOffset >= limitOffset) {
      available = this._capacity - writeOffset + limitOffset;
    } else {
      available = limitOffset - writeOffset;
    }

    if (totalSize > available) return false;

    if (writeOffset + totalSize > this._capacity) {
      writeOffset = 0;
      if (totalSize > limitOffset) return false;
    }

    Atomics.store(this._meta, META.LAST_FRAME_START, writeOffset);
    this._view.setUint32(writeOffset, frameLength);
    this._data.set(frame, writeOffset + 4);

    const newWriteOffset = (writeOffset + totalSize) % this._capacity;
    Atomics.store(this._meta, META.WRITE_OFFSET, newWriteOffset);
    Atomics.add(this._meta, META.FRAME_COUNT, 1);
    Atomics.notify(this._meta, META.NOTIFY_FLAG, 1);
    return true;
  }

  acquire() {
    const frameCount = Atomics.load(this._meta, META.FRAME_COUNT);
    if (frameCount === 0) return null;

    let readOffset = Atomics.load(this._meta, META.READ_OFFSET);
    const frameLength = this._view.getUint32(readOffset);

    const frameOffset = readOffset + 4;
    const frame = this._data.subarray(frameOffset, frameOffset + frameLength);

    const handle = { readOffset, totalSize: 4 + frameLength };
    this._pending.push(handle);

    if (this._pending.length === 1) {
      Atomics.store(this._meta, META.UNRELEASED_OFFSET, readOffset);
    }

    const newReadOffset = (readOffset + 4 + frameLength) % this._capacity;
    Atomics.store(this._meta, META.READ_OFFSET, newReadOffset);
    return { frame, handle };
  }

  release(handle) {
    const index = this._pending.findIndex(h => h === handle);
    if (index === -1) throw new Error("Invalid handle to release");

    this._pending.splice(0, index + 1);

    if (this._pending.length > 0) {
      Atomics.store(this._meta, META.UNRELEASED_OFFSET, this._pending[0].readOffset);
    } else {
      Atomics.store(this._meta, META.UNRELEASED_OFFSET, 0);
      const writeOffset = Atomics.load(this._meta, META.WRITE_OFFSET);
      Atomics.store(this._meta, META.READ_OFFSET, writeOffset);
    }

    Atomics.sub(this._meta, META.FRAME_COUNT, index + 1);
  }

  async readAsync() {
    let result = this.acquire();
    while (!result) {
      Atomics.wait(this._meta, META.NOTIFY_FLAG, 0);
      result = this.acquire();
    }
    return result;
  }

  reset() {
    Atomics.store(this._meta, META.READ_OFFSET, 0);
    Atomics.store(this._meta, META.WRITE_OFFSET, 0);
    Atomics.store(this._meta, META.FRAME_COUNT, 0);
    Atomics.store(this._meta, META.NOTIFY_FLAG, 0);
    Atomics.store(this._meta, META.UNRELEASED_OFFSET, 0);
    Atomics.store(this._meta, META.LAST_FRAME_START, 0);
    this._pending = [];
  }

  transferrable() {
    return [this._data.buffer, this._meta.buffer, this._capacity];
  }
}

