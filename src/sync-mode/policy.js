import { currentTimeGetterMs } from "@/shared/helpers";
import { retrieveClockOffset } from "@/sync-mode/clock";

export class SyncModePolicy {
  constructor(bufferMs, port) {
    this._bufferMs = bufferMs;
    this._port = port;

    this._getCurTimeMs = currentTimeGetterMs();
    this._clockOffsetMs = 0;
    if (this._port) {
      retrieveClockOffset(this._port, this._getCurTimeMs, (offset) => {
        this._logger.debug(`Set clock offset = ${offset}ms`);
        this._clockOffsetMs = offset;
      });
    }
    this.reset();

    this._periodMs = 4000;
    this._integralDistPeriodMs = 15000;
    this._syncBorderMs = 40; // check if still necessary _detector.isIOS() ? 52 : 40;
  }

  reset() {
    if (this._port) {
      this._retrieveParams();
    }

    this._integralDistMs = 0;
    this._startMs = undefined;
  }

  computeAdjustment(curTsMs, availableMs) {
    let result = 0;

    let curTimeMs = this._getCurTimeMs();
    let curClockTimeMs = curTimeMs + this._clockOffsetMs;
    let expPosMs = curClockTimeMs - this._ptsOffsetMs - this._bufferMs;
    // this._logger.debug(
    //   `Diff = ${expPosMs - curTsMs}ms, exp pos = ${expPosMs}, cur ts = ${curTsMs}`,
    // );
    if (expPosMs > curTsMs) {
      // 500 msec seems minimum reasonable buffer size to keep playing in sync
      let minRest = Math.min(this._bufferMs - 50, 500);
      let availPos = curTsMs + availableMs - minRest;
      // this._logger.debug(
      //   `computeAdjustment availPos = ${availPos}, curClockTimeMs = ${curClockTimeMs}`
      // );
      if (availPos <= curTsMs) {
        expPosMs = curTsMs;
      } else if (availPos < expPosMs) {
        expPosMs = availPos;
      }
    }
    let distMs = expPosMs - curTsMs;
    let absDistMs = Math.abs(distMs);
    // this._logger.debug(`Sync mode distance = ${distMs}`);

    let goMove = false;
    if (absDistMs > 100) {
      this._integralDistMs = 0;
      goMove = true;
    } else if (distMs < 0 || distMs > this._syncBorderMs) {
      this._integralDistMs += distMs;
      // this._logger.debug(
      //   `Integral sync distance = ${this._integralDistMs}, distance = ${distMs}`,
      // );
      if (undefined === this._startMs) {
        this._startMs = curTimeMs;
      }
      if (curTimeMs - this._startMs > this._integralDistPeriodMs) {
        this._startMs = curTimeMs;
        this._integralDistMs = distMs;
      } else if (Math.abs(this._integralDistMs) >= this._periodMs) {
        goMove = true;
        this._logger.debug(`Sync by integral dist = ${this._integralDistMs}`);
      }
    } else {
      this._integralDistMs = 0;
    }

    if (goMove) {
      this._startMs = undefined;
      result = distMs;
      this._logger.debug(`Do sync, delta = ${distMs}`);
    }

    return result;
  }

  set logger(lgr) {
    this._logger = lgr;
  }

  set ptsOffset(val) {
    this._ptsOffsetMs = val;
  }

  _retrieveParams() {
    if (this._smParamsHandler) return;

    this._ptsOffsetMs = 0;
    this._smParamsHandler = (e) => {
      const msg = e.data;
      if (!msg || msg.aux) return;
      if (msg.type === "sync-mode-params") {
        this._logger.debug(`Set sync mode pts offset = ${msg.ptsOffsetMs}ms`);
        this._ptsOffsetMs = msg.ptsOffsetMs;
        this._port.removeEventListener("message", this._smParamsHandler);
        this._smParamsHandler = undefined;
      }
    };
    this._port.addEventListener("message", this._smParamsHandler);
  }
}
