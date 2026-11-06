import { EventBus } from "@/event-bus";

export class Reconnector {
  constructor(instName, count) {
    this._count = count;
    this._eventBus = EventBus.getInstance(instName);
    this._onConnectionEstablished = () => this.reset();
    this._eventBus.on(
      "nimio:connection-established",
      this._onConnectionEstablished,
    );
    this.reset();
  }

  destroy() {
    this.stop();
    this._eventBus.off(
      "nimio:connection-established",
      this._onConnectionEstablished,
    );
  }

  reset() {
    this.stop();
    this._done = 0;
  }

  // True while a retry is scheduled and has not fired yet; false inside the
  // retry callback, so a stop() from a listener of the retried play sees no
  // pending retry.
  get pending() {
    return !!this._timer;
  }

  stop() {
    if (!this._timer) return;
    clearTimeout(this._timer);
    this._timer = undefined;
  }

  schedule(cb) {
    if (this._done >= this._count) return false;

    if (!this._timer) {
      const inst = this;
      this._timer = setTimeout(function () {
        inst._timer = undefined;
        inst._done++;
        cb();
      }, this._timeout());
    }
    return true;
  }

  _timeout() {
    return this._done < 5 ? 1000 : 5000;
  }
}
