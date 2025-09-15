import { AbrRenditionProvider } from "./rendition-provider";
import { MetricsManager } from "@/metrics/manager";
import LoggersFactory from "@/shared/logger";

const RELIABLE_INTERVAL = 3000;

export class AbrEvaluator {
  constructor(instName, bufferTime) {
    this._running = false;
    this._runsCount = 0;

    this._metricsManager = MetricsManager.getInstance(instName);
    this._renditionProvider = AbrRenditionProvider.getInstance(instName);
    this._logger = LoggersFactory.create(instName, "AbrEvaluator");

    this.setBuffering(bufferTime);
  }

  init(curStream) {
    this._curStream = curStream;
  }

  clear() {
    this._logger.debug("clear");
    this.cancel();
    this._curStream = undefined;
  }

  cancel() {
    if (this._running) {
      this._logger.debug("cancel");
      this._running = false;
      this._prober.stop();
    }
    this.destroyProber();
  }

  destroyProber() {
    if (this._prober) {
      this._prober.destroy();
      this._prober = undefined;
    }
  }

  run() {
    this._curBandwidth = this.calculateCurStreamMetric("avgBandwidth");
    this._curStreamIdx = this._curStream.orderedIdx;
    this._runsCount = 0;
    this.doRun();
  }

  finish() {
    this._logger.debug(`finish current stream ${this._curStreamIdx}`);
    this.cancel();
    this._onResultCallback(this._curStreamIdx);
  }

  setBuffering(bufferTime) {
    this._minBufferingTime = bufferTime > 1000 ? 600 : bufferTime / 2;
    this._enoughBufferToContinue =
      bufferTime > 1000 ? 1000 : bufferTime * 0.8;
  }

  doRun() {
    let curRendition = this._curStream ? this._curStream.rendition + "p" : "";
    this._logger.debug(
      `doRun: cur rendition: ${curRendition}, idx: ${this._curStreamIdx}, bandwdith: ${this._curBandwidth}`,
    );
    if (this._curBandwidth > 0) {
      let renditions = this._renditionProvider.actualRenditions;
      this._nextStreamIdx = this._curStreamIdx + 1;
      if (this._nextStreamIdx < renditions.length) {
        let actualRate = this.calculateCurStreamMetric("avgRate");
        this._bwCorrector =
          this._curStream.bandwidth > 0
            ? actualRate / this._curStream.bandwidth
            : 1;

        this._logger.debug(
          `doRun bw corrector: ${this._bwCorrector}, bandwidth ${this._curBandwidth}, rate ${actualRate}`,
        );
        let streamToProbe = renditions[this._nextStreamIdx];
        let fullRate = actualRate + streamToProbe.bandwidth * this._bwCorrector;
        let probeTime = 0;
        let curVBufTime =
          1000 * this.calculateCurVideoStreamMetric("avg3secBufLevel"); // 3 sec

        this._logger.debug(
          `doRun probe fullRate ${fullRate}, curVBufTime ${curVBufTime}`,
        );
        if (this._curBandwidth < fullRate) {
          probeTime =
            (this._curBandwidth * (curVBufTime - this._minBufferingTime)) /
            (fullRate - this._curBandwidth);
          probeTime = Math.floor(probeTime + 0.5);
          if (probeTime < 100) probeTime = 100;
        }
        if (0 == probeTime || probeTime > RELIABLE_INTERVAL)
          probeTime = RELIABLE_INTERVAL;
        if (0 === this._runsCount && probeTime > 600) {
          probeTime = 600;
        }
        this._logger.debug(`doRun probe during ${probeTime}`);

        let stream = this._renditionProvider.getStream(streamToProbe.idx);
        this._prober = new Prober(
          stream.stream,
          stream.stream_info.vtimescale,
          probeTime,
          this._metricsManager,
        );
        this._prober.callbacks = {
          onStartProbe: this._startProbeCallback,
          onCancelProbe: this._cancelProbeCallback,
          onInitReceived: this.onInitReceived,
          onProbeFinished: this.onProbeFinished,
        };
        this._running = true;
        this._prober.start();
      } else {
        this._onResultCallback(this._curStreamIdx);
      }
    }
  }

