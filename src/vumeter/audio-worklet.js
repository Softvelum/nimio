import vuProcessorUrl from "./audio-processor.worklet?worker&url";
import { ScriptPathProvider } from "@/shared/script-path-provider";
import { BaseMeter } from "./base_meter";

class AudioWorkletMeter extends BaseMeter {
  constructor(settings, instName) {
    super(settings.db_range, settings.rate, instName);
    this.mode = settings.mode;
    this.type = settings.type;

    this._spProvider = ScriptPathProvider.getInstance(instName);
    this.logger.debug(
      `AudioWorklet VU meter constructor: mode=${this.mode}, type=${this.type}, dbRange=${this.dbRange}, rate=${this.rate}`
    );
  }

  setVolume(v) {
    if (this.gainer) {
      this.gainer.gain.setValueAtTime(v, this.context.currentTime);
    } else if (this.suspended) {
      this.logger.debug("Setup suspended VU meter");
      this._setupMeter();
      if (this.onActivated && this.isActivated()) {
        this.onActivated();
        this.onActivated = undefined;
      }
    }
  }

  _onWorkletModuleAdded = () => {
    this.logger.debug("AudioWorklet module loaded", this.procUrl);
    this.meter = new AudioWorkletNode(this.context, "vu-audio-processor", {
      processorOptions: {
        channels: this.channels,
        dbRange: this.dbRange,
        dbMult: this.dbMult,
        mode: this.mode,
      },
    });
    this.meter.port.postMessage({ cmd: "init" });
    // For input type: source -> meter -> gainer -> destination
    // For output type: source -> meter -> destination
    if ("input" === this.type) {
      this.audGraphCtrl.addVumeterChain([this.meter], [this.gainer]);
    } else {
      this.audGraphCtrl.addVumeterChain([this.meter], [this.meter]);
    }

    this._setupRateControl();
    this.meter.port.onmessage = (ev) => this._updateMeter(ev);
  };

  _onWorkletModuleNotFound = (error) => {
    if (this.procUrl === vuProcessorUrl) {
      this._onWorkletModuleError(error);
    } else {
      this.context.audioWorklet
        .addModule(vuProcessorUrl)
        .then(this._onWorkletModuleAdded)
        .catch(this._onWorkletModuleError);
    }
  };

  _onWorkletModuleError = (error) => {
    this.logger.error(
      this._spProvider.notAvailableError(
        "AudioWorkletProcessor",
        vuProcessorUrl,
      ),
      error,
    );

    this.stop(true);
    this.context = undefined;
    if (this.fatalErrorCallback) {
      this.fatalErrorCallback();
    }
  };

  _createMeter() {
    if (undefined === this.meter) {
      this.logger.debug("Create AudioWorklet meter");

      this._initValues();
      this.procUrl = this._spProvider.translateToScriptPath(vuProcessorUrl);

      this.context.audioWorklet
        .addModule(this.procUrl)
        .then(this._onWorkletModuleAdded)
        .catch(this._onWorkletModuleNotFound);
    }
  }

  _removeMeter() {
    if (this.meter) {
      this.logger.debug("Remove meter");
      try {
        this.meter.port.postMessage({ cmd: "stop" });
        this.audGraphCtrl.removeVumeterChain();
        if ("input" === this.type) {
          this.meter.disconnect(this.gainer);
        }
      } catch (error) {
        this.logger.warn("Exception caught: ", error);
      }
      this.meter = undefined;
    }
  }

  _setupRateControl() {
    if (this.meter) {
      this.meter.port.postMessage({
        cmd: "rate",
        rate: this.rate,
        sRate: this.samplingRate,
      });
    }
  }

  _updateMeter(prEv) {
    for (var i = 0; i < this.channels; i++) {
      this.channelValues[i] = prEv.data[0][i];
      this.channelDecibels[i] = prEv.data[1][i];
    }
    // this.logger.debug(this.mode + ' meter', this.channelValues.join('::'), this.channelDecibels.join('::'));
    if (this.ui) {
      this.ui.update(this.channelDecibels);
    }

    if (this.callback) {
      this.callback(this.channelValues, this.channelDecibels);
    }
  }
}

export default AudioWorkletMeter;
