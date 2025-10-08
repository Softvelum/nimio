import { AbrEvaluator } from "./evaluator";
import { AbrRenditionProvider } from "./rendition-provider";
import { PlaybackContext } from "@/playback/context";
import { LoggersFactory } from "@/shared/logger";

export class AbrController {
  constructor(instanceName, bufferMs) {
    this._trials = {};
    this._maxPhases = 3;
    this._trialsActive = false;
    this._evaluator = new AbrEvaluator(instanceName, bufferMs);
    this._renditionProvider = AbrRenditionProvider.getInstance(instanceName);
    this._context = PlaybackContext.getInstance(instanceName);
    this._logger = LoggersFactory.create(instanceName, "ABR controller");

    this._setBufferingTime(bufferMs);
  }

  start() {
    this._curStream = this._context.getCurrentStreamInfo();
    if (
      this._curStream.vIdx == undefined ||
      this._renditionProvider.streamsCount < 2
    )
      return;

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
    this._evalTimer = setInterval(this._evalHandler, 1000);
    this._watchTimer = setInterval(this._watchDog, 100);

    this._evaluator.init(this._curStream);
    this._evaluator.callbacks = {
      onStartProbe: this._probeStartCallback,
      onCancelProbe: this._probeCancelCallback,
      onResult: this._onEvaluationResult,
    };
  }

  restart(delayed) {
    if (delayed) {
      this._clearEvalTimer();
      this._clearWatchTimer();
      this._restartTimer = setTimeout(() => {
        this._restartTimer = undefined;
        if (this._curStream) {
          // ABR controller hasn't been stopped during the delay
          this.start();
        }
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
    this._evalTimer = setInterval(this._evalHandler, 1000);
    this._watchTimer = setInterval(this._watchDog, 100);
  }

  setBuffering(bufferMs) {
    this._evaluator.setBuffering(bufferMs);
    this._setBufferingTime(bufferMs);
  }

  _setBufferingTime(bufferingTime) {
    this._stepDownBufferLevel =
      bufferingTime > 700
        ? (0.5 * bufferingTime) / 1000
        : (0.6 * bufferingTime) / 1000;
    this._safeRunBufferLevel =
      bufferingTime > 700
        ? (0.65 * bufferingTime) / 1000
        : (0.75 * bufferingTime) / 1000;
  }

  _increasePhases() {
    if (this._maxPhases < 30) {
      this._maxPhases++;
      this._logger.debug(`Increase maxPhases to ${this._maxPhases}`);
    }
  }

  _watchDog = function () {
    if (this._evaluator.isRunning()) {
      let curBufLevel =
        this._evaluator.calculateCurVideoStreamMetric("latestBufLevel");
      if (curBufLevel < this._stepDownBufferLevel) {
        this._logger.debug(
          `watchDog interrupts abr evaluator because current buffer level ${curBufLevel} < ${this._stepDownBufferLevel}`,
        );
        this._evaluator.finish();
        this._increasePhases();
      }
    }
  }.bind(this);

  _evalHandler = function () {
    if (!this._isSwitchInProgressCallback()) {
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
        this._switchRendition(0);
        this._increasePhases();
        this._phaseCount = 0;
      } else {
        this._logger.debug(`phase ${this._phaseCount} max ${this._maxPhases}`);
        if (this._phaseCount >= 3) {
          let curBw =
            this._evaluator.calculateCurStreamMetric("latestBandwidth");
          let curRate = this._evaluator.calculateCurStreamMetric("latestRate");
          curBw +=
            this._evaluator.calculateProbeStreamMetric("latestBandwidth");

          this._logger.debug(
            `eval: current buf: ${curBufLevel}, step down buf: ${this._stepDownBufferLevel}, current bw: ${curBw}, current rate: ${curRate}`,
          );

          if (curBufLevel < this._stepDownBufferLevel) {
            this._evaluator.cancel();
            if (curRate > curBw) {
              let downIdx = this._evaluator.findRelevantStream(curBw, curRate);
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
              curBw > 0 &&
              curBufLevel > this._safeRunBufferLevel &&
              lowBufferCount === 0
            ) {
              this._evaluator.run();
              this._phaseCount = 0;
            } else if (isSuitable) {
              this._logger.debug(
                `ABR evaluator isn't run: phase count = ${this._phaseCount}, current bandwidth = ${curBw}, ` +
                  `cur level = ${curBufLevel}, safe level = ${this._safeRunBufferLevel}, low buf count = ${lowBufferCount}`,
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
      `trial complete for ${this._curStream ? this._curStream.height : "unknown"}`,
    );
    if (this._curStream) {
      let curTrial = this._trials[this._curStream.orderedIdx];
      curTrial.timer = null;
      if (curTrial.required > 1) curTrial.required--;
    }
  }.bind(this);

  _switchRendition(orderedIdx) {
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
            `Increase trial for ${this._curStream.height + "p"}, idx ${curTrial.idx} to ${curTrial.required}`,
          );
        }
      }

      if (
        !goUp ||
        this._trials[orderedIdx].runs >= this._trials[orderedIdx].required
      ) {
        let switchIdx = this._renditionProvider.getRendition(orderedIdx).idx;
        this._switchRenditionCallback(switchIdx + 1);
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

  _onEvaluationResult = function (streamIdx) {
    this._logger.debug(
      `evaluator result: ${this._renditionProvider.getRenditionName(streamIdx)}, idx: ${streamIdx}, cur stream: ${this._curStream.height + "p"}, idx: ${this._curStream.orderedIdx}`,
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
    if (undefined !== this._evalTimer) {
      clearInterval(this._evalTimer);
      this._evalTimer = undefined;
    }
  }

  _clearWatchTimer() {
    if (undefined !== this._watchTimer) {
      clearInterval(this._watchTimer);
      this._watchTimer = undefined;
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
    if (prober?.id === id) {
      result = prober.isEnabled();
    }
    return result;
  }

  handleCodecData() {
    this._evaluator.getProber().receiveInit();
  }

  handleChunkTs(timestamp) {
    this._evaluator.getProber().receiveFrame(timestamp);
  }

  set callbacks(cbs) {
    this._switchRenditionCallback = cbs.switchRendition;
    this._isSwitchInProgressCallback = cbs.isInProgress;
    this._probeStartCallback = cbs.probeStream;
    this._probeCancelCallback = cbs.cancelProbe;
  }
}
