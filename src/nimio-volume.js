export const NimioVolume = {
  setVolume(vol) {
    return this._audioVolumeCtrl.setVolume(vol);
  },

  getVolume() {
    return this._audioVolumeCtrl.getVolume();
  },

  mute() {
    return this._audioVolumeCtrl.mute();
  },

  unmute() {
    return this._audioVolumeCtrl.unmute();
  },

  _onVUMeterUpdate(magnitudes, decibels) {
    this._logger.debug("VU meter update", magnitudes, decibels);
  },

  _onVUMeterFatalError() {
    // TODO: restart audio graph
  },
};
