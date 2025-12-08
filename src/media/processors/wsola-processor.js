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

    this._window = this._makeHannWindow(this._N);
  }

  process(readParams) {
    // Algorithm:
    // Compare rates. If params.rate is 1, then check frame's rate. 
    // If it's also 1 and there's no previous block to sum, skip processing.
    // If frame's rate isn't 1, replace param.rate with the frame's rate.
    // If params.rate > 1, check frame's rate

    let readFrame = {
      data: this._bufferIface._frames[readParams.startIdx],
      rate: this._bufferIface._rates[readParams.startIdx],
    };

    if (readParams.rate > 1) {
      return processFastForward();
    }

    applyWsola()

    this._bufferIface.getFrame()

    this._Hs = Math.floor(this._Ha / readParams.step); // synthesis hop (integer)
    if (this._Hs < 1) this._Hs = 1;

    // 
    for (let i = this._N / 2; i < this._N; i++) {

    }
    this._bufferIface.frames[readParams.startIdx]

    // this._norm = this._computeNormalization();


    return true;
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
