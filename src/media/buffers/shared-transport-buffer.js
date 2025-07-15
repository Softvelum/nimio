const META = {
  READ_OFFSET: 0,
  WRITE_OFFSET: 1,
  FRAME_COUNT: 2,
  NOTIFY_FLAG: 3,
  UNRELEASED_OFFSET: 4,
  LAST_FRAME_END: 5,
  PRMS_READ_OFFSET: 6,
  PRMS_WRITE_OFFSET: 7,
};
const PARAM_SIZE = 10; // 10 bytes for each parameter

export class SharedTransportBuffer {
  constructor(dataBuffer, metaBuffer, prmsBuffer, capacity) {
    this._data = new Uint8Array(dataBuffer);
    this._prms = new Uint8Array(prmsBuffer); // parameters
    this._meta = new Int32Array(metaBuffer); // META
    this._view = new DataView(this._data.buffer);
    this._prmsView = new DataView(this._prms.buffer);
    this._prmsLength = this._prms.length;
    this._capacity = capacity;
    this._pending = [];
  }

  static allocate(bufferSec, frameSize, frameRate) {
    if (!bufferSec || !frameSize || !frameRate) {
      throw new Error("Invalid parameters for SharedTransportBuffer allocation");
    }
    
    const capacity = Math.ceil(bufferSec * frameSize * frameRate);
    const dataBuffer = new SharedArrayBuffer(capacity * Uint8Array.BYTES_PER_ELEMENT);
    const prmsCount = 8 * bufferSec * frameRate; // 8x parameters per frame
    const prmsBuffer = new SharedArrayBuffer(
      prmsCount * PARAM_SIZE * Uint8Array.BYTES_PER_ELEMENT
    );
    const metaCnt = Object.keys(META).length;
    const metaBuffer = new SharedArrayBuffer(metaCnt * Int32Array.BYTES_PER_ELEMENT);
    const metaView = new Int32Array(metaBuffer);
    metaView[META.UNRELEASED_OFFSET] = -1; // no frames released initially

    return new this(
      dataBuffer,
      metaBuffer,
      prmsBuffer,
      capacity,
    );
  }

  write(frame, ts, type) {
    // debugger;
    const frameLength = frame.length;
    const totalSize = 4 + frameLength;
    if (totalSize > this._capacity) return false;

    let readOffset = Atomics.load(this._meta, META.READ_OFFSET);
    let writeOffset = Atomics.load(this._meta, META.WRITE_OFFSET);
    let unreleasedOffset = Atomics.load(this._meta, META.UNRELEASED_OFFSET);
    let limitOffset = unreleasedOffset >= 0 ? unreleasedOffset : readOffset;

    let available;
    if (writeOffset >= limitOffset) {
      available = this._capacity - writeOffset + limitOffset;
    } else {
      available = limitOffset - writeOffset;
    }

    if (totalSize > available) return false;

    if (writeOffset + totalSize > this._capacity) {
      Atomics.store(this._meta, META.LAST_FRAME_END, writeOffset);
      writeOffset = 0;
      if (totalSize > limitOffset) return false;
    }

    this._view.setUint32(writeOffset, frameLength);
    this._data.set(frame, writeOffset + 4);

    const prmsWriteOffset = Atomics.load(this._meta, META.PRMS_WRITE_OFFSET);
    this._prmsView.setFloat64(prmsWriteOffset, ts);
    if (type !== undefined) {
      this._prmsView.setUint8(prmsWriteOffset + 8, type);
    }
    Atomics.store(
      this._meta,
      META.PRMS_WRITE_OFFSET,
      (prmsWriteOffset + PARAM_SIZE) % this._prmsLength,
    );
    Atomics.store(
      this._meta,
      META.WRITE_OFFSET,
      (writeOffset + totalSize) % this._capacity,
    );
    Atomics.add(this._meta, META.FRAME_COUNT, 1);
    Atomics.notify(this._meta, META.NOTIFY_FLAG, 1);

    return true;
  }

  acquire() {
    // debugger;
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
    const prmsReadOffset = Atomics.load(this._meta, META.PRMS_READ_OFFSET);
    const ts = this._prmsView.getFloat64(prmsReadOffset);
    const type = this._prmsView.getUint8(prmsReadOffset + 8);
    Atomics.store(
      this._meta,
      META.PRMS_READ_OFFSET,
      (prmsReadOffset + PARAM_SIZE) % this._prmsLength,
    );

    let newReadOffset = (readOffset + 4 + frameLength) % this._capacity;
    const lastFrameEnd = Atomics.load(this._meta, META.LAST_FRAME_END);
    if (newReadOffset === lastFrameEnd) {
      newReadOffset = 0;
      Atomics.store(this._meta, META.LAST_FRAME_END, 0);
    }
    Atomics.store(this._meta, META.READ_OFFSET, newReadOffset);
    Atomics.sub(this._meta, META.FRAME_COUNT, 1);
    return { frame, handle, ts, type };
  }

  release(handle) {
    const index = this._pending.findIndex(h => h === handle);
    if (index === -1) throw new Error("Invalid handle to release");

    this._pending.splice(0, index + 1);
    const newUnreleasedOffset =
      this._pending.length > 0 ? this._pending[0].readOffset : -1;
    Atomics.store(this._meta, META.UNRELEASED_OFFSET, newUnreleasedOffset);
  }

  async readAsync() {
    let result = this.acquire();
    if (!result) {
      Atomics.waitAsync(this._meta, META.NOTIFY_FLAG, 0);
      result = this.acquire();
    }

    return result;
  }

  reset() {
    Atomics.store(this._meta, META.READ_OFFSET, 0);
    Atomics.store(this._meta, META.WRITE_OFFSET, 0);
    Atomics.store(this._meta, META.FRAME_COUNT, 0);
    Atomics.store(this._meta, META.NOTIFY_FLAG, 0);
    Atomics.store(this._meta, META.UNRELEASED_OFFSET, -1);
    Atomics.store(this._meta, META.LAST_FRAME_END, 0);
    Atomics.store(this._meta, META.PRMS_READ_OFFSET, 0);
    Atomics.store(this._meta, META.PRMS_WRITE_OFFSET, 0);
    this._pending = [];
  }

  transferrable() {
    return [
      this._data.buffer,
      this._meta.buffer,
      this._prms.buffer,
      this._capacity,
    ];
  }
}
