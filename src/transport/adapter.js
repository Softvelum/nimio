export class TransportAdapter {
  constructor(workerScript) {
    this.worker = new Worker(workerScript, { type: "module" });
    this.callbacks = {};
    this.worker.onmessage = (e) => this._handleMessage(e.data);
  }

  init() {
    this.worker.postMessage({ type: "INIT" });
  }

  onFrame(callback) {
    this.callbacks["FRAME"] = callback;
  }

  start() {
    this.worker.postMessage({ type: "START" });
  }

  stop() {
    this.worker.postMessage({ type: "STOP" });
  }

  _handleMessage(msg) {
    if (msg.type === "FRAME" && this.callbacks["FRAME"]) {
      this.callbacks["FRAME"](msg.payload);
    }
  }
}
