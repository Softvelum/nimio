import { IDX } from "./shared/values.js";
import LoggersFactory from "./shared/logger.js";
import { RingBuffer } from "./utils/ring-buffer.js";

export class VideoBuffer {
  constructor(maxFrames = 100, sab, playerConfig) {
    //todo length in uSec?
    this.frames = new RingBuffer(playerConfig.instanceName, maxFrames);
    this.debugElement = null;
    this._flags = new Int32Array(sab); //todo move to state manager

    this.playerConfig = playerConfig;
    this._logger = LoggersFactory.create(
      playerConfig.instanceName,
      "Video Buffer",
    );
  }

  attachDebugElement(element) {
    this.debugElement = element;
    this._updateDebugView();
  }

  _updateDebugView() {
    if (!this.playerConfig.metricsOverlay) return true;
    // todo use metrics collector instead direct overlay drawing
    if (this.debugElement) {
      let audioMs = Atomics.load(this._flags, IDX.AVAILABLE_AUDIO); // todo move state manager and display independently
      let silenceMs = Atomics.load(this._flags, IDX.SILENCE_USEC) / 1000;
      let vDecQueue = Atomics.load(this._flags, IDX.VIDEO_DECODER_QUEUE);
      let vDecLatency = Atomics.load(this._flags, IDX.VIDEO_DECODER_LATENCY);
      let aDecQueue = Atomics.load(this._flags, IDX.AUDIO_DECODER_QUEUE);
      this.debugElement.textContent =
        `Video buffer:..........${this.frames.length.toString().padStart(4, ".")}f \n` +
        `Audio buffer:..........${audioMs.toString().padStart(4, ".")}ms \n` +
        `Silence inserted:......${Math.ceil(silenceMs).toString().padStart(4, ".")}ms \n` + //todo state manager
        `Video Decoder queue:......${vDecQueue} \n` +
        `Video Decoder latency:.${vDecLatency.toString().padStart(4, ".")}ms \n` +
        `Audio Decoder queue:......${aDecQueue} \n`;
    }
  }

  addFrame(frame, timestamp) {
    if (this.frames.isFull()) {
      const removed = this.frames.pop();
      this._logger.warn(
        `VideoBuffer: overflow, removed old frame ${removed.timestamp}`,
      );
      removed.frame.close();
    }

    this.frames.push({ frame, timestamp });
    console.log('add frame buffer size', this.frames.length);
    this._updateDebugView();
  }

  getFrameForTime(currentTime) {
    if (this.frames.isEmpty()) {
      // this._logger.warn(`VideoBuffer: empty at ts: ${currentTime.toFixed(3)}`);
      return null;
    }

    // find a frame nearest to currentTime
    let lastIdx = -1;
    for (let i = 0; i < this.frames.length; i++) {
      let frame = this.frames.get(i);
      if (frame && frame.timestamp > currentTime) {
        break;
      }
      lastIdx = i;
    }

    // nothing to show, too early
    if (lastIdx < 0) {
      return null;
    }

    for (let i = 0; i < lastIdx; i++) {
      let frame = this.frames.pop();
      if (frame && frame.frame) {
        frame.frame.close();
      }
    }

    const frame = this.frames.pop();

    this._updateDebugView();

    // return the last frame earlier than currentTime
    return frame.frame;
  }

  clear() {
    this.frames.forEach(({ frame, _ }) => {
      frame.close();
    });

    let needUpdate = this.frames.length > 0;
    this.frames.reset();
    if (needUpdate) this._updateDebugView();
  }

  get length() {
    return this.frames.length;
  }
}
