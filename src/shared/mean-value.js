import { currentTimeGetterMs } from "./helpers";

export class MeanValue {
  constructor(period = 100) {
    // this._count = 0;
    // this._sum = 0;
    this._alpha = 0.15;
    this._periodMs = period;
    this._getCurTime = currentTimeGetterMs();
  }

  add(value) {
    this._checkTimer();
    if (value < this._min || this._min === undefined) {
      this._min = value;
    }
    if (this._avg !== undefined) {
      this._avg = this._alpha * value + (1 - this._alpha) * this._avg;
    } else {
      this._avg = value;
    }
    // this._sum += value;
    // this._count++;
  }

  get() {
    let prev = this._min;
    this._checkTimer();
    if (this._min === undefined) this._min = prev;
    // if (this._count === 0) return 0;
    // return this._sum / this._count;
    return this._min;
    // return this._avg;
  }

  reset() {
    this._t1Ms = null;
    this._min = undefined;
    this._avg = undefined;
    // this._count = 0;
    // this._sum = 0;
  }

  _checkTimer() {
    if (!this._t1Ms) {
      this._t1Ms = this._getCurTime();
      return;
    }

    let t2Ms = this._getCurTime();
    if (t2Ms - this._t1Ms >= this._periodMs) {
      this._t1Ms = t2Ms;
      this._min = undefined;
      // if (this._count !== 0) {
      //   this._sum /= this._count;
      //   this._count = 1;
      // }
    }
  }
}
