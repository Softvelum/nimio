import vuProcUrl from "./audio-processor.worklet?worker&url";
import { ScriptPathProvider } from "@/shared/script-path-provider";
import { BaseMeter } from "./base";

class AudioWorkletMeter extends BaseMeter {
  constructor(settings, instName) {
    super(settings.db_range, settings.rate, instName);
    this._mode = settings.mode;
    this._type = settings.type;

    this._spProvider = ScriptPathProvider.getInstance(instName);
    this._logger.debug(
      `AudioWorklet VU meter constructor: mode=${this._mode}, type=${this._type}, dbRange=${this._dbRange}, rate=${this._rate}`,
    );
  }

  _onWorkletModuleAdded = () => {
    this._logger.debug("AudioWorklet module loaded", this._procUrl);
    this._meter = new AudioWorkletNode(this._context, "vu-audio-processor", {
      processorOptions: {
        channels: this._channels,
        dbRange: this._dbRange,
        dbMult: this._dbMult,
        mode: this._mode,
      },
    });
    this._meter.port.postMessage({ cmd: "init" });
    this._setupRateControl();
    this._meter.port.onmessage = (ev) => this._updateMeter(ev);
  };

  _onWorkletModuleNotFound = (error) => {
    if (this._procUrl === vuProcUrl) {
      this._onWorkletModuleError(error);
    } else {
      this._context.audioWorklet
        .addModule(vuProcUrl)
        .then(this._onWorkletModuleAdded)
        .catch(this._onWorkletModuleError);
    }
  };

  _onWorkletModuleError = (error) => {
    this._logger.error(
      this._spProvider.notAvailableError("AudioWorkletProcessor", vuProcUrl),
      error,
    );

    this.stop(true);
    this._context = undefined;
    if (this._fatalErrorCallback) {
      this._fatalErrorCallback();
    }
  };

  _createMeter() {
    if (undefined === this._meter) {
      this._logger.debug("Create AudioWorklet meter");

      this._initValues();
      this._procUrl = this._spProvider.translateToScriptPath(vuProcUrl);

      this._context.audioWorklet
        .addModule(this._procUrl)
        .then(this._onWorkletModuleAdded)
        .catch(this._onWorkletModuleNotFound);
    }
  }

  _removeMeter() {
    if (this._meter) {
      this._logger.debug("Remove meter");
      try {
        this._meter.port.postMessage({ cmd: "stop" });
        this._audGraphCtrl.removeVumeterChain();
      } catch (error) {
        this._logger.warn(`Exception caught: ${error}`);
      }
      this._meter = undefined;
    }
  }

  _setupRateControl() {
    if (this._meter) {
      this._meter.port.postMessage({
        cmd: "rate",
        rate: this._rate,
        sRate: this._samplingRate,
      });
    }
  }

  _updateMeter(prEv) {
    for (var i = 0; i < this._channels; i++) {
      this._channelValues[i] = prEv.data[0][i];
      this._channelDecibels[i] = prEv.data[1][i];
    }
    // this._logger.debug(this._mode + ' meter', this._channelValues.join('::'), this._channelDecibels.join('::'));
    if (this._ui) {
      this._ui.update(this._channelDecibels);
    }

    if (this._callback) {
      this._callback(this._channelValues, this._channelDecibels);
    }
  }
}

export { AudioWorkletMeter };
