export class MeanValue {
  constructor(period = 100) {
    this._count = 0;
    this._sum = 0;
    this._periodMs = period;
    let hasPerformance = typeof performance !== "undefined";
    this._timeFn = hasPerformance ? this._getPerfTime : this._getCurrentTime;
  }

  add(value) {
    this._checkTimer();
    this._sum += value;
    this._count++;
  }

  get() {
    this._checkTimer();
    if (this._count === 0) return 0;
    return this._sum / this._count;
  }

  reset() {
    this._t1Ms = null;
    this._count = 0;
    this._sum = 0;
  }

  _checkTimer() {
    if (!this._t1Ms) {
      this._t1Ms = this._timeFn();
      return;
    }

    let t2Ms = this._timeFn();
    if (t2Ms - this._t1Ms >= this._periodMs) {
      this._t1Ms = t2Ms;
      if (this._count !== 0) {
        this._sum /= this._count;
        this._count = 1;
      }
    }
  }

  _getPerfTime() {
    return performance.now();
  }

  _getCurrentTime() {
    return currentTime * 1000;
  }
}
