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

  _onVolumeChange(volume) {
    this._audioVolumeCtrl.setVolume(volume);
  },

  _onMuteUnmuteClick(mute) {
    mute ? this._audioVolumeCtrl.mute() : this._audioVolumeCtrl.unmute();
  },

};