  onProbeFinished = function () {
    this._runsCount++;
    this.calculateCurStreamMetric("stopCustom");
    let totalBandwidth = this.calculateCurStreamMetric("customRangeBandwidth");
    this._logger.debug(`finished probe: cur bandwidth ${totalBandwidth}`);

    let proberMetrics = this._metricsManager.getMetrics(this._prober.id());
    let proberBandwidth = Math.max(
      proberMetrics.avgBandwidth(),
      proberMetrics.latestBandwidth(),
    );
    let proberRate = proberMetrics.avgRate();
    totalBandwidth += proberBandwidth;
    this._logger.debug(
      `finished probe: previous bw ${this._curBandwidth}, current bw ${totalBandwidth}`,
    );
    this._logger.debug(
      `finished probe: prober bw ${proberBandwidth}, prober rate ${proberRate}`,
    );

    let proberPeriod = this._prober.period;
    this.destroyProber();
    this._running = false;
    let curVBufLevel = this.calculateCurVideoStreamMetric("latestBufLevel");
    let isEnoughBuffer = curVBufLevel * 1000 >= this._enoughBufferToContinue;
    let actualRate = this.calculateCurStreamMetric("avgRate");
    let bwCorrector =
      this._curStream.bandwidth > 0
        ? actualRate / this._curStream.bandwidth
        : 1;
    this._logger.debug(
      `finished probe: ${isEnoughBuffer ? "enough buffer" : "NOT ENOUGH BUFFER"}, period: ${proberPeriod}, buf level: ${curVBufLevel * 1000}, min required buf: ${this._enoughBufferToContinue}, bwCorrector: ${bwCorrector}`,
    );
    if (isEnoughBuffer && proberPeriod >= RELIABLE_INTERVAL) {
      this._curBandwidth = totalBandwidth;
      let renditions = this._renditionProvider.actualRenditions;
      for (let i = this._curStreamIdx + 1; i < renditions.length; i++) {
        let expBandwidth = renditions[i].bandwidth * bwCorrector;
        this._logger.debug(
          `finished probe: examine higher rendition ${i}, req bandwidth: ${expBandwidth}, cur bandwidth: ${this._curBandwidth}`,
          renditions[i],
        );
        if (this._curBandwidth < expBandwidth * 1.2) {
          this._logger.debug(
            `finished probe: not enough bandwdith, stop! ${this._curBandwidth} < ${expBandwidth * 1.2}`,
          );
          break;
        }
        this._curStreamIdx++;
      }
      this.doRun();
    } else {
      if (isEnoughBuffer) {
        if (totalBandwidth < this._curBandwidth) {
          totalBandwidth = totalBandwidth / bwCorrector;
        }
        this._curBandwidth = Math.max(totalBandwidth, this._curBandwidth);
        this._logger.debug(
          `finished probe: recalculate bw ${this._curBandwidth}, run again`,
        );
        this.doRun();
      } else {
        this._logger.debug(
          `finished probe: return result ${this._renditionProvider.getRenditionName(this._curStreamIdx)}`,
          this._curStreamIdx,
        );
        this._onResultCallback(this._curStreamIdx);
      }
    }
  }.bind(this);

  calculateCurVideoStreamMetric(metr) {
    return this._metricsManager.getMetrics(this._curStream.vid)[metr]();
  }

  calculateCurStreamMetric(metr) {
    let videoMetrics = this._metricsManager.getMetrics(this._curStream.vid);
    let result = videoMetrics[metr]();
    if (result < 0 || !(result >= 0)) result = 0;
    if (undefined !== this._curStream.aid) {
      let audioMetrics = this._metricsManager.getMetrics(this._curStream.aid);
      let aRes = audioMetrics[metr]();
      if (aRes > 0) result += aRes;
    }
    return result;
  }

  calculateProbeStreamMetric(metr) {
    let result = 0;
    if (undefined !== this._prober) {
      let pMetrics = this._metricsManager.getMetrics(this._prober.id());
      result = pMetrics[metr]();
    }
    return result;
  }

  findRelevantStream(curBandwidth, curRate) {
    let result = 0;
    let bwCorrector =
      this._curStream.bandwidth > 0 ? curRate / this._curStream.bandwidth : 1;
    for (let i = this._curStream.orderedIdx - 1; i >= 0; i--) {
      if (this._renditionProvider.isRenditionActual(i)) {
        if (
          curBandwidth >=
          1.1 * this._renditionProvider.getRendition(i).bandwidth * bwCorrector
        ) {
          result = i;
          break;
        }
      }
    }
    this._logger.debug(
      `findRelevantStream: found index ${this._curStream.orderedIdx}`,
    );
    return result;
  }

  getProber() {
    return this._prober;
  }

  isRunning() {
    return this._running;
  }

  onInitReceived = function () {
    this.calculateCurStreamMetric("startCustom");
  }.bind(this);

  set callbacks(cbs) {
    this._startProbeCallback = cbs.onStartProbe;
    this._cancelProbeCallback = cbs.onCancelProbe;
    this._onResultCallback = cbs.onResult;
  }
}
