export class SharedAudioBuffer {
  static HEADER_SIZE = 2; // writeIdx, readIdx (Int32 each)
  static HEADER_BYTES = this.HEADER_SIZE * Int32Array.BYTES_PER_ELEMENT;

  // Audio frame structure:
  // [ timestamp: Float64 ][ ch0: Float32[sampleCount] ] ... [ chN: Float32[sampleCount] ]
  constructor(sharedBuffer, bufCapacity, sampleRate, numChannels, sampleCount) {
    this.bufCapacity = bufCapacity;
    this.sampleRate = sampleRate;
    this.numChannels = numChannels;
    this.sampleCount = sampleCount;

    this.frameNs = sampleCount * 1e9 / sampleRate; // frame duration in nanoseconds
    this.frameSize = numChannels * sampleCount;
    this.frameBytes = this.frameSize * Float32Array.BYTES_PER_ELEMENT;

    this.sab = sharedBuffer;
    this.header = new Int32Array(sharedBuffer, 0, SharedAudioBuffer.HEADER_SIZE);
    let offset = SharedAudioBuffer.HEADER_BYTES;
    this.timestamps = new Float64Array(sharedBuffer, offset, bufCapacity);

    this.frames = new Array(bufCapacity);
    offset += bufCapacity * Float64Array.BYTES_PER_ELEMENT;
    for (let i = 0; i < bufCapacity; i++) {
      this.frames[i] = new Float32Array(sharedBuffer, offset, this.frameSize);
      offset += this.frameBytes;
    }
  }

  static allocate(bufferSec, sampleRate, numChannels, sampleCount) {
    const bufCapacity = Math.ceil(bufferSec * sampleRate / sampleCount);
    // timestamp = 2 Float32 elements + frame size
    const frameSize = (2 + numChannels * sampleCount) * Float32Array.BYTES_PER_ELEMENT;
    const sharedBuffer = new SharedArrayBuffer(
      SharedAudioBuffer.HEADER_BYTES + frameSize * bufCapacity
    );

    return new this(sharedBuffer, bufCapacity, sampleRate, numChannels, sampleCount);
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
    const w = this.getWriteIdx(), r = this.getReadIdx();
    return w >= r ? w - r : this.bufCapacity - r + w;
  }

  get availableWrite() {
    return this.bufCapacity - this.size;
  }

  get buffer() {
    return this.sab;
  }

  get capacity() {
    return this.bufCapacity;
  }

  _getIdx(idx) {
    return Atomics.load(this.header, idx);
  }

  _setIdx(idx, value) {
    if (value >= this.bufCapacity) {
      value -= this.bufCapacity;
    }
    Atomics.store(this.header, idx, value);
  }
}
