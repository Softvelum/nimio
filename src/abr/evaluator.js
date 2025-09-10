const RELIABLE_INTERVAL = 3000;

export class AbrEvaluator {
  constructor(instanceName, renditionProvider, bufferingTime) {
    this.running = false;
    this.nextProberId = 0;
    this.runsCount = 0;

    this.metricsManager = metricsManager;

    this.renditionProvider = renditionProvider;

    this.setBuffering(bufferingTime);
  }

  init(curStream) {
    this.curStream = curStream;
  }

  clear() {
    this._logger.debug("clear");
    this.cancel();
    this.curStream = undefined;
  }

  cancel() {
    if (this.running) {
      this._logger.debug("cancel");
      this.running = false;
      this.prober.stop();
    }
    this.destroyProber();
  }

  destroyProber() {
    if (this.prober) {
      this.prober.destroy();
      this.prober = undefined;
    }
  }

  run() {
    this.curBandwidth = this.calculateCurStreamMetric("avgBandwidth");
    this.curStreamIdx = this.curStream.orderedIdx;
    this.runsCount = 0;
    this.doRun();
  }

  finish() {
    this._logger.debug(`finish current stream ${this.curStreamIdx}`);
    this.cancel();
    this.onResultCallback(this.curStreamIdx);
  }

  setBuffering(bufferingTime) {
    this.bufferingTime = bufferingTime;
    this.minBufferingTime = bufferingTime > 1000 ? 600 : bufferingTime / 2;
    this.enoughBufferToContinue =
      bufferingTime > 1000 ? 1000 : bufferingTime * 0.8;
  }

  doRun() {
    let curRendition = this.curStream ? this.curStream.rendition + "p" : "";
    this._logger.debug(
      `doRun: cur rendition: ${curRendition}, idx: ${this.curStreamIdx}, bandwdith: ${this.curBandwidth}`,
    );
    if (this.curBandwidth > 0) {
      let renditions = this.renditionProvider.getActualRenditions();
      this.nextStreamIdx = this.curStreamIdx + 1;
      if (this.nextStreamIdx < renditions.length) {
        let actualRate = this.calculateCurStreamMetric("avgRate");
        this.bwCorrector =
          this.curStream.bandwidth > 0
            ? actualRate / this.curStream.bandwidth
            : 1;

        this._logger.debug(
          `doRun bw corrector: ${this.bwCorrector}, bandwidth ${this.curBandwidth}, rate ${actualRate}`,
        );
        let streamToProbe = renditions[this.nextStreamIdx];
        let fullRate = actualRate + streamToProbe.bandwidth * this.bwCorrector;
        let probeTime = 0;
        let curVBufTime =
          1000 * this.calculateCurVideoStreamMetric("avg3secBufLevel"); // 3 sec

        this._logger.debug(
          `doRun probe fullRate ${fullRate}, curVBufTime ${curVBufTime}`,
        );
        if (this.curBandwidth < fullRate) {
          probeTime =
            (this.curBandwidth * (curVBufTime - this.minBufferingTime)) /
            (fullRate - this.curBandwidth);
          probeTime = Math.floor(probeTime + 0.5);
          if (probeTime < 100) probeTime = 100;
        }
        if (0 == probeTime || probeTime > RELIABLE_INTERVAL)
          probeTime = RELIABLE_INTERVAL;
        if (0 === this.runsCount && probeTime > 600) {
          probeTime = 600;
        }
        this._logger.debug(`doRun probe during ${probeTime}`);

        let stream = this.renditionProvider.getStream(streamToProbe.idx);
        this.prober = ProbersMan.create(
          this.nextProberId++,
          stream.stream,
          stream.stream_info.vtimescale,
          probeTime,
          this.metricsManager,
        );
        this.prober.callbacks = {
          onStartProbe: this.startProbeCallback,
          onCancelProbe: this.cancelProbeCallback,
          onInitReceived: this.onInitReceived,
          onProbeFinished: this.onProbeFinished,
        };
        this.running = true;
        this.prober.start();
      } else {
        this.onResultCallback(this.curStreamIdx);
      }
    }
  }

