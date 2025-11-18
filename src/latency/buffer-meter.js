class LatencyBufferMeter {
  constructor(instName) {
    this._shortWindowMs = 300;
    this._longWindowMs = 2000;

    this._shortMin = new SlidingWindowMin(instName, 96, this._shortWindowMs);
    this._longMin = new SlidingWindowMin(instName, 512, this._longWindowMs);

    this._lastValue = 0;
  }

  update(bufMs, nowMs) {
    this._lastValue = bufMs;

    this._shortMin.push(bufMs, nowMs);
    this._longMin.push(bufMs, nowMs);
    this._updateEma(bufMs);
  }

  get ema() {
    return this.ema == null ? 0 : this.ema;
  }

  get shortBuffer() {
    return this._shortMin.getMin(performance.now()) / 1000;
  }

  get longBuffer() {
    return this._longMin.getMin(performance.now()) / 1000;
  }

  get estimatedBuffer() {
    const now = performance.now();
    const shortB = this._shortMin.getMin(now);
    const longB  = this._longMin.getMin(now);

    return 0.6 * shortB + 0.4 * longB;
  }

  reset() {
    this._shortMin.clear();
    this._longMin.clear();
    this._lastValue = 0;
  }

  _updateEma(value) {
    if (this.ema == null) this.ema = value;
    else this.ema = this.emaAlpha * value + (1 - this.emaAlpha) * this.ema;
  }
}