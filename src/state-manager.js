import { STATE, IDX } from "./shared/values";
import { isSharedBuffer } from "./shared/shared-buffer";
import { LoggersFactory } from "@/shared/logger";

const U32POWER = 0x0100000000;

export class StateManager {
  /**
   * @param {SharedArrayBuffer|ArrayBuffer} sab — SharedArrayBuffer
   */
  constructor(sab, options = {}) {
    /** @private */
    this._flags = new Uint32Array(sab);
    this._shared =
      options.shared ?? (typeof Atomics !== "undefined" && isSharedBuffer(sab));
    this._suppressNotify = false;
    this._port = null;
    this.displayName = options.name ?? "Untitled";
    this._logger = LoggersFactory.create("nimio", "State" + this.displayName);
    this._onPortMessage = this._handlePortMessage.bind(this);
    this._sendInit = options.sendInit ?? true;
    if (options.port) {
      this.attachPort(options.port, options.auxPort) ;
    }
    console.log("Create StateManager", this.displayName);
  }

  get value() {
    return this._load32(IDX.STATE);
  }

  set value(newState) {
    this._store32(IDX.STATE, newState);
  }

  isStopped() {
    this._logger.debug(`${this.displayName} state = ${this.value}`)
    return this.value === STATE.STOPPED;
  }

  isPlaying() {
    this._logger.debug(`${this.displayName} state = ${this.value}`)
    return this.value === STATE.PLAYING;
  }

  isPaused() {
    this._logger.debug(`${this.displayName} state = ${this.value}`)
    return this.value === STATE.PAUSED;
  }

  start() {
    this._logger.debug(`${this.displayName} state := PLAYING (${STATE.PLAYING})`)
    this.value = STATE.PLAYING;
  }

  pause() {
    this.value = STATE.PAUSED;
  }

  stop() {
    this.value = STATE.STOPPED;
  }

  getSilenceUs() {
    return this._load32(IDX.SILENCE_USEC);
  }

  incSilenceUs(durationUs) {
    this._add32(IDX.SILENCE_USEC, durationUs);
  }

  getCurrentTsSmp() {
    const smpCnt = this._atomicLoad64(IDX.CURRENT_TS);
    this._logger.debug(`${this.displayName} getCurrentTsSmp ${smpCnt}`)
    return smpCnt;
  }

  setCurrentTsSmp(smpCnt) {
    this._logger.debug(`${this.displayName} setCurrentTsSmp ${smpCnt}`)
    this._atomicStore64(IDX.CURRENT_TS, smpCnt);
  }

