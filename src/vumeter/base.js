import { AudioContextProvider } from "@/audio/context-provider";
import { VUMeterUI } from "./ui";
import { LoggersFactory } from "@/shared/logger";
import { resolveContainer } from "@/shared/container";

export class BaseMeter {
  constructor(dbRange, rate, instName) {
    this._dbRange = dbRange || 100;
    this._dbMult = 20; // min level 0.00001 -> 100 dB
    this._rate = rate || 6;
    this._logger = LoggersFactory.create(instName, "VU meter");
    this._instName = instName;
    this._channels = 2;
  }

  start() {
    this._logger.debug(
      `Start VU meter, channel count: ${this._channels}, sampling rate: ${this._samplingRate}`,
    );
    this._context = AudioContextProvider.getInstance(this._instName).get();
    this._setupMeter();
  }

  stop(removeUI) {
    this._logger.debug("Stop VU meter", removeUI);
    // this._audGraphCtrl.removeNode(this._meter);
    this._removeMeter();
    this._initValues();
    if (this._ui) {
      this._ui.destroy(removeUI);
    }
  }

  setup() {
    return this._setupMeter();
  }

  setAudioInfo(audioInfo) {
    this._samplingRate = audioInfo ? audioInfo.sampleRate : undefined;
    this._channels = audioInfo ? audioInfo.channels || 2 : 2;
    // TODO: update ui channels if ui and channels count has been updated
  }

  refreshUI() {
    if (!this._ui) return;
    this._ui.refresh(this._channels);
  }

  set readyCallback(cb) {
    this._readyCallback = cb;
  }

  set updateCallback(cb) {
    this._updateCallback = cb;
  }

  set errorCallback(cb) {
    this._errorCallback = cb;
  }

  setUI(containerId) {
    if (!containerId) return;
    let element;
    try {
      ({ element } = resolveContainer(containerId, { logger: this._logger }));
    } catch (err) {
      this._logger.error("VU meter UI container not found", err);
      return;
    }
    this._ui = new VUMeterUI(element, this._dbRange);
  }

  get node() {
    return this._meter;
  }

  _setupMeter() {
    this._createMeter();
    this._logger.debug("meter created", this._context.state);
    if (this._rate && this._samplingRate) {
      this._setupRateControl();
    }

    if (this._ui) {
      this._logger.debug(`_setupMeter channels = ${this._channels}`);
      this._ui.create(this._channels);
    }
  }

  _initValues() {
    this._rateControl = false;
    this._channelValues = [];
    this._channelDecibels = [];
  }

  _dbFromVal(val) {
    let db = -this._dbRange;
    if (val > 0) {
      db = this._dbMult * Math.log10(val);
      if (db < -this._dbRange) {
        db = -this._dbRange;
      }
    }
    return db;
  }
}
