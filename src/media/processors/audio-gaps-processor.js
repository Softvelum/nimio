export class AudioGapsProcessor {
  constructor(sampleCount, sampleRate, logger) {
    this._frameLenUs = (1e6 * sampleCount) / sampleRate;
    this._audioTsShift = 0;
    this._logger = logger;
  }

  process(frame) {
    let frameEffTs = frame.decTimestamp + this._audioTsShift;
    const tsDiff = frame.rawTimestamp - frameEffTs;
    if (tsDiff >= 2 * this._frameLenUs && tsDiff < 1e6) {
      const fillCnt = (tsDiff / this._frameLenUs) >>> 0;
      for (let i = 0; i < fillCnt; i++) {
        let silenceTs = frame.decTimestamp + this._audioTsShift;
        this._bufferIface.pushSilence(silenceTs);
        this._audioTsShift += this._frameLenUs;
        this._lastSilenceTs = silenceTs;
      }
    }
    frame.decTimestamp += this._audioTsShift;
    return true;
  }

  setBufferIface(iface) {
    this._bufferIface = iface;
  }

  reset() {
    this._audioTsShift = 0;
    this._bufferIface = null;
  }
}
