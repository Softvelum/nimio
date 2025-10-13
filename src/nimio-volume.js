import { VUMeterService } from "./vumeter/service";

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

  _createVUMeter() {
    this._vuMeterSvc = VUMeterService.getInstance(this._instName);
    const onUpdate = this._onVUMeterUpdate.bind(this);
    this._vuMeterSvc.init(this._config.vuMeter, onUpdate);
  },

  _onVUMeterUpdate(magnitudes, decibels) {},
};
