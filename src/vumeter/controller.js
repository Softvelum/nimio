import { multiInstanceService } from "@/shared/service";
import { VUMeterFactory } from "./factory";

class VUMeterController {
  constructor(instName) {
    this._instName = instName;
  }

  init(settings, updateCb, fatalErrorCb) {
    this._settings = settings;

    if (this._settings && this._settings.mode && this._settings.type) {
      this._inst = new VUMeterFactory(this._instName).create(this._settings);
      if (this._inst) {
        if (this._settings.container) {
          this._inst.setUI(this._settings.container);
        }
        this._settings.initialized = true;
        this._inst.setFatalErrorCallback(this._onFatalError);
        if (updateCb) this._inst.setCallback(updateCb);
      }

      this._onFatalError = fatalErrorCb;
      this._started = false;
    }
  }

  isStarted() {
    return this._started;
  }

  isInitialized() {
    return !!this._settings?.initialized;
  }

  clear() {
    this.stop(true);

    this._settings = undefined;
    this._onFatalError = undefined;
    this._inst = undefined;
    this._started = false;
  }

  setAudioInfo(audioInfo) {
    if (!this._inst) return;

    this._audioInfo = audioInfo;
    this._inst.setAudioInfo(audioInfo);
  }

  start() {
    if (!this._inst) return;

    this._inst.start();
    this._started = true;
  }

  stop(removeUI) {
    if (!this._inst) return;

    this._inst.stop(removeUI);
    this._started = false;
  }

  // handlePlay() {
  //   if (!this._inst) return;
  //   this._inst.onPlay();
  // }

  refreshUI() {
    if (!this._inst) return;
    this._inst.refreshUI(this._audioInfo);
  }

  setUpdateCallback(cb) {
    if (!this._inst) return;
    this._inst.setCallback(cb);
  }

  _onFatalError = function () {
    if ("AudioWorklet" === this._settings.api) {
      this._settings.api = "ScriptProcessor";
      this.init();
      if (this._onFatalError) {
        this._onFatalError();
      }
    }
  }.bind(this);
}

VUMeterController = multiInstanceService(VUMeterController);
export { VUMeterController };
