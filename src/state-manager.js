import { STATE, IDX } from "./shared/values";

const U32POWER = 0x0100000000;

export class StateManager {
  /**
   * @param {SharedArrayBuffer|ArrayBuffer} sab — SharedArrayBuffer
   */
  constructor(sab) {
    /** @private */
    this._flags = new Uint32Array(sab);
  }

  get value() {
    return Atomics.load(this._flags, IDX.STATE);
  }

  set value(newState) {
    Atomics.store(this._flags, IDX.STATE, newState);
  }

  isStopped() {
    return this.value === STATE.STOPPED;
  }

  isPlaying() {
    return this.value === STATE.PLAYING;
  }

  isPaused() {
    return this.value === STATE.PAUSED;
  }

  start() {
    this.value = STATE.PLAYING;
  }

  pause() {
    this.value = STATE.PAUSED;
  }

  stop() {
    this.value = STATE.STOPPED;
  }

  getSilenceUs() {
    return Atomics.load(this._flags, IDX.SILENCE_USEC);
  }

  incSilenceUs(durationUs) {
    Atomics.add(this._flags, IDX.SILENCE_USEC, durationUs);
  }

  getCurrentTsSmp() {
    return this._atomicLoad64(IDX.CURRENT_TS);
  }

  setCurrentTsSmp(smpCnt) {
    this._atomicStore64(IDX.CURRENT_TS, smpCnt);
  }

  incCurrentTsSmp(smpCnt) {
    return this._atomicAdd64(IDX.CURRENT_TS, smpCnt);
  }

  resetCurrentTsSmp() {
    this._atomicStore64(IDX.CURRENT_TS, 0);
  }

  getVideoLatestTsUs() {
    return this._atomicLoad64(IDX.VIDEO_LATEST_TS);
  }

  setVideoLatestTsUs(tsUs) {
    this._atomicStore64(IDX.VIDEO_LATEST_TS, tsUs);
  }

  getPlaybackStartTsUs() {
    return this._atomicLoad64(IDX.PLAYBACK_START_TS);
  }

  setPlaybackStartTsUs(tsUs) {
    this._atomicStore64(IDX.PLAYBACK_START_TS, tsUs);
  }

  getAvailableAudioMs() {
    return Atomics.load(this._flags, IDX.AVAILABLE_AUDIO);
  }

  setAvailableAudioMs(durationMs) {
    Atomics.store(this._flags, IDX.AVAILABLE_AUDIO, durationMs);
  }

  getAvailableVideoMs() {
    return Atomics.load(this._flags, IDX.AVAILABLE_VIDEO);
  }

  setAvailableVideoMs(durationMs) {
    Atomics.store(this._flags, IDX.AVAILABLE_VIDEO, durationMs);
  }

  getVideoDecoderQueue() {
    return Atomics.load(this._flags, IDX.VIDEO_DECODER_QUEUE);
  }

  setVideoDecoderQueue(numFrames) {
    Atomics.store(this._flags, IDX.VIDEO_DECODER_QUEUE, numFrames);
  }

  getVideoDecoderLatency() {
    return Atomics.load(this._flags, IDX.VIDEO_DECODER_LATENCY);
  }

  setVideoDecoderLatency(latency) {
    Atomics.store(this._flags, IDX.VIDEO_DECODER_LATENCY, latency);
  }

  getAudioDecoderQueue() {
    return Atomics.load(this._flags, IDX.AUDIO_DECODER_QUEUE);
  }

  setAudioDecoderQueue(f) {
    Atomics.store(this._flags, IDX.AUDIO_DECODER_QUEUE, f);
  }

  _atomicLoad64(idxs) {
    const idx = idxs[0];
    while (true) {
      const high1 = Atomics.load(this._flags, idx + 1);
      const low = Atomics.load(this._flags, idx);
      const high2 = Atomics.load(this._flags, idx + 1);

      if (high1 === high2) {
        return low + high1 * U32POWER;
      }
      // Retry if another thread wrote a new value in the middle
    }
  }

  _atomicStore64(idxs, val) {
    const newLow = val >>> 0;
    const newHigh = (val / U32POWER) >>> 0;

    const idx = idxs[0];
    while (true) {
      const low = Atomics.load(this._flags, idx);
      const high = Atomics.load(this._flags, idx + 1);

      // Only update if the val hasn't changed
      if (
        Atomics.compareExchange(this._flags, idx + 1, high, newHigh) === high &&
        Atomics.compareExchange(this._flags, idx, low, newLow) === low
      ) {
        break;
      }
      // Retry if another thread wrote a new value in the middle
    }
  }

  _atomicAdd64(idxs, val) {
    if (val >= U32POWER) {
      throw new Error("Added value must be less than 2^32");
    }

    const idx = idxs[0];
    while (true) {
      const low = Atomics.load(this._flags, idx);
      const high = Atomics.load(this._flags, idx + 1);

      let newLow = low + val;
      let newHigh = high;

      if (newLow >= U32POWER) {
        newLow = newLow >>> 0;
        newHigh = high + 1;
      }

      if (newHigh >= U32POWER) {
        throw new Error("Resulting value exceeds 64 bits");
      }

      if (
        Atomics.compareExchange(this._flags, idx + 1, high, newHigh) === high &&
        Atomics.compareExchange(this._flags, idx, low, newLow) === low
      ) {
        return newLow + newHigh * U32POWER;
      }
      // Retry if another thread wrote a new value in the middle
    }
  }
}
