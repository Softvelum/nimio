// The public methods are safe no-ops once destroy() started: the volume is
// persisted per storage key, so a listener invoked during the teardown must
// not be able to change it for later players.
export const NimioVolume = {
  setVolume(vol) {
    if (this._destroyed) return;
    return this._audioVolumeCtrl.setVolume(vol);
  },

  getVolume() {
    if (this._destroyed) return;
    return this._audioVolumeCtrl.getVolume();
  },

  mute() {
    if (this._destroyed) return;
    return this._audioVolumeCtrl.mute();
  },

  unmute() {
    if (this._destroyed) return;
    return this._audioVolumeCtrl.unmute();
  },

  _onVolumeChange(volume) {
    this._audioVolumeCtrl.setVolume(volume);
  },

  _onMuteUnmuteClick(mute) {
    mute ? this._audioVolumeCtrl.mute() : this._audioVolumeCtrl.unmute();
  },
};
