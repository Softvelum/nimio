import { createSharedBuffer, isSharedBuffer } from "@/shared/shared-buffer";

export class SharedAudioBuffer {
  static HEADER_SIZE = 2; // writeIdx, readIdx (Int32 each)
  static HEADER_BYTES = this.HEADER_SIZE * Int32Array.BYTES_PER_ELEMENT;

  // Audio frame structure:
  // [ timestamp: Float64 ][ ch0: Float32[sampleCount] ] ... [ chN: Float32[sampleCount] ]
  constructor(sharedBuffer, capacity, sampleRate, numChannels, sampleCount) {
    this._capacity = capacity;
    this.sampleRate = sampleRate;
    this.numChannels = numChannels;
    this._sampleCount = sampleCount;

    this.frameNs = (sampleCount * 1e9) / sampleRate; // frame duration in nanoseconds
    this.sampleNs = 1e9 / sampleRate; // sample duration in nanoseconds
    this.frameSize = numChannels * sampleCount;
    this.frameBytes = this.frameSize * Float32Array.BYTES_PER_ELEMENT;

    this._sab = sharedBuffer;
    this._useAtomics =
      typeof Atomics !== "undefined" && isSharedBuffer(sharedBuffer);
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
    this._props = {};
    this._deferred = [];
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

  addPreprocessor(preprocessor) {
    this._preprocessors.push(preprocessor);
    preprocessor.setBufferIface(this);
    for (let p in preprocessor.props) {
      this._props[p] = preprocessor.props[p];
    }
  }

  reset() {
    this._setIdx(0, 0);
    this._setIdx(1, 0);
    this._deferred.length = 0;
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
    return cb.call(this, r, w, size);
  }

  getSize() {
    return this.withState(function (r, w, size) {
      return size;
    });
  }

  getFrame(idx) {
    if (idx >= this._capacity) idx -= this._capacity;

    return this.withState(function (r, w, size) {
      let dist = idx >= r ? idx - r : this._capacity - r + idx;
      if (dist >= size) return null;

      return {
        idx,
        data: this._frames[idx],
        timestamp: this._timestamps[idx],
        rate: this._rates[idx],
      };
    });
  }

  forEach(fn, from, len) {
    if (from >= this._capacity) from -= this._capacity;

    const fIdx = from >= 0 ? from : this.getReadIdx();
    const size = len >= 0 ? len : this.getSize();
    return this._runLoop(fn, fIdx, size);
  }

  forEachAsync(fn, from, len) {
    if (from >= this._capacity) from -= this._capacity;

    const w = this.getWriteIdx();
    const avail = w >= from ? w - from : this._capacity - from + w;

    if (len > avail) {
      this._deferLoop(fn, from + avail, len - avail);
      len = avail;
    }
    if (len === 0) return;

    this._runLoop(fn, from, len);
  }

  runDeferred() {
    if (this._deferred.length === 0) return;

    let deferred = this._deferred;
    this._deferred = [];
    for (let i = 0; i < deferred.length; i++) {
      this.forEachAsync(deferred[i].fn, deferred[i].from, deferred[i].len);
    }
    deferred.length = 0;
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

  get sampleCount() {
    return this._sampleCount;
  }

  get bufferCapacity() {
    return this._capacity;
  }

  get isShareable() {
    return this._useAtomics;
  }

  _getIdx(idx) {
    return this._useAtomics ? Atomics.load(this._header, idx) : this._header[idx];
  }

  _setIdx(idx, value) {
    if (value >= this._capacity) {
      value -= this._capacity;
    }
    if (this._useAtomics) {
      Atomics.store(this._header, idx, value);
    } else {
      this._header[idx] = value;
    }
  }

  _resetPreprocessing() {
    for (let i = 0; i < this._preprocessors.length; i++) {
      this._preprocessors[i].reset();
    }
    this._preprocessors.length = 0;
    this._props = {};
  }

  _runLoop(fn, from, len) {
    let idx = from;
    for (let i = 0; i < len; i++) {
      let res = fn(
        this._timestamps[idx],
        this._rates[idx],
        this._frames[idx],
        idx,
        len - i - 1,
      );
      if (res === false) break;

      idx++;
      if (idx >= this._capacity) idx -= this._capacity;
    }
  }

  _deferLoop(fn, from, len) {
    this._deferred.push({ fn, from, len });
  }
}
