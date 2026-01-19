import { EventBus } from "./event-bus";

export class Reconnector {
  constructor (instName, count) {
    this._count = count;
    this._eventBus = EventBus.getInstance(instName);
    this._eventBus.on("nimio:connection-established", this.reset);
    this.reset();
  }
  
  reset() {
    this._done = 0;
  }
};