import { BaseProcessor } from "./base-processor";

export class WsolaProcessor extends BaseProcessor {
  constructor(channels, sampleCount, logger) {
    super(logger);
    this._prevBlocks = new Array(channels);
    this._interBlocks = new Array(channels);
    for (let i = 0; i < channels; i++) {
      // TODO: increase buffers size for slow down scenario
      this._prevBlocks[i] = new Float32Array(sampleCount);
      this._interBlocks[i] = new Float32Array(sampleCount);
    }

    this._N = sampleCount;
    this._Ha = this.N >> 1; // 512 (analysis hop)

    this_.window = this._makeHannWindow(this._N);
  }

  process(readParams) {
    if (readParams.step === 1 && !this._hasPrevBlocks) return true;

    this._Hs = Math.floor(this._Ha / readParams.step); // synthesis hop (integer)
    if (this._Hs < 1) this._Hs = 1;

    this._norm = this._computeNormalization();
    
  }

  _computeNormalization() {
    const N = this._N;
    const Hs = this._Hs;
    const K = Math.ceil(N / Hs) + 2;
    const norm = new Float32Array(N);

    for (let k = -K; k <= K; k++) {
      const shift = k * Hs;
      for (let i = 0; i < N; i++) {
        const src = i - shift;
        if (src >= 0 && src < N) norm[i] += this._window[src];
      }
    }

    // avoid tiny values
    for (let i = 0; i < N; i++) if (norm[i] < 1e-12) norm[i] = 1.0;
    return norm;
  }

  _makeHannWindow(N) {
    let win = new Float32Array(N);
    for (var n = 0; n < N; n++) {
      win[n] = 0.5 * (1 - Math.cos(2 * Math.PI * n / N - 1));
    }
  
    return win;
  }

}
