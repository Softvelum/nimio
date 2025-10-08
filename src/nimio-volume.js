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
};
