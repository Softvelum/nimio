export const NimioSyncMode = {
  _createSyncModeParams() {
    this._syncModeParams = {};
    this._eventBus.on("nimio:sync-mode-params", (data) => {
      this._syncModeParams.playerTimeMs = data.playerTimeMs;
      this._syncModeParams.serverTimeMs = data.serverTimeMs;
    });
  },

  _initSyncModeParams(frame) {
    if (frame.chunkType === "key" || this._noVideo) {
      let srvTimeDiffUs = frame.showTime - this._syncModeParams.serverTimeMs;
      this._syncModeParams.ptsOffsetMs =
        this._syncModeParams.playerTimeMs + (srvTimeDiffUs - frame.pts) / 1000;
      this._syncModeParams.inited = true;
      this._applySyncModeParams();
    }
  },

  _applySyncModeParams() {
    if (
      !this._syncModeParams.inited ||
      this._syncModeParams.applied ||
      !this._audioNode
    ) return;

    this._latencyCtrl.syncModePtsOffset = this._syncModeParams.ptsOffsetMs;
    this._audioNode.port.postMessage({
      type: "sync-mode-params",
      ptsOffsetMs: this._syncModeParams.ptsOffsetMs,
    });
    this._syncModeParams.applied = true;
  },
};
