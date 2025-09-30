import VUMeterUI from "./ui";
import AudioContextProvider from "media/audio_context_provider";
import AudioGraphController from "media/audio_graph_controller";
import LoggersFactory from "@/shared/logger";

class BaseMeter {
  constructor(dbRange, rate, instName) {
    this.dbRange = dbRange || 100;
    this.dbMult = 20; // min level 0.00001 -> 100 dB
    this.bufSize = 2048;
    this.rate = rate || 6;
    this.logger = LoggersFactory.create(instName, "VU meter");
    this.instName = instName;
    this.channels = 2;
  }

  start(mediaElement) {
    this.logger.debug(
      `Start VU meter, channel count: ${this.channels}, sampling rate: ${this.samplingRate}`,
    );
    this.mediaElement = mediaElement;

    if (this.context && this.context.state === "suspended") {
      this.suspended = true;
    }
    this._setupMeter();
  }

  setAudioInfo(audioInfo) {
    this.samplingRate = audioInfo ? audioInfo.samplingRate : undefined;
    this.channels = audioInfo ? audioInfo.channels || 2 : 2;
    if (this.audGraphCtrl) {
      this.audGraphCtrl.setChannelCount(this.channels);
    }
    // TODO: update ui channels if ui and channels count was updated
  }

  stop(removeUI) {
    this.logger.debug("Stop VU meter", removeUI);
    this._removeMeter();
    this._initValues();
    if (this.ui) {
      this.ui.destroy(removeUI);
    }
  }

  setup() {
    return this._setupMeter();
  }

  refreshUI(audioInfo) {
    if (this.ui) {
      let channels = audioInfo ? audioInfo.channels || 2 : 2;
      this.logger.debug(`refreshUI channels count = ${channels}`);
      this.ui.refresh(channels);
    }
  }

  onPlay() {
    if (this.context) {
      this.logger.debug("onPlay event, resume context");
      this.context.resume();
    }
  }

  setCallback(cb) {
    this.callback = cb;
  }

  setFatalErrorCallback(cb) {
    this.fatalErrorCallback = cb;
  }

  setUI(containerId) {
    let container = document.getElementById(containerId);
    if (container) {
      this.ui = new VUMeterUI(container, this.dbRange);
    }
  }

  isActivated() {
    return undefined !== this.context && "running" === this.context.state;
  }

  _setupMeter() {
    let ok = this._enableSource();
    if (ok) {
      this._createMeter();
      this.logger.debug("meter created", this.context.state);
      if (this.rate && this.samplingRate) {
        this._setupRateControl();
      }

      if (this.ui) {
        this.logger.debug(`_setupMeter channels = ${this.channels}`);
        this.ui.create(this.channels);
      }
    }
    return ok;
  }

  _initValues() {
    this.suspended = false;
    this.rateControl = false;
    this.channelValues = [];
    this.channelDecibels = [];
  }

  _enableSource() {
    if (undefined === this.context) {
      let audCtxProvider = AudioContextProvider.getInstance(this.instName);
      this.context = audCtxProvider.get();
      if (this.context) {
        this.audGraphCtrl = AudioGraphController.getInstance(this.instName);
        if ("suspended" !== this.context.state) {
          this.logger.debug(`_enableSource channels = ${this.channels}`);
          this.audGraphCtrl.init(this.mediaElement, this.channels);
          this.suspended = false;
        } else {
          var meter = this;
          audCtxProvider.onContextRunning(function (ctx) {
            meter.logger.debug(
              "Audio context switched its state to running, setup VU meter, channels =",
              meter.channels,
            );
            meter.audGraphCtrl.init(meter.mediaElement, meter.channels);
            meter.suspended = false;
            meter._setupMeter();
            if (meter.onActivated) {
              meter.onActivated();
              meter.onActivated = undefined;
            }
          });

          this.logger.debug("Audio context is created, but it's suspended");
          this.suspended = true;
          this.context.resume();
        }
      }
    } else if (this.suspended) {
      this.logger.debug("Trying to resume suspended audio context");
      this.context.resume();
    }
    return this.isActivated();
  }

  _dbFromVal(val) {
    let db = -this.dbRange;
    if (val > 0) {
      db = this.dbMult * Math.log10(val);
      if (db < -this.dbRange) {
        db = -this.dbRange;
      }
    }
    return db;
  }
}

export default BaseMeter;
