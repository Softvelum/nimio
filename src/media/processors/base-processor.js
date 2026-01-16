export class BaseProcessor {
  constructor(logger) {
    this._logger = logger;
    this._props = {};
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

  get props() {
    return this._props;
  }
}