  onProbeFinished = function () {
    this.runsCount++;
    this.calculateCurStreamMetric("stopCustom");
    let totalBandwidth = this.calculateCurStreamMetric("customRangeBandwidth");
    this._logger.debug(`finished probe: cur bandwidth ${totalBandwidth}`);

    let proberMetrics = this.metricsManager.getMetrics(this.prober.id());
    let proberBandwidth = Math.max(
      proberMetrics.avgBandwidth(),
      proberMetrics.latestBandwidth(),
    );
    let proberRate = proberMetrics.avgRate();
    totalBandwidth += proberBandwidth;
    this._logger.debug(
      `finished probe: previous bw ${this.curBandwidth}, current bw ${totalBandwidth}`,
    );
    this._logger.debug(
      `finished probe: prober bw ${proberBandwidth}, prober rate ${proberRate}`,
    );

    let proberPeriod = this.prober.period;
    this.destroyProber();
    this.running = false;
    let curVBufLevel = this.calculateCurVideoStreamMetric("latestBufLevel");
    let isEnoughBuffer = curVBufLevel * 1000 >= this.enoughBufferToContinue;
    let actualRate = this.calculateCurStreamMetric("avgRate");
    let bwCorrector =
      this.curStream.bandwidth > 0 ? actualRate / this.curStream.bandwidth : 1;
    this._logger.debug(
      `finished probe: ${isEnoughBuffer ? "enough buffer" : "NOT ENOUGH BUFFER"}, period: ${proberPeriod}, buf level: ${curVBufLevel * 1000}, min required buf: ${this.enoughBufferToContinue}, bwCorrector: ${bwCorrector}`,
    );
    if (isEnoughBuffer && proberPeriod >= RELIABLE_INTERVAL) {
      this.curBandwidth = totalBandwidth;
      let renditions = this.renditionProvider.getActualRenditions();
      for (let i = this.curStreamIdx + 1; i < renditions.length; i++) {
        let expBandwidth = renditions[i].bandwidth * bwCorrector;
        this._logger.debug(
          `finished probe: examine higher rendition ${i}, req bandwidth: ${expBandwidth}, cur bandwidth: ${this.curBandwidth}`,
          renditions[i],
        );
        if (this.curBandwidth < expBandwidth * 1.2) {
          this._logger.debug(
            `finished probe: not enough bandwdith, stop! ${this.curBandwidth} < ${expBandwidth * 1.2}`,
          );
          break;
        }
        this.curStreamIdx++;
      }
      this.doRun();
    } else {
      if (isEnoughBuffer) {
        if (totalBandwidth < this.curBandwidth) {
          totalBandwidth = totalBandwidth / bwCorrector;
        }
        this.curBandwidth = Math.max(totalBandwidth, this.curBandwidth);
        this._logger.debug(
          `finished probe: recalculate bw ${this.curBandwidth}, run again`,
        );
        this.doRun();
      } else {
        this._logger.debug(
          `finished probe: return result ${this.renditionProvider.getRenditionName(this.curStreamIdx)}`,
          this.curStreamIdx,
        );
        this.onResultCallback(this.curStreamIdx);
      }
    }
  }.bind(this);

  calculateCurVideoStreamMetric(metr) {
    return this.metricsManager.getMetrics(this.curStream.vid)[metr]();
  }

  calculateCurStreamMetric(metr) {
    let videoMetrics = this.metricsManager.getMetrics(this.curStream.vid);
    let result = videoMetrics[metr]();
    if (result < 0 || !(result >= 0)) result = 0;
    if (undefined !== this.curStream.aid) {
      let audioMetrics = this.metricsManager.getMetrics(this.curStream.aid);
      let aRes = audioMetrics[metr]();
      if (aRes > 0) result += aRes;
    }
    return result;
  }

  calculateProbeStreamMetric(metr) {
    let result = 0;
    if (undefined !== this.prober) {
      let pMetrics = this.metricsManager.getMetrics(this.prober.id());
      result = pMetrics[metr]();
    }
    return result;
  }

  findRelevantStream(curBandwidth, curRate) {
    let result = 0;
    let bwCorrector =
      this.curStream.bandwidth > 0 ? curRate / this.curStream.bandwidth : 1;
    for (let i = this.curStream.orderedIdx - 1; i >= 0; i--) {
      if (this.renditionProvider.isRenditionActual(i)) {
        if (
          curBandwidth >=
          1.1 * this.renditionProvider.getRendition(i).bandwidth * bwCorrector
        ) {
          result = i;
          break;
        }
      }
    }
    this._logger.debug(
      `findRelevantStream: found index ${this.curStream.orderedIdx}`,
    );
    return result;
  }

  getProber() {
    return this.prober;
  }

  isRunning() {
    return this.running;
  }

  onInitReceived = function () {
    this.calculateCurStreamMetric("startCustom");
  }.bind(this);

  set callbacks(cbs) {
    this.startProbeCallback = cbs.onStartProbe;
    this.cancelProbeCallback = cbs.onCancelProbe;
    this.onResultCallback = cbs.onResult;
  }
}
