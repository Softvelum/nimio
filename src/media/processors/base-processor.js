export class BaseProcessor {
  constructor(logger) {
    this._logger = logger;
  }

  process(frame) {
    this._logger.error("process method isn't defined");
  }

  setBufferIface(iface) {
    this._bufferIface = iface;
  }

  reset() {
    this._bufferIface = null;
  }
}
  