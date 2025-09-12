import { AbrEvaluator } from "./evaluator";
import { AbrRenditionProvider } from "./rendition-provider";
import LoggersFactory from "@/shared/logger";

export class AbrController {
  constructor(instanceName, bufferingTime) {
    this._trials = {};
    this._maxPhases = 3;
    this._trialsActive = false;
    this._logger = LoggersFactory.create(instanceName, "ABR controller");
    this._evaluator = new AbrEvaluator(instanceName, bufferingTime);

    this._renditionProvider = AbrRenditionProvider.getInstance(instanceName);
    this._setBufferingTime(bufferingTime);
  }

  start() {
    this._curStream = this._getCurStreamCallback();

    if (this._curStream && this._renditionProvider.getStreamsCount() > 1) {
      this._logger.debug("start");
      this._initTrials();
      this._phaseCount = 0;
      this._trials[this._curStream.orderedIdx].timer = setTimeout(
        this._trialComplete,
        60000,
      );

      this._clearEvalTimer();
      this._clearWatchTimer();
      this._clearRestartTimer();
      this.evalTimer = setInterval(this._evalHandler, 1000);
      this.watchTimer = setInterval(this._watchDog, 100);

      this._evaluator.init(this._curStream);
      this._evaluator.callbacks = {
        onStartProbe: this._probeStartCallback,
        onCancelProbe: this._probeCancelCallback,
        onResult: this._onEvaluatorResult,
      };
    }
  }

  restart(delayed) {
    if (delayed) {
      this._clearEvalTimer();
      this._clearWatchTimer();
      let ctrl = this;
      this._restartTimer = setTimeout(function () {
        ctrl._restartTimer = undefined;
        ctrl.start();
      }, 5000);
    } else {
      this.start();
    }
  }

  playbackStalled(curBufLevel, lowBufferCount) {
    if (lowBufferCount > 0) {
      this._logger.debug(
        `Low buffer count: ${lowBufferCount}, current buffer level: ${curBufLevel}`,
      );
    }
    return lowBufferCount >= 10 || curBufLevel <= 0.1;
  }

  scheduleInstantEvaluation() {
    this._clearEvalTimer();
    this._clearWatchTimer();
    this._evalHandler();
    this.evalTimer = setInterval(this._evalHandler, 1000);
    this.watchTimer = setInterval(this._watchDog, 100);
  }

  setBuffering(bufferingTime) {
    this._evaluator.setBuffering(bufferingTime);
    this._setBufferingTime(bufferingTime);
  }

  _setBufferingTime(bufferingTime) {
    this.stepDownBufferLevel =
      bufferingTime > 700
        ? (0.5 * bufferingTime) / 1000
        : (0.6 * bufferingTime) / 1000;
    this.safeRunBufferLevel =
      bufferingTime > 700
        ? (0.65 * bufferingTime) / 1000
        : (0.75 * bufferingTime) / 1000;
  }

  _increasePhases() {
    if (this._maxPhases < 30) {
      this._maxPhases++;
      this._logger.debug("Increase maxPhases", this._maxPhases);
    }
  }

  _watchDog = function () {
    if (this._evaluator.isRunning()) {
      let curBufLevel =
        this._evaluator.calculateCurVideoStreamMetric("latestBufLevel");
      if (curBufLevel < this.stepDownBufferLevel) {
        this._logger.debug(
          `watchDog interrupts abr evaluator because current buffer level ${curBufLevel} < ${this.stepDownBufferLevel}`,
        );
        this._evaluator.finish();
        this._increasePhases();
      }
    }
  }.bind(this);

  _evalHandler = function () {
    if (
      !this._isSwitchInProgressCallback() &&
      !this._isSeekInProgressCallback()
    ) {
      let lowBufferCount = this._evaluator.calculateCurStreamMetric(
        "latestLowBufferCount",
      );
      let curBufLevel =
        this._evaluator.calculateCurVideoStreamMetric("avg3secBufLevel"); // 3 sec
      if (this.playbackStalled(curBufLevel, lowBufferCount)) {
        this._logger.debug(
          "evalHandler: playback stalled! Switch to lowest rendition.",
        );
        this._evaluator.cancel();
        this._switchRendition(0, TRANSITION_MODE.ABRUPT);
        this._increasePhases();
        this._phaseCount = 0;
      } else {
        this._logger.debug(`phase ${this._phaseCount} max ${this._maxPhases}`);
        if (this._phaseCount >= 3) {
          let curBandwidth =
            this._evaluator.calculateCurStreamMetric("latestBandwidth");
          let curRate = this._evaluator.calculateCurStreamMetric("latestRate");
          curBandwidth +=
            this._evaluator.calculateProbeStreamMetric("latestBandwidth");

          this._logger.debug(
            `eval: current buf: ${curBufLevel}, step down buf: ${this.stepDownBufferLevel}, current bw: ${curBandwidth}, current rate: ${curRate}`,
          );

          if (curBufLevel < this.stepDownBufferLevel) {
            this._evaluator.cancel();
            if (curRate > curBandwidth) {
              let downIdx = this._evaluator.findRelevantStream(
                curBandwidth,
                curRate,
              );
              if (downIdx !== this._curStream.orderedIdx) {
                this._logger.debug(
                  `evalHandler: step down to ${this._renditionProvider.getRenditionName(downIdx)}`,
                );
                this._switchRendition(downIdx);
                this._increasePhases();
                this._phaseCount = 0;
              }
            }
          } else {
            let isSuitable =
              !this._isCurRenditionTop() && !this._evaluator.isRunning();
            if (
              isSuitable &&
              this._phaseCount >= this._maxPhases &&
              curBandwidth > 0 &&
              curBufLevel > this.safeRunBufferLevel &&
              lowBufferCount === 0
            ) {
              this._evaluator.run();
              this._phaseCount = 0;
            } else if (isSuitable) {
              this._logger.debug(
                `ABR evaluator isn't run: phaseCount = ${this._phaseCount}, curBandwidth = ${curBandwidth}, ` +
                  `curLevel = ${curBufLevel}, safeLevel = ${this.safeRunBufferLevel}, lowBufCount = ${lowBufferCount}`,
              );
            }
          }
        }
        if (
          !this._evaluator.isRunning() &&
          this._phaseCount < this._maxPhases
        ) {
          this._phaseCount++;
        }
      }
    }
  }.bind(this);

