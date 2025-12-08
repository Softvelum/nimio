export class SharedAudioBuffer {
  static HEADER_SIZE = 2; // writeIdx, readIdx (Int32 each)
  static HEADER_BYTES = this.HEADER_SIZE * Int32Array.BYTES_PER_ELEMENT;

  // Audio frame structure:
  // [ timestamp: Float64 ][ ch0: Float32[sampleCount] ] ... [ chN: Float32[sampleCount] ]
  constructor(sharedBuffer, capacity, sampleRate, numChannels, sampleCount) {
    this._capacity = capacity;
    this.sampleRate = sampleRate;
    this.numChannels = numChannels;
    this.sampleCount = sampleCount;

    this.frameNs = (sampleCount * 1e9) / sampleRate; // frame duration in nanoseconds
    this.sampleNs = 1e9 / sampleRate; // sample duration in nanoseconds
    this.frameSize = numChannels * sampleCount;
    this.frameBytes = this.frameSize * Float32Array.BYTES_PER_ELEMENT;

    this._sab = sharedBuffer;
    this._header = new Int32Array(
      sharedBuffer,
      0,
      SharedAudioBuffer.HEADER_SIZE,
    );
    let offset = SharedAudioBuffer.HEADER_BYTES;
    this._timestamps = new Float64Array(sharedBuffer, offset, capacity);
    offset += capacity * Float64Array.BYTES_PER_ELEMENT;

    this._rates = new Float32Array(sharedBuffer, offset, capacity);
    offset += capacity * Float32Array.BYTES_PER_ELEMENT;

    this._frames = new Array(capacity);
    for (let i = 0; i < capacity; i++) {
      this._frames[i] = new Float32Array(sharedBuffer, offset, this.frameSize);
      offset += this.frameBytes;
    }
    this._tempF32 = new Float32Array(sharedBuffer, offset, this.frameSize);
    offset += this.frameBytes;
    this._tempI16 = new Int16Array(sharedBuffer, offset, this.frameSize);

    this._preprocessors = [];
  }

  static allocate(bufferSec, sampleRate, numChannels, sampleCount) {
    const capacity = Math.ceil((bufferSec * sampleRate) / sampleCount);
    // one frame = Float64 timestamp(2 Float32) + Float32 rate + frame size
    const frameSize =
      (3 + numChannels * sampleCount) * Float32Array.BYTES_PER_ELEMENT;
    // add 2 temp buffers for s16 and f32 data
    const tempSize =
      numChannels * sampleCount * Float32Array.BYTES_PER_ELEMENT +
      numChannels * sampleCount * Int16Array.BYTES_PER_ELEMENT;
    const sharedBuffer = new SharedArrayBuffer(
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

  addPreprocessor(preprocessor) {
    this._preprocessors.push(preprocessor);
    preprocessor.setBufferIface(this);
  }

  reset() {
    this._setIdx(0, 0);
    this._setIdx(1, 0);
    this._resetPreprocessing();
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

  withState(cb) {
    const r = this.getReadIdx();
    const w = this.getWriteIdx();
    const size = w >= r ? w - r : this._capacity - r + w;
    return cb(r, w, size);
  }

  getSize() {
    return this.withState(function(r, w, size) { return size });
  }

  getFrame(idx) {
    if (idx >= this._capacity) idx -= this._capacity;

    return this.withState(function(r, w, size) {
      let dist = idx >= r ? idx - r : this._capacity - r + idx;
      if (dist >= size) return null;

      return {
        data: this._frames[idx],
        timestamp: this._timestamps[idx],
        rate: this._rates[idx],
      };
    });
  }

  forEach(fn) {
    let idx = this.getReadIdx();
    const size = this.getSize();
    for (let i = 0; i < size; i++) {
      let res = fn(
        this._timestamps[idx],
        this._rates[idx],
        this._frames[idx],
        idx,
        size - i - 1
      );
      if (res === false) break;

      idx++;
      if (idx >= this._capacity) idx -= this._capacity;
    }
  }

  get lastFrameTs() {
    let lastIdx = this.getWriteIdx() - 1;
    if (lastIdx < 0) lastIdx += this._capacity;
    return this._timestamps[lastIdx] || 0;
  }

  get buffer() {
    return this._sab;
  }

  get frames() {
    return this._frames;
  }

  get rates() {
    return this._rates;
  }

  get bufferCapacity() {
    return this._capacity;
  }

  get isShareable() {
    return true;
  }

  _getIdx(idx) {
    return Atomics.load(this._header, idx);
  }

  _setIdx(idx, value) {
    if (value >= this._capacity) {
      value -= this._capacity;
    }
    Atomics.store(this._header, idx, value);
  }

  _resetPreprocessing() {
    for (let i = 0; i < this._preprocessors.length; i++) {
      this._preprocessors[i].reset();
    }
    this._preprocessors.length = 0;
  }
}
