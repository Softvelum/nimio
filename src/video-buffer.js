import {IDX} from "./shared.js";

export class VideoBuffer {
    constructor(maxFrames = 100, sab) { //todo length in uSec?
        this.maxFrames = maxFrames;
        this.frames = [];
        this.debugElement = null;
        this._flags = new Int32Array(sab); //todo move to state manager
    }

    attachDebugElement(element) {
        this.debugElement = element;
        this._updateDebugView();
    }

    _updateDebugView() {
        // todo use metrics collector instead direct overlay drawing
        if (this.debugElement) {
            let audioMs = Atomics.load(this._flags, IDX.AVAILABLE_AUDIO); // todo move state manager and display independently
            let silenceMs = Atomics.load(this._flags, IDX.SILENCE_USEC)/1000;
            let vDecQueue = Atomics.load(this._flags, IDX.VIDEO_DECODER_QUEUE);
            let vDecLatency = Atomics.load(this._flags, IDX.VIDEO_DECODER_LATENCY);
            let aDecQueue = Atomics.load(this._flags, IDX.AUDIO_DECODER_QUEUE);
            this.debugElement.textContent =
                `Video buffer:..........${this.frames.length.toString().padStart(4, '.')}f \n` +
                `Audio buffer:..........${audioMs.toString().padStart(4, '.')}ms \n` +
                `Silence inserted:......${Math.ceil(silenceMs).toString().padStart(4, '.')}ms \n` + //todo state manager
                `Video Decoder queue:......${vDecQueue} \n` +
                `Video Decoder latency:.${vDecLatency.toString().padStart(4, '.')}ms \n` +
                `Audio Decoder queue:......${aDecQueue} \n`;
        }
    }

    addFrame(frame, timestamp) {
        if (this.frames.length >= this.maxFrames) {
            const removed = this.frames.shift();
            console.error(`VideoBuffer: overflow, removed old frame ${removed.timestamp}`);
            removed.close();
        }

        this.frames.push({ frame, timestamp });
        this._updateDebugView();
    }

    getFrameForTime(currentTime) {
        const n = this.frames.length;
        if (n === 0) {
            // console.warn(`VideoBuffer: empty at ts: ${currentTime.toFixed(3)}`);
            return null;
        }

        // find nearest old frame
        let lastIdx = -1;
        for (let i = 0; i < n; i++) {
            if (this.frames[i].timestamp <= currentTime) {
                lastIdx = i;
                if (i-1 >= 0 && undefined !== this.frames[i-1]) { // close more old frame
                    this.frames[i-1].frame.close();
                }
            } else {
                break;
            }
        }

        // nothing to show, too early
        if (lastIdx < 0) {
            return null;
        }

        const { frame, timestamp } = this.frames[lastIdx];

        this.frames.splice(0, lastIdx + 1);

        this._updateDebugView();

        // return most new frame from old
        return frame;
    }

    clear() {
        if (this.frames.length > 0) {
            this.frames.forEach(({ frame, timestamp }) => {
                frame.close();
            });
            this.frames.length = 0;
            this._updateDebugView();
        }
    }
}
