import { MetricsManager } from "@/metrics/manager";
import LoggersFactory from "@/shared/logger";

export class Prober {
  constructor(instName, streamIdx, period) {
    this._enabled = false;
    this._period = period;
    this._idx = streamIdx;

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
    this._firstTimestamp = undefined;
    this._lastTimestamp = undefined;
    this._expectedEndTimestamp = undefined;

    this._streamId = this._startProbeCallback(this._idx, this._period + 1);

    this._logger.setPrefix(`Prober (${this._streamId})`);
    this._logger.debug(`start: ${this._idx}, period: ${this._period}`);

    this._metricsManager.add(this._streamId, "probe");
  }

  isEnabled() {
    return this._enabled;
  }

  stop() {
    if (this.isEnabled()) {
      this._enabled = false;
      // TODO: destinguish cases when send cancel request and when not
      this._cancelProbeCallback(this._streamId, true);
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
            let bufTime = (ctrl._lastTimestamp - ctrl._firstTimestamp) / 1000;
            let bufLevel = bufTime - (performance.now() - ctrl._initTime);
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
    if (!(this._firstTimestamp <= timestamp)) {
      this._logger.debug(`receiveFrame: firstTimestamp ${timestamp}`);
      this._firstTimestamp = timestamp;
      this._expectedEndTimestamp = 1000 * this._period + timestamp;
    }
    if (!(this._lastTimestamp >= timestamp)) {
      this._lastTimestamp = timestamp;
    }

    let frameDur = this._metricsManager.getFrameDuration(this._streamId);
    if (timestamp + frameDur > this._expectedEndTimestamp) {
      this._logger.debug(`receiveFrame: lastTimestamp ${timestamp}`);
      let bufferedTime = (timestamp - this._firstTimestamp) / 1000;
      let bufLevel = bufferedTime - (performance.now() - this._initTime);
      if (bufLevel <= 0) {
        this._metricsManager.reportLowBuffer(this._streamId);
      }
      this.stop();
      this._probeFinishedCallback();
    }
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

  get period() {
    return this._period;
  }

  set callbacks(cbs) {
    this._startProbeCallback = cbs.onStartProbe;
    this._cancelProbeCallback = cbs.onCancelProbe;
    this._initReceivedCallback = cbs.onInitReceived;
    this._probeFinishedCallback = cbs.onProbeFinished;
  }
}
