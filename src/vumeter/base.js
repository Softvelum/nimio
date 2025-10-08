import { AudioContextProvider } from "@/audio/context-provider";
import { VUMeterUI } from "./ui";
import { LoggersFactory } from "@/shared/logger";

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

    if (this._context?.state === "suspended") {
      this._suspended = true;
    }
    this._setupMeter();
  }

  setAudioInfo(audioInfo) {
    this._samplingRate = audioInfo ? audioInfo.samplingRate : undefined;
    this._channels = audioInfo ? audioInfo.channels || 2 : 2;
    if (this._audGraphCtrl) {
      this._audGraphCtrl.setChannelCount(this._channels);
    }
    // TODO: update ui channels if ui and channels count has been updated
  }

  stop(removeUI) {
    this._logger.debug("Stop VU meter", removeUI);
    this._removeMeter();
    this._initValues();
    if (this._ui) {
      this._ui.destroy(removeUI);
    }
  }

  setup() {
    return this._setupMeter();
  }

  refreshUI(audioInfo) {
    if (!this._ui) return;

    let channels = audioInfo ? audioInfo.channels || 2 : 2;
    this._logger.debug(`refreshUI channels count = ${channels}`);
    this._ui.refresh(channels);
  }

  // onPlay() {
  //   if (!this._context) return;

  //   this._logger.debug("onPlay event, resume context");
  //   this._context.resume();
  // }

  setCallback(cb) {
    this._callback = cb;
  }

  setFatalErrorCallback(cb) {
    this._fatalErrorCallback = cb;
  }

  setUI(containerId) {
    let container = document.getElementById(containerId);
    if (container) {
      this._ui = new VUMeterUI(container, this._dbRange);
    }
  }

  isActivated() {
    return this._context?.state === "running";
  }

  _setupMeter() {
    let ok = this._enableSource();
    if (ok) {
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
    return ok;
  }

  _initValues() {
    this._suspended = false;
    this._rateControl = false;
    this._channelValues = [];
    this._channelDecibels = [];
  }

  _enableSource() {
    if (!this._context) {
      let audCtxProvider = AudioContextProvider.getInstance(this._instName);
      this._context = audCtxProvider.get();
      if (this._context) {
        this._audGraphCtrl = AudioGraphController.getInstance(this._instName);
        if ("suspended" !== this._context.state) {
          this._logger.debug(`enableSource channels = ${this._channels}`);
          this._audGraphCtrl.init(this._channels);
          this._suspended = false;
        } else {
          var meter = this;
          audCtxProvider.onContextRunning(function (ctx) {
            meter._logger.debug(
              "Audio context switched its state to running, setup VU meter, channels =",
              meter._channels,
            );
            meter._audGraphCtrl.init(meter._channels);
            meter._suspended = false;
            meter._setupMeter();
            if (meter.onActivated) {
              meter.onActivated();
              meter.onActivated = undefined;
            }
          });

          this._logger.debug("Audio context is created, but it's suspended");
          this._suspended = true;
          this._context.resume();
        }
      }
    } else if (this._suspended) {
      this._logger.debug("Trying to resume suspended audio context");
      this._context.resume();
    }
    return this.isActivated();
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
