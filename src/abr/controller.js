import AbrEvaluator from "./evaluator";
import LoggersFactory from "@/shared/logger";

export class AbrController {
  constructor(instanceId, renditionProvider, metricsManager, bufferingTime) {
    this.trials = {};
    this.maxPhases = 3;
    this.trialsActive = false;
    this._logger = LoggersFactory.create(instanceId, "ABR controller");
    this._evaluator = new AbrEvaluator();

    this.renditionProvider = renditionProvider;

    this._setBufferingTime(bufferingTime);
  }

  start() {
    this.curStream = this.getCurStreamCallback();

    if (this.curStream && this.renditionProvider.getStreamsCount() > 1) {
      Logger.debug("start");
      this._initTrials();
      this.phaseCount = 0;
      this.trials[this.curStream.orderedIdx].timer = setTimeout(
        this._trialComplete,
        60000,
      );

      this._clearEvalTimer();
      this._clearWatchTimer();
      this._clearRestartTimer();
      this.evalTimer = setInterval(this._evalHandler, 1000);
      this.watchTimer = setInterval(this._watchDog, 100);

      this._evaluator.init(this.curStream);
      this._evaluator.callbacks = {
        onStartProbe: this.probeStartCallback,
        onCancelProbe: this.probeCancelCallback,
        onResult: this._onLadderResult,
      };
    }
  }

  restart(delayed) {
    if (delayed) {
      this._clearEvalTimer();
      this._clearWatchTimer();
      let ctrl = this;
      this.restartTimer = setTimeout(function () {
        ctrl.restartTimer = undefined;
        ctrl.start();
      }, 5000);
    } else {
      this.start();
    }
  }

