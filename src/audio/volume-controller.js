import { multiInstanceService } from "@/shared/service";
import { LoggersFactory } from "@/shared/logger";
import { AudioContextProvider } from "./context-provider";

class AudioVolumeController {
  constructor(instName) {
    this._instName = instName;
    this._logger = LoggersFactory.create(instName, "VolumeController");
    this._audioCtxProvider = AudioContextProvider.getInstance(instName);
  }

  init(settings) {
    this._audioCtx = this._audioCtxProvider.get();
    this._suspended = this._audioCtxProvider.isSuspended();
    this._gainer = this._audioCtx.createGain();
    if (!this._gainer) {
      this._logger.error("Can't initialize volume controller");
      return;
    }

    this._storageId = settings.volumeId;
    this._lastVolume = this._getStoredVolume();
    if (settings.muted) {
      this._gainer.gain.value = 0;
      this._muted = true;
    } else {
      this._gainer.gain.value = this._lastVolume / 100;
    }
  }

  setVolume(val) {
    if (!this._gainer) return false;

    val = this._storeVolume(val);
    if (this._muted) return true;

    this._gainer.gain.setValueAtTime(val / 100, this._audioCtx.currentTime);
    return true;
  }

  getVolume() {
    let vol = 0;
    if (this._gainer) {
      if (this._muted) {
        vol = this._lastVolume || 100;
      } else {
        vol = Math.round(this._gainer.gain.value * 100);
      }
    }
    return vol;
  }

  mute() {
    if (!this._gainer) return false;
    this._gainer.gain.setValueAtTime(0, this._audioCtx.currentTime);
    this._muted = true;
    return true;
  }

  unmute() {
    if (!this._gainer) return false;
    let vol = this._lastVolume >= 0 ? this._lastVolume / 100 : 1;
    this._gainer.gain.setValueAtTime(vol, this._audioCtx.currentTime);
    this._muted = false;
    return true;
  }

  get node() {
    return this._gainer;
  }

  _getStoredVolume() {
    let res = 100;
    if (!window.localStorage) return res;
    try {
      let volume = localStorage.getItem(`nimio_volume_${this._storageId}`);
      if (volume === null) volume = localStorage.getItem("nimio_volume_all");
      res = parseInt(volume);
    } catch (e) {
      this._logger.warn("Error getting last volume from local storage", e);
    }
    if (isNaN(res) || res > 100) res = 100;
    if (res < 0) res = 0;

    return res;
  }

  _storeVolume(val) {
    if (val < 0) val = 0;
    if (val > 100 || isNaN(val)) val = 100;
    if (!window.localStorage) return val;

    try {
      localStorage.setItem(`nimio_volume_${this._storageId}`, val);
      localStorage.setItem("nimio_volume_all", val);
    } catch (e) {
      this._logger.warn("Error setting current volume to localStorage", e);
    }
    this._lastVolume = val;

    return val;
  }
}

AudioVolumeController = multiInstanceService(AudioVolumeController);
export { AudioVolumeController };