  incCurrentTsSmp(smpCnt) {
    this._logger.debug(`${this.displayName} incCurrentTsSmp ${smpCnt}`)
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

  getAudioLatestTsUs() {
    return this._atomicLoad64(IDX.AUDIO_LATEST_TS);
  }

  setAudioLatestTsUs(tsUs) {
    this._atomicStore64(IDX.AUDIO_LATEST_TS, tsUs);
  }

  getPlaybackStartTsUs() {
    const tsUs = this._atomicLoad64(IDX.PLAYBACK_START_TS);
    this._logger.debug(`${this.displayName} PlaybackStartTsUs == ${tsUs}`)
    return tsUs;
  }

  setPlaybackStartTsUs(tsUs) {
    this._logger.debug(`${this.displayName} PlaybackStartTsUs := ${tsUs}`)
    this._atomicStore64(IDX.PLAYBACK_START_TS, tsUs);
  }

  getAvailableAudioMs() {
    return this._load32(IDX.AVAILABLE_AUDIO);
  }

  setAvailableAudioMs(durationMs) {
    this._store32(IDX.AVAILABLE_AUDIO, durationMs);
  }

  getAvailableVideoMs() {
    return this._load32(IDX.AVAILABLE_VIDEO);
  }

  setAvailableVideoMs(durationMs) {
    this._store32(IDX.AVAILABLE_VIDEO, durationMs);
  }

  getVideoDecoderQueue() {
    return this._load32(IDX.VIDEO_DECODER_QUEUE);
  }

  setVideoDecoderQueue(numFrames) {
    this._store32(IDX.VIDEO_DECODER_QUEUE, numFrames);
  }

  getVideoDecoderLatency() {
    return this._load32(IDX.VIDEO_DECODER_LATENCY);
  }

  setVideoDecoderLatency(latency) {
    this._store32(IDX.VIDEO_DECODER_LATENCY, latency);
  }

  getAudioDecoderQueue() {
    return this._load32(IDX.AUDIO_DECODER_QUEUE);
  }

  setAudioDecoderQueue(f) {
    this._store32(IDX.AUDIO_DECODER_QUEUE, f);
  }

  getMinBufferMs(type) {
    return this._load32(this._bufTypeIdx(type));
  }

  setMinBufferMs(type, val) {
    return this._store32(this._bufTypeIdx(type), val);
  }

  getCurrentSpeed() {
    return this._load32(IDX.CURRENT_SPEED);
  }

  setCurrentSpeed(val) {
    return this._store32(IDX.CURRENT_SPEED, val * 10_000);
  }

  _bufTypeIdx(type) {
    return type === "short"
      ? IDX.MIN_BUFFER_SHORT
      : type === "long"
        ? IDX.MIN_BUFFER_LONG
        : IDX.MIN_BUFFER_EMA;
  }

  _atomicLoad64(idxs) {
    const idx = idxs[0];
    if (!this._shared) {
      const low = this._load32(idx);
      const high = this._load32(idx + 1);
      return low + high * U32POWER;
    }
    while (true) {
      const high1 = this._load32(idx + 1);
      const low = this._load32(idx);
      const high2 = this._load32(idx + 1);

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
    if (!this._shared) {
      this._store32(idx, newLow, true);
      this._store32(idx + 1, newHigh, true);
      this._notify("store64", idx, val);
      return;
    }
    while (true) {
      const low = this._load32(idx);
      const high = this._load32(idx + 1);

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
    if (!this._shared) {
      const low = this._load32(idx);
      const high = this._load32(idx + 1);
      let newLow = low + val;
      let newHigh = high;

      if (newLow >= U32POWER) {
        newLow = newLow >>> 0;
        newHigh++;
      } else if (newLow < 0) {
        // Resulting negative number isn't expected, store 0 as a failback
        newHigh = high > 0 ? high - 1 : 0;
        newLow = high > 0 ? newLow + U32POWER : 0;
      }

      if (newHigh >= U32POWER) {
        throw new Error("Resulting value exceeds 64 bits");
      }

      this._store32(idx, newLow, true);
      this._store32(idx + 1, newHigh, true);
      this._notify("add64", idx, val);
      return low + high * U32POWER;
    }

    while (true) {
      const low = this._load32(idx);
      const high = this._load32(idx + 1);

      let newLow = low + val;
      let newHigh = high;

      if (newLow >= U32POWER) {
        newLow = newLow >>> 0;
        newHigh++;
      } else if (newLow < 0) {
        // Resulting negative number isn't expected, store 0 as a failback
        newHigh = high > 0 ? high - 1 : 0;
        newLow = high > 0 ? newLow + U32POWER : 0;
      }

      if (newHigh >= U32POWER) {
        throw new Error("Resulting value exceeds 64 bits");
      }

      if (
        Atomics.compareExchange(this._flags, idx + 1, high, newHigh) === high &&
        Atomics.compareExchange(this._flags, idx, low, newLow) === low
      ) {
        return low + high * U32POWER;
      }
      // Retry if another thread wrote a new value in the middle
    }
  }

  attachPort(port, port2) {
    console.log(`Statemanager ${this.displayName} attachPort ${port}`)    
    if (!port) return;
    if (this._port) {
      this._detachPort();
    }
    if (port2) {
      this._port2 = port2;
    } else {
      this._port2 = undefined;
    }
    this._logger.debug(`${this.displayName} attachPort`)
    this._port = port;
    this._port.addEventListener("message", this._onPortMessage);
    if (port2) {
      port2.addEventListener("message", this._onPortMessage);
    }
    if (this._sendInit) {
      this._notify("init", 0, Array.from(this._flags));
    }
  }

  isShared() {
    return this._shared;
  }

  _load32(idx) {
    return this._shared ? Atomics.load(this._flags, idx) : this._flags[idx];
  }

  _store32(idx, val, silent) {
    if (this._shared) {
      Atomics.store(this._flags, idx, val);
    } else {
      this._flags[idx] = val >>> 0;
    }
    if (!silent && !this._shared) this._notify("store32", idx, val);
  }

  _add32(idx, val) {
    if (this._shared) {
      Atomics.add(this._flags, idx, val);
    } else {
      this._flags[idx] = (this._flags[idx] + val) >>> 0;
      this._notify("add32", idx, val);
    }
  }

  _notify(op, idx, value) {
    const skipSend = (this._shared || !this._port || this._suppressNotify)
    if (idx == 9 || idx == 10) { //PLAYBACK_START_TS 
      if (skipSend) {
        this._logger.debug(`State ${this.displayName} send ${op} PLAYBACK_START_TS SKIP ${!!this._shared} ${!!this._port} ${this._suppressNotify}`)
      } else {
        this._logger.debug(`State ${this.displayName} send ${op} PLAYBACK_START_TS ${value}.`)
      }
    }
    if (skipSend) return;
    const msg = {
      type: "state:update",
      op,
      idx,
      value,
    };
    this._port.postMessage(msg);
    if (this.onWorkerClient) this.onWorkerClient(msg);

  }

  _handlePortMessage(ev) {
    const msg = ev.data;
    if (!msg || msg.type !== "state:update") return;
   if (msg.idx == 9 || msg.idx == 10) { //PLAYBACK_START_TS 
      const smpCnt = this._atomicLoad64(IDX.PLAYBACK_START_TS);      
      this._logger.debug(`State ${this.displayName} received ${msg.op} PLAYBACK_START_TS ${msg.value} to ${smpCnt}`)
  //  } else {
  //    this._logger.debug(`State ${this.displayName} received ${msg.op}`)
   } 
    this._suppressNotify = true;
    if (msg.op === "init" && Array.isArray(msg.value)) {
      this._flags.set(msg.value);
    } else if (msg.op === "store32") {
      this._store32(msg.idx, msg.value, true);
    } else if (msg.op === "add32") {
      this._add32(msg.idx, msg.value);
    } else if (msg.op === "store64") {
      this._atomicStore64([msg.idx, msg.idx + 1], msg.value);
    } else if (msg.op === "add64") {
      this._atomicAdd64([msg.idx, msg.idx + 1], msg.value);
    }
    this._suppressNotify = false;
    if (this.onWorkerClient) {
      const resendMsg = {
        type: "state:update",
        op: msg.op,
        idx: msg.idx,
        value: msg.value,
      };
      this.onWorkerClient(resendMsg);
    }
  }

  _detachPort() {
    if (!this._port) return;
    this._logger.debug(`${this.displayName} detachPort`)

    this._port.removeEventListener("message", this._onPortMessage);
    this._port = null;

    if (this._port2) {
      this._port2.removeEventListener("message", this._onPortMessage);
      this._port2 = null;
    }
  }
}
