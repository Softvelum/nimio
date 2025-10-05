import { AbrController } from "./abr/controller";
import { AbrRenditionProvider } from "./abr/rendition-provider";

export const NimioAbr = {
  startAbr() {
    if (this._noVideo || !this._decoderFlows["video"]) return false;
    if (this._isAutoAbr()) return true;

    this._context.autoAbr = true;
    if (!this._abrController) {
      this._createAbrController();
    }

    if (this._decoderFlows["video"].isActive() && !this._state.isPaused()) {
      this._startAbrController();
    }

    return true;
  },

  stopAbr() {
    if (this._isAutoAbr()) {
      this._context.autoAbr = false;
      this._logger.warn('Stop abr set autoAbr to false');
      this._abrController.stop({ hard: true });
    }
  },

  isAbr() {
    return this._isAutoAbr();
  },

  _isAutoAbr() {
    return this._abrController && this._context.autoAbr;
  },

  _createAbrController() {
    if (this._config.adaptiveBitrate && !this._abrController) {
      this._rendProvider = AbrRenditionProvider.getInstance(this._instName);
      this._context.autoAbr = true;

      let buffering = this._config.latency;
      this._lowBufferMs = buffering > 1000 ? 200 : buffering / 5;
      this._abrController = new AbrController(this._instName, buffering);
      this._abrController.callbacks = {
        switchRendition: (rendId) => {
          return this.setCurrentRendition("video", rendId);
        },
        isInProgress: () => !!this._nextRenditionData,
        probeStream: (idx, duration) => {
          return this._sldpManager.probeStream("video", idx, duration);
        },
        cancelProbe: (sn, doReq) => this._sldpManager.cancelProbe(sn, doReq),
      };

      this._lastBufReportMs = 0;
    }
  },

  _startAbrController() {
    this._abrController.start();
    this._lastBufReportMs = performance.now() + 100;
  },
};
