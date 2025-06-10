import LoggersFactory from "./logger.js";

export class SharedRingBuffer {
    static HEADER_SIZE = 3; // writeIdx, readIdx, size
    static HEADER_SIZE_BYTES = HEADER_SIZE * Int32Array.BYTES_PER_ELEMENT;
  
    constructor(buffer, capacity) {
      this.buffer = buffer;
      this.capacity = capacity;
  
      this.header = new Int32Array(this.buffer, 0, SharedRingBuffer.HEADER_SIZE);
      const headerByteOffset = SharedRingBuffer.HEADER_SIZE * Int32Array.BYTES_PER_ELEMENT;
      this.data = new Float32Array(this.buffer, headerByteOffset);
  
      if (this.data.length !== capacity) {
        throw new Error("Shared buffer size does not match expected capacity");
      }
    }
  
    static allocate(capacity, channels = 1) {
      const dataBytes = capacity * Float32Array.BYTES_PER_ELEMENT;
      const totalBytes = SharedRingBuffer.HEADER_SIZE_BYTES + dataBytes;
      const buffer = new SharedArrayBuffer(totalBytes);
      return new SharedRingBuffer(buffer, capacity);
    }
  
    get writeIdx() {
      return Atomics.load(this.header, 0);
    }
  
    get readIdx() {
      return Atomics.load(this.header, 1);
    }
  
    get size() {
      const writeIdx = this.writeIdx;
      const readIdx = this.readIdx;
      if (writeIdx >= readIdx) return writeIdx - readIdx;
      return this.capacity - readIdx + writeIdx;
    }
  
    get availableWrite() {
      return this.capacity - this.size;
    }
  
    write(samples) {
      const writeIdx = this.writeIdx;
      const len = samples.length;
  
      if (len > this.capacity - this.size) return false; // Not enough space
  
      for (let i = 0; i < len; i++) {
        const index = (writeIdx + i) % this.capacity;
        this.data[index] = samples[i];
      }
  
      Atomics.store(this.header, 0, (writeIdx + len) % this.capacity);
      Atomics.store(this.header, 2, this.size); // update size (optional)
      return true;
    }
  
    read(output) {
      const readIdx = this.readIdx;
      const len = output.length;
  
      if (len > this.size) return false; // Not enough data
  
      for (let i = 0; i < len; i++) {
        const index = (readIdx + i) % this.capacity;
        output[i] = this.data[index];
      }
  
      Atomics.store(this.header, 1, (readIdx + len) % this.capacity);
      Atomics.store(this.header, 2, this.size); // update size (optional)
      return true;
    }
  
    reset() {
      Atomics.store(this.header, 0, 0); // writeIdx
      Atomics.store(this.header, 1, 0); // readIdx
      Atomics.store(this.header, 2, 0); // size
    }
  }
