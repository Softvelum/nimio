import { BaseMeter } from "./base_meter";

export class ScriptProcessorMeter extends BaseMeter {
  constructor(settings, instName) {
    super(settings.db_range, settings.rate, instName);
    this.mode = settings.mode;
    this.type = settings.type;
    this.calcChannelValueFor = {
      peak: this._calcChannelValuePeak,
      avg: this._calcChannelValueAvg,
      rms: this._calcChannelValueRms,
    }[this.mode];
    this.channelData = [];
    this.logger.debug(
      `ScriptProcessor VU meter constructor: mode=${this.mode}, type=${this.type}, dbRange=${this.dbRange}, rate=${this.rate}`,
    );
  }

  setVolume(v) {
    if (this.gainer) {
      var time = this.context.currentTime;
      this.gainer.gain.setValueAtTime(v, time);
    } else if (this.suspended) {
      this.logger.debug("Setup suspended VU meter");
      this._setupMeter();
      if (this.onActivated && this.isActivated()) {
        this.onActivated();
        this.onActivated = undefined;
      }
    }
  }

  _createMeter() {
    if (undefined === this.meter) {
      this.logger.debug(
        `Create ScriptProcessor meter, channels =${this.channels}`,
      );
      this._initValues();
      this.meter = this.context.createScriptProcessor(
        this.bufSize,
        this.channels,
        this.channels,
      );

      if ("input" === this.type) {
        // source -> meter -> gainer -> destination
        //      \-------------/
        this.audGraphCtrl.appendNode([this.meter, this.gainer], [this.gainer]);
      } else {
        // source -> meter -> destination
        //      \-------------/
        this.audGraphCtrl.appendNode([this.meter, "dest"], [this.meter]);
      }

      this.meter.onaudioprocess = (ev) => this._updateMeter(ev);
    }
  }

  _removeMeter() {
    if (this.meter) {
      this.logger.debug("Remove meter");
      try {
        this.audGraphCtrl.removeVumeterChain();
        if ("input" === this.type) {
          this.meter.disconnect(this.gainer);
          this.gainer = undefined;
        }
        this.meter.onaudioprocess = undefined;
        this.meter = undefined;
      } catch (error) {
        this.gainer = undefined;
        this.meter = undefined;
        this.logger.warn("Exception caught: ", error);
      }
    }
  }

  _gcd(a, b) {
    return !b ? a : this._gcd(b, a % b);
  }

  _setupRateControl() {
    if (this.rateControl) return;

    let control = {};
    let gcdSRbufSize = this._gcd(this.samplingRate, this.bufSize);
    if (this.rate < gcdSRbufSize / this.bufSize) {
      gcdSRbufSize = this.rate * this.bufSize;
      let p = 0;
      while ((gcdSRbufSize >>= 1)) p++;
      gcdSRbufSize = 2 ** p;
    }
    let range = this.bufSize / gcdSRbufSize;

    control.max = this.samplingRate / gcdSRbufSize;
    control.exp = (range * this.rate + 0.5) >>> 0;
    if (control.exp >= control.max) {
      // all readings are required, nothing to filter
      control = false;
    } else {
      control.add = control.max / control.exp;
      control.tgt = control.cur = 0;
      control.cnt = -2;
    }
    this.rateControl = control;
  }

  _calcChannelValueAvg(i) {
    let dSize = this.channelData[i].length;
    for (let sample = 0; sample < dSize; sample++) {
      this.channelValues[i] += Math.abs(this.channelData[i][sample]);
    }
    this.channelValues[i] /= dSize;
  }

  _calcChannelValueRms(i) {
    let dSize = this.channelData[i].length;
    for (let sample = 0; sample < dSize; sample++) {
      this.channelValues[i] +=
        this.channelData[i][sample] * this.channelData[i][sample];
    }
    this.channelValues[i] = Math.sqrt(this.channelValues[i] / dSize);
  }

  _calcChannelValuePeak(i) {
    let dSize = this.channelData[i].length;
    for (let sample = 0; sample < dSize; sample++) {
      var val = Math.abs(this.channelData[i][sample]);
      if (val > this.channelValues[i]) {
        this.channelValues[i] = val;
      }
    }
  }

  _updateMeter(audioProcessingEvent) {
    if (this.rateControl) {
      var ctrl = this.rateControl;
      ctrl.cnt++;
      if (ctrl.tgt === ctrl.cnt) {
        if (ctrl.cur + 0.1 >= ctrl.max) {
          ctrl.cur = ctrl.add;
          ctrl.tgt = ctrl.add >>> 0;
          ctrl.cnt = 0;
        } else {
          ctrl.cur += ctrl.add;
          ctrl.tgt = ctrl.cur >>> 0;
        }
      } else {
        return;
      }
    }

    let inputBuffer = audioProcessingEvent.inputBuffer;
    this.channelData.length = 0;
    for (let i = 0; i < this.channels; i++) {
      this.channelData[i] = inputBuffer.getChannelData(i);
      this.channelValues[i] = 0.0;
      this.calcChannelValueFor(i);
      this.channelDecibels[i] = this._dbFromVal(this.channelValues[i]);
    }
    if (this.ui) {
      this.ui.update(this.channelDecibels);
    }

    // this.logger.debug(this.mode + ' meter', this.channelValues.join('::'), this.channelDecibels.join('::'));
    if (this.callback) {
      this.callback(this.channelValues, this.channelDecibels);
    }
  }
}
