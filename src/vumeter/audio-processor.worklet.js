class VUMeterAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.alive = true;
    this.dbMult = options.processorOptions.dbMult;
    this.dbRange = options.processorOptions.dbRange;
    this.channels = options.processorOptions.channels;
    this.channelData = [];
    this.channelValues = [];
    this.channelDecibels = [];
    this.calcChannelValueFor = {
      peak: this._calcChannelValuePeak,
      avg: this._calcChannelValueAvg,
      rms: this._calcChannelValueRms,
    }[options.processorOptions.mode];

    this.port.onmessage = (msg) => this._handleMessage(msg);
  }

  _handleMessage(msg) {
    switch (msg.data.cmd) {
      case "init":
        this.channelData.length = 0;
        this.channelValues.length = 0;
        this.channelDecibels.length = 0;
        break;

      case "rate":
        if (this.rate !== msg.data.rate) {
          this.rate = msg.data.rate;
          this.intervalInSamples = msg.data.sRate / msg.data.rate;
          this.samplesTillUpdate = 0;
        }
        break;

      case "stop":
        this.alive = false;
        break;
    }
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

  _calcChannelValueAvg(i) {
    let dSize = this.channelData[i].length;
    for (let smpl = 0; smpl < dSize; smpl++) {
      this.channelValues[i] += Math.abs(this.channelData[i][smpl]);
    }
    this.channelValues[i] /= dSize;
  }

  _calcChannelValueRms(i) {
    let dSize = this.channelData[i].length;
    for (let smpl = 0; smpl < dSize; smpl++) {
      this.channelValues[i] +=
        this.channelData[i][smpl] * this.channelData[i][smpl];
    }
    this.channelValues[i] = Math.sqrt(this.channelValues[i] / dSize);
  }

  _calcChannelValuePeak(i) {
    let dSize = this.channelData[i].length;
    for (let smpl = 0; smpl < dSize; smpl++) {
      var val = Math.abs(this.channelData[i][smpl]);
      if (val > this.channelValues[i]) {
        this.channelValues[i] = val;
      }
    }
  }

  process(inputList, outputList, parameters) {
    if (this.alive) {
      var inputs = inputList[0];
      var outputs = outputList[0];
      var numSamples = 0;
      for (let i = 0; i < this.channels; i++) {
        numSamples = inputs[i] ? inputs[i].length : 0;
        for (let j = 0; j < numSamples; j++) {
          outputs[i][j] = inputs[i][j];
        }
      }

      this.samplesTillUpdate -= numSamples;
      if (this.samplesTillUpdate <= 0) {
        this.samplesTillUpdate += this.intervalInSamples;
        for (let i = 0; i < this.channels; i++) {
          this.channelData[i] = inputs[i] ? inputs[i] : [];
          this.channelValues[i] = 0.0;
          this.calcChannelValueFor(i);
          this.channelDecibels[i] = this._dbFromVal(this.channelValues[i]);
        }
        // console.log('process', this.channelValues, this.channelDecibels);
        this.port.postMessage([this.channelValues, this.channelDecibels]);
      }
    }

    return this.alive;
  }
}

registerProcessor("vu-audio-processor", VUMeterAudioProcessor);
