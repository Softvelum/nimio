export class AudioGapsProcessor {
  constructor(sampleCount, sampleRate, logger) {
    this._frameLenUs = (1e6 * sampleCount) / sampleRate;
    this._audioTsShift = 0;
    this._logger = logger;
  }

  process(frame) {
    let frameEffTs = frame.decTimestamp + this._audioTsShift;
    if (this._checkIgnoreRealSamples(frameEffTs)) return false;

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

  _checkIgnoreRealSamples(ts) {
    if (this._lastSilenceTs > 0) {
      const tsDiff = this._lastSilenceTs - ts;
      if (tsDiff >= 0) {
        if (tsDiff < 10_000_000) {
          this._logger.debug(
            `Ignore real audio frames after mute ts=${ts}, last silence ts=${this._lastSilenceTs}`,
          );
          return true;
        }
      } else {
        this._lastSilenceTs = 0;
      }
    }
    return false;
  }
}
