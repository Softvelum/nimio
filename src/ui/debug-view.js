export class DebugView {
  constructor(parent, state, vBuffer) {
    this._inst = document.createElement('div');
    this._inst.classList.add("debug-overlay");
    parent.appendChild(this._inst);
    this._state = state;
    this._vBuffer = vBuffer;
  }

  stop() {
    if (this._updateInterval) {
      clearInterval(this._updateInterval);
      this._updateInterval = null;
    }
  }

  start() {
    if (this._updateInterval) return false;

    this._updateInterval = setInterval(() => {
      this.update();
    }, 50);
    return true;
  }

  update() {
    if (!this._inst || !this._state || !this._vBuffer) return true;
    // TODO: use metrics collector instead direct overlay drawing
    let audioMs = this._state.getAvailableAudioMs();
    let videoMs = this._state.getAvailableVideoMs();
    let silenceMs = this._state.getSilenceMs();
    let vDecQueue = this._state.getVideoDecoderQueue();
    let vDecLatency = this._state.getVideoDecoderLatency();
    let aDecQueue = this._state.getAudioDecoderQueue();

    this._inst.textContent =
      `Video buffer:....${this._vBuffer.length.toString().padStart(4, ".")}f..${videoMs}ms \n` +
      `Audio buffer:..........${audioMs.toString().padStart(4, ".")}ms \n` +
      `Silence inserted:......${Math.ceil(silenceMs).toString().padStart(4, ".")}ms \n` + //todo state manager
      `Video Decoder queue:......${vDecQueue} \n` +
      `Video Decoder latency:.${vDecLatency.toString().padStart(4, ".")}ms \n` +
      `Audio Decoder queue:......${aDecQueue} \n`;
  }
}