  _isCurRenditionTop() {
    return this._renditionProvider.isTopAvailable(this._curStream.orderedIdx);
  }

  _initTrials() {
    let success = false;
    let renditions = this._renditionProvider.allRenditions;

    if (this._trialsActive) {
      for (let i = 0; i < renditions.length; i++) {
        if (this._trials[i]) {
          let trialIdx = this._trials[i].idx;
          if (
            trialIdx === renditions[i].idx &&
            this._trials[i].stream ===
              this._renditionProvider.getStream(trialIdx).stream
          ) {
            success = true;
          }
        }
        if (!success) break;
      }
    }

    if (success) {
      return this._resetTrials();
    }

    this._trials = {};
    this._trialsActive = true;
    for (let i = 0; i < renditions.length; i++) {
      this._trials[i] = {
        idx: renditions[i].idx,
        stream: this._renditionProvider.getStream(renditions[i].idx).stream,
        runs: 0,
        required: 1,
        timer: null,
      };
    }
  }

  _trialComplete = function () {
    this._logger.debug(
      `trial complete for ${this._curStream ? this._curStream.rendition : "unknown"}`,
    );
    if (this._curStream) {
      let curTrial = this._trials[this._curStream.orderedIdx];
      curTrial.timer = null;
      if (curTrial.required > 1) curTrial.required--;
    }
  }.bind(this);

  _switchRendition(orderedIdx, mode) {
    if (orderedIdx !== this._curStream.orderedIdx) {
      let goUp = orderedIdx > this._curStream.orderedIdx;
      if (goUp) {
        this._trials[orderedIdx].runs++;
      } else {
        let curTrial = this._trials[this._curStream.orderedIdx];
        if (curTrial.timer) {
          curTrial.required += 2;
          if (curTrial.required > 15) curTrial.required = 15;
          this._clearTrialTimer(this._curStream.orderedIdx);
          this._logger.debug(
            `Increase trial for ${this._curStream.rendition + "p"}, idx ${curTrial.idx} to ${curTrial.required}`,
          );
        }
      }

      if (
        !goUp ||
        this._trials[orderedIdx].runs >= this._trials[orderedIdx].required
      ) {
        this._switchRenditionCallback(
          this._renditionProvider.getRendition(orderedIdx).idx,
          mode,
        );
      }
    }
  }

  stop(params) {
    this._logger.debug("stop!");
    this._curStream = undefined;
    this._phaseCount = 0;
    this._resetTrials();
    if (params && params.hard) {
      this._trials = {};
    }
    this._clearEvalTimer();
    this._clearWatchTimer();
    this._evaluator.clear();
  }

  _onEvaluatorResult = function (streamIdx) {
    this._logger.debug(
      `evaluator result: ${this._renditionProvider.getRenditionName(streamIdx)}, idx: ${streamIdx}, cur stream: ${this._curStream.rendition + "p"}, idx: ${this._curStream.orderedIdx}`,
    );
    if (this._curStream.orderedIdx !== streamIdx) {
      this._switchRendition(streamIdx);
    } else {
      for (let i in this._trials) {
        this._trials[i].runs = 0;
      }
      this._increasePhases();
    }
    this._phaseCount = 0;
  }.bind(this);

  _clearEvalTimer() {
    if (undefined !== this.evalTimer) {
      clearInterval(this.evalTimer);
      this.evalTimer = undefined;
    }
  }

  _clearWatchTimer() {
    if (undefined !== this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = undefined;
    }
  }

  _clearRestartTimer() {
    if (undefined !== this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = undefined;
    }
  }

  _resetTrials() {
    for (let i in this._trials) {
      this._trials[i].runs = 0;
      this._clearTrialTimer(i);
    }
  }

  _clearTrialTimer(idx) {
    if (null !== this._trials[idx].timer) {
      clearTimeout(this._trials[idx].timer);
      this._trials[idx].timer = null;
    }
  }

  isProbing(id) {
    let result = false;
    let prober = this._evaluator.getProber();
    if (prober && prober.id() === id) {
      result = prober.isEnabled();
    }
    return result;
  }

  onProbeInitReceived() {
    this._evaluator.getProber().receiveInit();
  }

  onProbeDataReceived(isSAP, bytes, timestamp) {
    this._evaluator.getProber().receiveFrame(isSAP, bytes, timestamp);
  }

  set callbacks(cbs) {
    this._switchRenditionCallback = cbs.switchRendition;
    this._isSwitchInProgressCallback = cbs.isInProgress;
    this._isSeekInProgressCallback = cbs.isSeeking;
    this._getCurStreamCallback = cbs.getCurStream;
    this._probeStartCallback = cbs.probeStream;
    this._probeCancelCallback = cbs.cancelStream;
  }
}