  playbackStalled(curBufLevel, lowBufferCount) {
    if (lowBufferCount > 0) {
      Logger.debug(
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
    this.bufferingTime = bufferingTime;
    this.stepDownBufferLevel =
      this.bufferingTime > 700
        ? (0.5 * this.bufferingTime) / 1000
        : (0.6 * this.bufferingTime) / 1000;
    this.safeRunBufferLevel =
      this.bufferingTime > 700
        ? (0.65 * this.bufferingTime) / 1000
        : (0.75 * this.bufferingTime) / 1000;
  }

  _increasePhases() {
    if (this.maxPhases < 30) {
      this.maxPhases++;
      Logger.debug("Increase maxPhases", this.maxPhases);
    }
  }

  _watchDog = function () {
    if (this._evaluator.isRunning()) {
      let curBufLevel =
        this._evaluator.calculateCurVideoStreamMetric("latestBufLevel");
      if (curBufLevel < this.stepDownBufferLevel) {
        Logger.debug(
          "_watchDog interrupts abr ladder because current buffer level " +
            curBufLevel +
            " < " +
            this.stepDownBufferLevel,
        );
        this._evaluator.finish();
        this._increasePhases();
      }
    }
  }.bind(this);

  _evalHandler = function () {
    if (
      !this.isSwitchInProgressCallback() &&
      !this.isSeekInProgressCallback()
    ) {
      let lowBufferCount = this._evaluator.calculateCurStreamMetric(
        "latestLowBufferCount",
      );
      let curBufLevel =
        this._evaluator.calculateCurVideoStreamMetric("avg3secBufLevel"); // 3 sec
      if (this.playbackStalled(curBufLevel, lowBufferCount)) {
        Logger.debug(
          "evalHandler: playback stalled! Switch to lowest rendition.",
        );
        this._evaluator.cancel();
        this._switchRendition(0, TRANSITION_MODE.ABRUPT);
        this._increasePhases();
        this.phaseCount = 0;
      } else {
        Logger.debug(`phase ${this.phaseCount} max ${this.maxPhases}`);
        if (this.phaseCount >= 3) {
          let curBandwidth =
            this._evaluator.calculateCurStreamMetric("latestBandwidth");
          let curRate = this._evaluator.calculateCurStreamMetric("latestRate");
          curBandwidth +=
            this._evaluator.calculateProbeStreamMetric("latestBandwidth");

          Logger.debug(
            `eval: current buf: ${curBufLevel}, step down buf: ${this.stepDownBufferLevel}, current bw: ${curBandwidth}, current rate: ${curRate}`,
          );
          if (curBufLevel < this.stepDownBufferLevel) {
            this._evaluator.cancel();
            if (curRate > curBandwidth) {
              let downIdx = this._evaluator.findRelevantStream(
                curBandwidth,
                curRate,
              );
              if (downIdx !== this.curStream.orderedIdx) {
                Logger.debug(
                  `evalHandler: step down to ${this.renditionProvider.getRenditionName(downIdx)}`,
                );
                this._switchRendition(downIdx);
                this._increasePhases();
                this.phaseCount = 0;
              }
            }
          } else {
            let isSuitable =
              !this._isCurRenditionTop() && !this._evaluator.isRunning();
            if (
              isSuitable &&
              this.phaseCount >= this.maxPhases &&
              curBandwidth > 0 &&
              curBufLevel > this.safeRunBufferLevel &&
              0 == lowBufferCount
            ) {
              this._evaluator.run();
              this.phaseCount = 0;
            } else if (isSuitable) {
              Logger.debug(
                `ABR ladder isn't run: phaseCount = ${this.phaseCount}, curBandwidth = ${curBandwidth}, ` +
                  `curLevel = ${curBufLevel}, safeLevel = ${this.safeRunBufferLevel}, lowBufCount = ${lowBufferCount}`,
              );
            }
          }
        }
        if (!this._evaluator.isRunning() && this.phaseCount < this.maxPhases) {
          this.phaseCount++;
        }
      }
    }
  }.bind(this);

  _isCurRenditionTop() {
    return this.renditionProvider.isTopAvailable(this.curStream.orderedIdx);
  }

  _initTrials() {
    let success = false;
    let renditions = this.renditionProvider.getAllRenditions();

    if (this.trialsActive) {
      for (let i = 0; i < renditions.length; i++) {
        if (this.trials[i]) {
          let trialIdx = this.trials[i].idx;
          if (
            trialIdx === renditions[i].idx &&
            this.trials[i].stream ===
              this.renditionProvider.getStream(trialIdx).stream
          ) {
            success = true;
          }
        }
        if (!success) break;
      }
    }

    if (success) {
      this._resetTrials();
    } else {
      this.trials = {};
      this.trialsActive = true;
      for (let i = 0; i < renditions.length; i++) {
        this.trials[i] = {
          idx: renditions[i].idx,
          stream: this.renditionProvider.getStream(renditions[i].idx).stream,
          runs: 0,
          required: 1,
          timer: null,
        };
      }
    }
  }

  _trialComplete = function () {
    Logger.debug(
      `trial complete for ${this.curStream ? this.curStream.rendition : "unknown"}`,
    );
    if (this.curStream) {
      let curTrial = this.trials[this.curStream.orderedIdx];
      curTrial.timer = null;
      if (curTrial.required > 1) curTrial.required--;
    }
  }.bind(this);

  _switchRendition(orderedIdx, mode) {
    if (orderedIdx !== this.curStream.orderedIdx) {
      let goUp = orderedIdx > this.curStream.orderedIdx;
      if (goUp) {
        this.trials[orderedIdx].runs++;
      } else {
        let curTrial = this.trials[this.curStream.orderedIdx];
        if (curTrial.timer) {
          curTrial.required += 2;
          if (curTrial.required > 15) curTrial.required = 15;
          this._clearTrialTimer(this.curStream.orderedIdx);
          Logger.debug(
            `Increase trial for ${this.curStream.rendition + "p"}, idx ${curTrial.idx} to ${curTrial.required}`,
          );
        }
      }

      if (
        !goUp ||
        this.trials[orderedIdx].runs >= this.trials[orderedIdx].required
      ) {
        this.switchRenditionCallback(
          this.renditionProvider.getRendition(orderedIdx).idx,
          mode,
        );
      }
    }
  }

  stop(params) {
    Logger.debug("stop!");
    this.curStream = undefined;
    this.phaseCount = 0;
    this._resetTrials();
    if (params && params.hard) {
      this.trials = {};
    }
    this._clearEvalTimer();
    this._clearWatchTimer();
    this._evaluator.clear();
  }

  _onLadderResult = function (streamIdx) {
    Logger.debug(
      `ladder result: ${this.renditionProvider.getRenditionName(streamIdx)}, idx: ${streamIdx}, cur stream: ${this.curStream.rendition + "p"}, idx: ${this.curStream.orderedIdx}`,
    );
    if (this.curStream.orderedIdx !== streamIdx) {
      this._switchRendition(streamIdx);
    } else {
      for (let i in this.trials) {
        this.trials[i].runs = 0;
      }
      this._increasePhases();
    }
    this.phaseCount = 0;
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
    if (undefined !== this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
  }

  _resetTrials() {
    for (let i in this.trials) {
      this.trials[i].runs = 0;
      this._clearTrialTimer(i);
    }
  }

  _clearTrialTimer(idx) {
    if (null !== this.trials[idx].timer) {
      clearTimeout(this.trials[idx].timer);
      this.trials[idx].timer = null;
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
    this.switchRenditionCallback = cbs.switchRendition;
    this.isSwitchInProgressCallback = cbs.isInProgress;
    this.isSeekInProgressCallback = cbs.isSeeking;
    this.getCurStreamCallback = cbs.getCurStream;
    this.probeStartCallback = cbs.probeStream;
    this.probeCancelCallback = cbs.cancelStream;
  }
}
