import { LoggersFactory } from "@/shared/logger";

// Time given to the worker to process "terminate" (which closes the socket
// and the worker itself) before the thread is killed from the main side.
const TERMINATE_FALLBACK_MS = 1000;

export class TransportAdapter {
  constructor(instName, workerUrl) {
    this._logger = LoggersFactory.create(instName, "Transport");

    this._worker = new Worker(workerUrl, {
      type: "module",
    });
    this._callbacks = {};
    this._worker.onmessage = (e) => this._handleMessage(e.data);
    this._connected = false;
    this._session = 0; // numbers each "start"; the worker tags its replies
  }

  send(cmd, data) {
    if (!this._worker) return; // destroyed
    data.type = cmd;
    if (cmd === "start") {
      data.session = ++this._session;
      // the previous socket is being replaced and the new one is not open
      // yet; its own connected:true/false will follow with the new session
      this._connected = false;
    }
    this._worker.postMessage(data);
  }

  destroy() {
    const worker = this._worker;
    if (!worker) return;

    this._worker = undefined;
    this._callbacks = {};
    this._connected = false;
    worker.onmessage = null;
    try {
      // handled after any stop/close already queued, so the socket is
      // closed gracefully before the worker closes itself
      worker.postMessage({ type: "terminate" });
    } catch (err) {
      this._logger.debug("Transport worker terminate request failed", err);
    }
    setTimeout(() => worker.terminate(), TERMINATE_FALLBACK_MS);
  }

  get connected() {
    return this._connected;
  }

  get callbacks() {
    return this._callbacks;
  }

  set callbacks(cbs) {
    this._callbacks = cbs;
  }

  setCallback(type, callback) {
    this._callbacks[type] = callback;
    return this;
  }

  runCallback(type, data) {
    if (!this._worker) return; // destroyed
    const callback = this._callbacks[type];
    if (!callback) {
      this._logger.error(`No callback set for type: ${type}`);
      return;
    }
    return callback(data);
  }

  _handleMessage(msg) {
    // a reply the worker posted for an earlier start, delivered after a
    // stop and a new start, belongs to a session that no longer exists
    if (msg.session !== undefined && msg.session !== this._session) return;
    if (msg.type && this._callbacks[msg.type]) {
      this._callbacks[msg.type](msg.data);
    } else if (msg.aux) {
      if ("connected" in msg) {
        // console.log(`Connected ${msg.connected}`);
        this._connected = msg.connected;
      }
    }
  }
}
