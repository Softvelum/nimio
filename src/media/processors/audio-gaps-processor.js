export class AudioGapsProcessor {
  constructor (sampleCount, sampleRate) {
    this._frameLenUs = 1e6 * sampleCount / sampleRate;
    this._audioTsShift = 0;
  }

  process (frame) {
    const tsdiff = frame.rawTimestamp - frame.timestamp - this._audioTsShift;
    if (tsdiff >= 2 * this._frameLenUs && tsdiff < 1e6) {
      const fillCnt = tsdiff / this._frameLenUs >>> 0;
      for (let i = 0; i < fillCnt; i++) {
        this._bufferIface.pushSilence(frame.timestamp + this._audioTsShift);
        this._audioTsShift += this._frameLenUs;
      }
    }
    frame.rawTimestamp = frame.timestamp + this._audioTsShift;
  }

  setBufferIface (iface) {
    this._bufferIface = iface;
  }

  reset () {
    this._audioTsShift = 0;
    this._bufferIface = null;
  }
}
