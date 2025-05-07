import { STATE, IDX } from './shared.js';

export class StateManager {
    /**
     * @param {SharedArrayBuffer|ArrayBuffer} sab — SharedArrayBuffer
     */
    constructor(sab) {
        /** @private */
        this._flags = new Int32Array(sab);
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

    getCurrentTsUs() {
        return Atomics.load(this._flags, IDX.CURRENT_TS);
    }

    incCurrentTsUs(durationUs) {
        Atomics.add(this._flags, IDX.CURRENT_TS, durationUs);
    }

    setAvailableAudioSec(durationSec) {
        Atomics.store(this._flags, IDX.AVAILABLE_AUDIO, durationSec);
    }

    setVideoDecoderQueue(f) {
        Atomics.store(this._flags, IDX.VIDEO_DECODER_QUEUE, f);
    }

    setAudioDecoderQueue(f) {
        Atomics.store(this._flags, IDX.AUDIO_DECODER_QUEUE, f);
    }
}
