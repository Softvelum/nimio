import { createSharedBuffer, isSharedBuffer } from "@/shared/shared-buffer";

export class SharedAudioBuffer {
  static HEADER_SIZE = 2; // writeIdx, readIdx (Int32 each)
  static HEADER_BYTES = this.HEADER_SIZE * Int32Array.BYTES_PER_ELEMENT;

  // Audio frame structure:
  // [ timestamp: Float64 ][ ch0: Float32[sampleCount] ] ... [ chN: Float32[sampleCount] ]
  constructor(sharedBuffer, capacity, sampleRate, numChannels, sampleCount) {
    this.capacity = capacity;
    this.sampleRate = sampleRate;
    this.numChannels = numChannels;
    this.sampleCount = sampleCount;

    this.frameNs = (sampleCount * 1e9) / sampleRate; // frame duration in nanoseconds
    this.sampleNs = 1e9 / sampleRate; // sample duration in nanoseconds
    this.frameSize = numChannels * sampleCount;
    this.frameBytes = this.frameSize * Float32Array.BYTES_PER_ELEMENT;

    this.sab = sharedBuffer;
    this._useAtomics =
      typeof Atomics !== "undefined" && isSharedBuffer(sharedBuffer);
    this.header = new Int32Array(
      sharedBuffer,
      0,
      SharedAudioBuffer.HEADER_SIZE,
    );
    let offset = SharedAudioBuffer.HEADER_BYTES;
    this.timestamps = new Float64Array(sharedBuffer, offset, capacity);

    this.frames = new Array(capacity);
    offset += capacity * Float64Array.BYTES_PER_ELEMENT;
    for (let i = 0; i < capacity; i++) {
      this.frames[i] = new Float32Array(sharedBuffer, offset, this.frameSize);
      offset += this.frameBytes;
    }
    this.tempF32 = new Float32Array(sharedBuffer, offset, this.frameSize);
    offset += this.frameBytes;
    this.tempI16 = new Int16Array(sharedBuffer, offset, this.frameSize);
  }

  static allocate(bufferSec, sampleRate, numChannels, sampleCount) {
    const capacity = Math.ceil((bufferSec * sampleRate) / sampleCount);
    // timestamp = 2 Float32 elements + frame size
    const frameSize =
      (2 + numChannels * sampleCount) * Float32Array.BYTES_PER_ELEMENT;
    // add 2 temp buffers for s16 and f32 data
    const tempSize =
      numChannels * sampleCount * Float32Array.BYTES_PER_ELEMENT +
      numChannels * sampleCount * Int16Array.BYTES_PER_ELEMENT;
    const sharedBuffer = createSharedBuffer(
      SharedAudioBuffer.HEADER_BYTES + frameSize * capacity + tempSize,
    );

    return new this(
      sharedBuffer,
      capacity,
      sampleRate,
      numChannels,
      sampleCount,
    );
  }

  reset() {
    this._setIdx(0, 0);
    this._setIdx(1, 0);
  }

  getWriteIdx() {
    return this._getIdx(0);
  }

  getReadIdx() {
    return this._getIdx(1);
  }

  setWriteIdx(value) {
    this._setIdx(0, value);
  }

  setReadIdx(value) {
    this._setIdx(1, value);
  }

  getSize() {
    const w = this.getWriteIdx();
    const r = this.getReadIdx();
    return w >= r ? w - r : this.capacity - r + w;
  }

  forEach(fn) {
    let idx = this.getReadIdx();
    const size = this.getSize();
    for (let i = 0; i < size; i++) {
      let res = fn(this.timestamps[idx], this.frames[idx], idx, size - i - 1);
      if (res === false) break;

      idx++;
      if (idx >= this.capacity) idx -= this.capacity;
    }
  }

  get lastFrameTs() {
    let lastIdx = this.getWriteIdx() - 1;
    if (lastIdx < 0) lastIdx += this.capacity;
    return this.timestamps[lastIdx] || 0;
  }

  get buffer() {
    return this.sab;
  }

  get bufferCapacity() {
    return this.capacity;
  }

  get isShareable() {
    return this._useAtomics;
  }

  _getIdx(idx) {
    return this._useAtomics ? Atomics.load(this.header, idx) : this.header[idx];
  }

  _setIdx(idx, value) {
    if (value >= this.capacity) {
      value -= this.capacity;
    }
    if (this._useAtomics) {
      Atomics.store(this.header, idx, value);
    } else {
      this.header[idx] = value;
    }
  }
}
