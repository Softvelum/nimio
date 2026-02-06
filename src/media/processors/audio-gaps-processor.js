import { BaseProcessor } from "./base-processor";

export class AudioGapsProcessor extends BaseProcessor {
  constructor(sampleCount, sampleRate, logger) {
    super(logger);
    this._frameLenUs = (1e6 * sampleCount) / sampleRate;
    this._audioTsShift = 0;
  }

  process(frame) {
    let frameEffTs = frame.decTimestamp + this._audioTsShift;
    const tsDiff = frame.rawTimestamp - frameEffTs;
    if (tsDiff >= 2 * this._frameLenUs && tsDiff < 1e6) {
      const fillCnt = (tsDiff / this._frameLenUs) >>> 0;
      for (let i = 0; i < fillCnt; i++) {
        let silenceTs = frame.decTimestamp + this._audioTsShift;
        if (this._bufferIface.pushSilence(silenceTs) === -1) {
          return false;
        }
        this._audioTsShift += this._frameLenUs;
        this._lastSilenceTs = silenceTs;
      }
    }
    frame.decTimestamp += this._audioTsShift;
    return true;
  }

  reset() {
    super.reset();
    this._audioTsShift = 0;
  }
}
