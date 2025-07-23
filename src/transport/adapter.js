export class TransportAdapter {
  constructor(workerUrl) {
    this._worker = new Worker(new URL(workerUrl, import.meta.url), {
      type: "module",
    });
    this._callbacks = {};
    this._worker.onmessage = (e) => this._handleMessage(e.data);
  }

  send(cmd, data) {
    data.type = cmd;
    this._worker.postMessage(data);
  }

  get callbacks() {
    return this._callbacks;
  }

  set callbacks(cbs) {
    this._callbacks = cbs;
  }

  setCallback(type, callback) {
    this._callbacks[type] = callback;
  }

  _handleMessage(msg) {
    if (msg.type && this._callbacks[msg.type]) {
      this._callbacks[msg.type](msg.data);
    }
  }
}
