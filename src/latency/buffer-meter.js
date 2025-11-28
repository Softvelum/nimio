import { SlidingMin } from "@/shared/sliding-min";

export class LatencyBufferMeter {
  constructor(instName, shortWindowMs, longWindowMs) {
    this._shortWindowMs = shortWindowMs;
    this._longWindowMs = longWindowMs;
    this._emaAlpha = 0.15;

    let fCnt = this._fpw(10 * this._shortWindowMs); // 10 times reserve just in case
    this._shortMin = new SlidingMin(instName, this._shortWindowMs, fCnt);
    fCnt = this._fpw(10 * this._longWindowMs);
    this._longMin = new SlidingMin(instName, this._longWindowMs, fCnt);
  }

  update(bufMs, nowMs) {
    this._shortMin.push(bufMs, nowMs);
    this._longMin.push(bufMs, nowMs);
    this._updateEma(bufMs);
  }

  get(timeMs) {
    return `shortMin=${this.short(timeMs)?.toFixed(4)}ms, longMin=${this.long(timeMs)?.toFixed(4)}ms, est=${this.estimatedBuffer(timeMs)?.toFixed(4)}ms, ema=${this.ema().toFixed(4)}ms`;
  }

  short(timeMs) {
    return this._shortMin.getMin(timeMs);
  }

  long(timeMs) {
    return this._longMin.getMin(timeMs);
  }

  ema() {
    return this._ema || 0;
  }

  estimatedBuffer(timeMs) {
    const shortB = this._shortMin.getMin(timeMs);
    const longB = this._longMin.getMin(timeMs);

    return 0.6 * shortB + 0.4 * longB;
  }

  reset() {
    this._shortMin.clear();
    this._longMin.clear();
    this._ema = undefined;
  }

  _updateEma(value) {
    if (this._ema === undefined) this._ema = value;
    else this._ema = this._emaAlpha * value + (1 - this._emaAlpha) * this._ema;
  }

  _fpw(sizeMs) {
    // max frames per window
    return Math.ceil((60 * sizeMs) / 1000);
  }
}
