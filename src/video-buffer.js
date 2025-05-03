export class VideoBuffer {
    constructor(maxFrames = 100) { //todo length in uSec?
        this.maxFrames = maxFrames;
        this.frames = [];
        this.debugElement = null;
    }

    attachDebugElement(element) {
        this.debugElement = element;
        this._updateDebugView();
    }

    _updateDebugView() {
        // todo use metrics collector instead direct overlay drawing
        if (this.debugElement) {
            this.debugElement.textContent = `Video buffer size: ${this.frames.length}`;
        }
    }

    addFrame(frame, timestamp) {
        if (this.frames.length >= this.maxFrames) {
            const removed = this.frames.shift();
            console.error(`VideoBuffer: overflow, removed old frame ${removed.timestamp}`);
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
