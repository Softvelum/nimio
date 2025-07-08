export class SharedTransportBuffer {
  constructor(sharedBuffer, metaBuffer, capacity) {
    this.data = new Uint8Array(sharedBuffer);
    this.meta = new Int32Array(metaBuffer); // readOffset, writeOffset, frameCount, notify
    this.capacity = capacity; // size in bytes
    this.offsets = []; // [{ offset, length }]
  }

  write(frame) {
    const frameLength = frame.length;
    if (frameLength + 4 > this.capacity) return false;

    const readOffset = Atomics.load(this.meta, 0);
    const writeOffset = Atomics.load(this.meta, 1);

    const available =
      writeOffset >= readOffset
        ? this.capacity - (writeOffset - readOffset)
        : readOffset - writeOffset;

    if (frameLength + 4 > available) return false;

    const lengthView = new DataView(this.data.buffer);
    const headerOffset = writeOffset;
    lengthView.setUint32(headerOffset, frameLength);

    const frameOffset = (writeOffset + 4) % this.capacity;
    const endOffset = (frameOffset + frameLength) % this.capacity;

    if (frameOffset + frameLength <= this.capacity) {
      this.data.set(frame, frameOffset);
    } else {
      const firstChunk = this.capacity - frameOffset;
      this.data.set(frame.subarray(0, firstChunk), frameOffset);
      this.data.set(frame.subarray(firstChunk), 0);
    }

    const newWriteOffset = (writeOffset + 4 + frameLength) % this.capacity;
    Atomics.store(this.meta, 1, newWriteOffset);
    Atomics.add(this.meta, 2, 1); // increment frame count
    Atomics.notify(this.meta, 3, 1);
    return true;
  }

  read() {
    let frameCount = Atomics.load(this.meta, 2);
    if (frameCount === 0) return null;

    const readOffset = Atomics.load(this.meta, 0);
    const lengthView = new DataView(this.data.buffer);
    const frameLength = lengthView.getUint32(readOffset);

    const frameOffset = (readOffset + 4) % this.capacity;
    const frame = new Uint8Array(frameLength);

    if (frameOffset + frameLength <= this.capacity) {
      frame.set(this.data.subarray(frameOffset, frameOffset + frameLength));
    } else {
      const firstChunk = this.capacity - frameOffset;
      frame.set(this.data.subarray(frameOffset, this.capacity), 0);
      frame.set(this.data.subarray(0, frameLength - firstChunk), firstChunk);
    }

    const newReadOffset = (readOffset + 4 + frameLength) % this.capacity;
    Atomics.store(this.meta, 0, newReadOffset);
    Atomics.sub(this.meta, 2, 1);
    return frame;
  }

  async readAsync() {
    let frame = this.read();
    while (!frame) {
      Atomics.wait(this.meta, 3, 0);
      frame = this.read();
    }
    return frame;
  }
}
