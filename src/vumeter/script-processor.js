import { BaseMeter } from "./base";

export class ScriptProcessorMeter extends BaseMeter {
  constructor(settings, instName) {
    super(settings.db_range, settings.rate, instName);
    this._mode = settings.mode;
    this._type = settings.type;
    this._calcChannelValueFor = {
      peak: this._calcChannelValuePeak,
      avg: this._calcChannelValueAvg,
      rms: this._calcChannelValueRms,
    }[this._mode];
    this._channelData = [];
    this._bufSize = 2048;
    this._logger.debug(
      `ScriptProcessor VU meter constructor: mode=${this._mode}, type=${this._type}, dbRange=${this._dbRange}, rate=${this._rate}`,
    );
  }

  _createMeter() {
    if (this._meter) return;

    this._logger.debug(`Create ScriptProcessor, channels=${this._channels}`);
    this._initValues();
    this._meter = this._context.createScriptProcessor(
      this._bufSize,
      this._channels,
      this._channels,
    );

    if ("input" === this._type) {
      // source -> meter -> gainer -> destination
      //      \-------------/
      this._audGraphCtrl.appendNode([this._meter, this._gainer], [this._gainer]);
    } else {
      // source -> meter -> destination
      //      \-------------/
      this._audGraphCtrl.appendNode([this._meter, "dest"], [this._meter]);
    }

    this._meter.onaudioprocess = (ev) => this._updateMeter(ev);
  }

  _removeMeter() {
    if (!this._meter) return;

    this._logger.debug("Remove meter");
    try {
      this._audGraphCtrl.removeVumeterChain();
    } catch (error) {
      this._logger.warn("Exception caught: ", error);
    }
    this._meter.onaudioprocess = undefined;
    this._meter = undefined;
  }

  _gcd(a, b) {
    return !b ? a : this._gcd(b, a % b);
  }

  _setupRateControl() {
    if (this._rateControl) return;

    let control = {};
    let gcdSRbufSize = this._gcd(this._samplingRate, this._bufSize);
    if (this._rate < gcdSRbufSize / this._bufSize) {
      gcdSRbufSize = this._rate * this._bufSize;
      let p = 0;
      while ((gcdSRbufSize >>= 1)) p++;
      gcdSRbufSize = 2 ** p;
    }
    let range = this._bufSize / gcdSRbufSize;

    control.max = this._samplingRate / gcdSRbufSize;
    control.exp = (range * this._rate + 0.5) >>> 0;
    if (control.exp >= control.max) {
      // all readings are required, nothing to filter
      control = false;
    } else {
      control.add = control.max / control.exp;
      control.tgt = control.cur = 0;
      control.cnt = -2;
    }
    this._rateControl = control;
  }

  _calcChannelValueAvg(i) {
    let dSize = this._channelData[i].length;
    for (let sample = 0; sample < dSize; sample++) {
      this._channelValues[i] += Math.abs(this._channelData[i][sample]);
    }
    this._channelValues[i] /= dSize;
  }

  _calcChannelValueRms(i) {
    let dSize = this._channelData[i].length;
    for (let sample = 0; sample < dSize; sample++) {
      this._channelValues[i] +=
        this._channelData[i][sample] * this._channelData[i][sample];
    }
    this._channelValues[i] = Math.sqrt(this._channelValues[i] / dSize);
  }

  _calcChannelValuePeak(i) {
    let dSize = this._channelData[i].length;
    for (let sample = 0; sample < dSize; sample++) {
      var val = Math.abs(this._channelData[i][sample]);
      if (val > this._channelValues[i]) {
        this._channelValues[i] = val;
      }
    }
  }

  _updateMeter(audioProcessingEvent) {
    if (this._rateControl) {
      var ctrl = this._rateControl;
      ctrl.cnt++;
      if (ctrl.tgt !== ctrl.cnt) return;

      if (ctrl.cur + 0.1 >= ctrl.max) {
        ctrl.cur = ctrl.add;
        ctrl.tgt = ctrl.add >>> 0;
        ctrl.cnt = 0;
      } else {
        ctrl.cur += ctrl.add;
        ctrl.tgt = ctrl.cur >>> 0;
      }
    }

    let inputBuffer = audioProcessingEvent.inputBuffer;
    this._channelData.length = 0;
    for (let i = 0; i < this._channels; i++) {
      this._channelData[i] = inputBuffer.getChannelData(i);
      this._channelValues[i] = 0.0;
      this._calcChannelValueFor(i);
      this._channelDecibels[i] = this._dbFromVal(this._channelValues[i]);
    }
    if (this._ui) {
      this._ui.update(this._channelDecibels);
    }

    // this._logger.debug(this._mode + ' meter', this._channelValues.join('::'), this._channelDecibels.join('::'));
    if (this._callback) {
      this._callback(this._channelValues, this._channelDecibels);
    }
  }
}
