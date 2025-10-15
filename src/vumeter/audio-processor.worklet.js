class VUMeterAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._alive = true;
    this._dbMult = options.processorOptions.dbMult;
    this._dbRange = options.processorOptions.dbRange;
    this._channels = options.processorOptions.channels;
    this._channelData = [];
    this._channelValues = [];
    this._channelDecibels = [];
    this._calcChannelValueFor = {
      peak: this._calcChannelValuePeak,
      avg: this._calcChannelValueAvg,
      rms: this._calcChannelValueRms,
    }[options.processorOptions.mode];

    this.port.onmessage = (msg) => this._handleMessage(msg);
  }

  _handleMessage(msg) {
    switch (msg.data.cmd) {
      case "init":
        this._channelData.length = 0;
        this._channelValues.length = 0;
        this._channelDecibels.length = 0;
        break;

      case "rate":
        if (this._rate !== msg.data.rate) {
          this._rate = msg.data.rate;
          this._intervalInSamples = msg.data.sRate / msg.data.rate;
          this._samplesTillUpdate = 0;
        }
        break;

      case "stop":
        this._alive = false;
        break;
    }
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

  _calcChannelValueAvg(i) {
    let dSize = this._channelData[i].length;
    for (let smpl = 0; smpl < dSize; smpl++) {
      this._channelValues[i] += Math.abs(this._channelData[i][smpl]);
    }
    this._channelValues[i] /= dSize;
  }

  _calcChannelValueRms(i) {
    let dSize = this._channelData[i].length;
    for (let smpl = 0; smpl < dSize; smpl++) {
      this._channelValues[i] +=
        this._channelData[i][smpl] * this._channelData[i][smpl];
    }
    this._channelValues[i] = Math.sqrt(this._channelValues[i] / dSize);
  }

  _calcChannelValuePeak(i) {
    let dSize = this._channelData[i].length;
    for (let smpl = 0; smpl < dSize; smpl++) {
      var val = Math.abs(this._channelData[i][smpl]);
      if (val > this._channelValues[i]) {
        this._channelValues[i] = val;
      }
    }
  }

  process(inputList, outputList, parameters) {
    if (this._alive) {
      var inputs = inputList[0];
      var outputs = outputList[0];
      var numSamples = 0;
      for (let i = 0; i < this._channels; i++) {
        numSamples = inputs[i] ? inputs[i].length : 0;
        for (let j = 0; j < numSamples; j++) {
          outputs[i][j] = inputs[i][j];
        }
      }

      this._samplesTillUpdate -= numSamples;
      if (this._samplesTillUpdate <= 0) {
        this._samplesTillUpdate += this._intervalInSamples;
        for (let i = 0; i < this._channels; i++) {
          this._channelData[i] = inputs[i] ? inputs[i] : [];
          this._channelValues[i] = 0.0;
          this._calcChannelValueFor(i);
          this._channelDecibels[i] = this._dbFromVal(this._channelValues[i]);
        }
        // console.log('process', this._channelValues, this._channelDecibels);
        this.port.postMessage([this._channelValues, this._channelDecibels]);
      }
    }

    return this._alive;
  }
}

registerProcessor("vu-audio-processor", VUMeterAudioProcessor);
