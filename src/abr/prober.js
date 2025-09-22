import LoggersFactory from "@/shared/logger";

export class Prober {
  constructor(instName, stream, period) {
    this._enabled = false;
    this._period = period;
    this._stream = stream;

    this._metricsManager = MetricsManager.getInstance(instName);
    this._logger = LoggersFactory.create(instName, "Prober");
  }

  destroy() {
    if (this._streamId) {
      this._metricsManager.remove(this._streamId);
    }
    this._clearBufCheckInterval();
  }

  start() {
    this._enabled = true;
    this._durations = [];
    this._firstTimestamp = undefined;
    this._lastTimestamp = undefined;
    this._expectedEndTimestamp = undefined;

    this._streamId = this._startProbeCallback(this, this._period + 1);

    this._logger.setPrefix(`Prober (${this._streamId})`);
    this._logger.debug(`start: ${this._stream}, period: ${this._period}`);

    this._metricsManager.add(this._streamId, "probe");
  }

  isEnabled() {
    return this._enabled;
  }

  stop() {
    if (this.isEnabled()) {
      this._enabled = false;
      this._cancelProbeCallback(this);
      this._metricsManager.stop(this._streamId);
      this._clearBufCheckInterval();
    }
  }

  receiveInit() {
    if (!this._bufCheckInterval) {
      this._initTime = performance.now();
      this._initReceivedCallback();
      if (this._period >= 1000) {
        let ctrl = this;
        this._bufCheckInterval = setInterval(function () {
          if (ctrl._firstTimestamp) {
            let bufferedTime =
              (ctrl._lastTimestamp - ctrl._firstTimestamp) / 1000;
            let bufLevel = bufferedTime - (performance.now() - ctrl._initTime);
            if (bufLevel <= 0) {
              ctrl._metricsManager.reportLowBuffer(ctrl._streamId);
            }
          } else {
            ctrl._metricsManager.reportLowBuffer(ctrl._streamId);
          }
        }, 500);
      }
    }
  }

  receiveFrame(timestamp) {
    if (undefined === this._firstTimestamp) {
      this._logger.debug("receiveFrame: firstTimestamp " + timestamp);
      this._firstTimestamp = timestamp;
      this._expectedEndTimestamp = 1000 * this._period + timestamp;
    } else {
      this._durations.push(timestamp - this._lastTimestamp);
    }
    this._lastTimestamp = timestamp;

    let maxDur = this._findDuration();
    this._metricsManager.setRateAdditive(this._streamId, maxDur);
    if (timestamp + maxDur > this._expectedEndTimestamp) {
      this._logger.debug("receiveFrame: lastTimestamp " + timestamp);
      let bufferedTime = (timestamp - this._firstTimestamp) / 1000;
      let bufLevel = bufferedTime - (performance.now() - this._initTime);
      if (bufLevel <= 0) {
        this._metricsManager.reportLowBuffer(this._streamId);
      }
      this.stop();
      this._probeFinishedCallback();
    }
  }

  _findDuration() {
    let result = 0;
    let i = 0;
    let durationCounts = {};
    for (i = 0; i < this._durations.length; i++) {
      let dur = this._durations[i];
      durationCounts[dur] =
        durationCounts[dur] > 0 ? durationCounts[dur] + 1 : 1;
    }
    let maxCount = 0;
    for (i in durationCounts) {
      if (durationCounts[i] > maxCount) {
        let dur = parseInt(i);
        if (dur > 0) {
          result = dur;
          maxCount = durationCounts[i];
        }
      }
    }
    return result;
  }

  _clearBufCheckInterval() {
    if (this._bufCheckInterval) {
      clearInterval(this._bufCheckInterval);
      this._bufCheckInterval = undefined;
    }
  }

  get id() {
    return this._streamId;
  }

  get streamName() {
    return this._stream;
  }

  set callbacks(cbs) {
    this._startProbeCallback = cbs.onStartProbe;
    this._cancelProbeCallback = cbs.onCancelProbe;
    this._initReceivedCallback = cbs.onInitReceived;
    this._probeFinishedCallback = cbs.onProbeFinished;
  }
}
