import { multiInstanceService } from "@/shared/service";
import { VUMeterFactory } from "./factory";
import { AudioGraphController } from "@/audio/graph-controller";

class VUMeterService {
  constructor(instName) {
    this._instName = instName;
    this._audGraphCtrl = AudioGraphController.getInstance(instName);
  }

  init(settings, updateCb) {
    this._settings = settings;

    if (this._settings && this._settings.mode && this._settings.type) {
      this._inst = new VUMeterFactory(this._instName).create(this._settings);
      if (this._inst) {
        if (this._settings.container) {
          this._inst.setUI(this._settings.container);
        }
        this._settings.initialized = true;
        this._inst.readyCallback = this._onMeterLoaded.bind(this);
        this._inst.errorCallback = this._onFatalError.bind(this);
        if (updateCb) this._inst.updateCallback = updateCb;
      }
      this._started = false;
    }
  }

  start() {
    if (!this._inst) return;

    this._inst.start();
    this._started = true;
  }

  stop(removeUI) {
    if (!this._inst) return;

    this._audGraphCtrl.removeNode(this._inst.node);
    this._inst.stop(removeUI);
    this._started = false;
  }

  clear() {
    this.stop(true);

    this._settings = undefined;
    this._inst = undefined;
    this._started = false;
  }

  setAudioInfo(audioInfo) {
    if (!this._inst) return;
    this._inst.setAudioInfo(audioInfo);
  }

  refreshUI() {
    if (!this._inst) return;
    this._inst.refreshUI();
  }

  setUpdateCallback(cb) {
    if (!this._inst) return;
    this._inst.updateCallback = cb;
  }

  isInitialized() {
    return !!this._settings?.initialized;
  }

  isStarted() {
    return this._started;
  }

  _onMeterLoaded(meter) {
    if (this._settings.type === "input") {
      this._audGraphCtrl.prependNode(meter, {
        connectSource: true,
        connectNext: true,
        parallel: true,
      });
    } else {
      this._audGraphCtrl.appendNode(meter, {
        connectPrev: true,
        connectDest: true,
        parallel: true,
      });
    }
  }

  _onFatalError() {
    if ("AudioWorklet" === this._settings.api) {
      this._settings.api = "ScriptProcessor";
      this.init(this._settings);
      this.start();
    }
  }
}

VUMeterService = multiInstanceService(VUMeterService);
export { VUMeterService };
