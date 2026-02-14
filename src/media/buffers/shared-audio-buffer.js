import {
  createSharedBuffer,
  isSharedArrayBufferSupported,
  isSharedBuffer,
} from "@/shared/shared-buffer";

function audioFrameSize(numChannels, sampleCount) {
  return numChannels * sampleCount * Float32Array.BYTES_PER_ELEMENT;
}

export class SharedAudioBuffer {
  static HEADER_SIZE = 2; // writeIdx, readIdx (Int32 each)
  static HEADER_BYTES = this.HEADER_SIZE * Int32Array.BYTES_PER_ELEMENT;

  // Audio frame structure:
  // [ timestamp: Float64 ][ rate: Float32 ][ ch0: Float32[sampleCount] ] ... [ chN: Float32[sampleCount] ]
  constructor(sharedBuf, capacity, sampleRate, numChannels, sampleCount) {
    this._capacity = capacity;
    this.sampleRate = sampleRate;
    this.numChannels = numChannels;
    this._sampleCount = sampleCount;

    this._frameNs = (sampleCount * 1e9) / sampleRate; // frame duration in nanoseconds
    this._sampleNs = 1e9 / sampleRate; // sample duration in nanoseconds
    this._frameSize = numChannels * sampleCount;
    this._frameBytes = this._frameSize * Float32Array.BYTES_PER_ELEMENT;

    this._preprocessors = [];
    this._props = {};
    this._deferred = [];

    this._setOverflowShift();

    this._useAtomics = false;
    sharedBuf ? this._attachSharedBuffer(sharedBuf) : this._allocBuffers();
  }

  static allocate(bufferSec, sampleRate, numChannels, sampleCount) {
    const isShared = isSharedArrayBufferSupported();
    if (!isShared) {
      bufferSec += 2; // add 2 seconds for overflow prevention
    }
    const capacity = Math.ceil((bufferSec * sampleRate) / sampleCount);

    // one frame = Float64 timestamp(2 Float32) + Float32 rate + frame size
    const fAuxSize = 3 * capacity * Float32Array.BYTES_PER_ELEMENT;
    // 2 temp buffers for s16 and f32 data
    const tempSize =
      numChannels * sampleCount * Float32Array.BYTES_PER_ELEMENT +
      numChannels * sampleCount * Int16Array.BYTES_PER_ELEMENT;

    let fullSize = SharedAudioBuffer.HEADER_BYTES + fAuxSize + tempSize;
    if (isShared) {
      fullSize += audioFrameSize(numChannels, sampleCount) * capacity;
    }

    return new this(
      createSharedBuffer(fullSize),
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

  halt() {
    this._halt = true;
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
    return this._setIdx(0, value);
  }

  setReadIdx(value) {
    return this._setIdx(1, value);
  }

  withState(cb) {
    const r = this.getReadIdx();
    const w = this.getWriteIdx();
    const size = this._dist(r, w);
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
      let dist = this._dist(r, idx);
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
    const avail = this._dist(from, w);

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

  get isPreallocated() {
    return true;
  }

  _attachSharedBuffer(sab) {
    this._sab = sab;
    this._useAtomics = typeof Atomics !== "undefined" && isSharedBuffer(sab);

    this._header = new Int32Array(sab, 0, SharedAudioBuffer.HEADER_SIZE);
    let offset = SharedAudioBuffer.HEADER_BYTES;

    this._timestamps = new Float64Array(sab, offset, this._capacity);
    offset += this._capacity * Float64Array.BYTES_PER_ELEMENT;

    this._rates = new Float32Array(sab, offset, this._capacity);
    offset += this._capacity * Float32Array.BYTES_PER_ELEMENT;

    this._frames = new Array(this._capacity);
    if (this._useAtomics) {
      for (let i = 0; i < this._capacity; i++) {
        this._frames[i] = new Float32Array(sab, offset, this._frameSize);
        offset += this._frameBytes;
      }
    } else {
      for (let i = 0; i < this._capacity; i++) {
        this._frames[i] = new Float32Array(this._frameSize);
      }
    }
    this._sabOffset = offset;
  }

  _allocBuffers() {
    this._header = new Int32Array(SharedAudioBuffer.HEADER_SIZE);
    this._timestamps = new Float64Array(this._capacity);
    this._rates = new Float32Array(this._capacity);
    this._frames = new Array(this._capacity);
  }

  _getIdx(idx) {
    return this._useAtomics
      ? Atomics.load(this._header, idx)
      : this._header[idx];
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

    return value;
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

  _setOverflowShift() {
    this._overflowShift = (this.sampleRate / this._sampleCount + 0.5) >>> 0;
    let maxShift = (this._capacity / 5 + 0.5) >>> 0;
    if (this._overflowShift > maxShift) {
      this._overflowShift = maxShift;
    }
  }

  _dist(start, end) {
    return end >= start ? end - start : this._capacity - start + end;
  }
}
