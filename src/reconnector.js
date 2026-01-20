import { EventBus } from "@/event-bus";

export class Reconnector {
  constructor (instName, count) {
    this._count = count;
    this._eventBus = EventBus.getInstance(instName);
    this._eventBus.on("nimio:connection-established", () => this.reset());
    this.reset();
  }
  
  reset() {
    this.stop();
    this._done = 0;
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
      this._timer = setTimeout(function() {
        inst._done++;
        cb();
        inst._timer = undefined;
      }, this._timeout());
    }
    return true;
  }

  _timeout() {
    return this._done < 5 ? 1000 : 5000;
  }
};
