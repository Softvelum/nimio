import { currentTimeGetterMs } from "@/shared/helpers";
import { retrieveClockOffset } from "@/sync-mode/clock";

export class SyncModePolicy {
  constructor(bufferMs, port, logger) {
    this._bufferMs = bufferMs;
    this._port = port;
    this._logger = logger;

    this._getCurTimeMs = currentTimeGetterMs();
    this._clockOffsetMs = 0;
    if (port) {
      retrieveClockOffset(port, this._getCurTimeMs, (offset) => {
        this._clockOffsetMs = offset;
      });
    }
  }

  reset() {
    if (this._port) {
      this._retrieveParams();
    }
  }

  computeAdjustment(curTimeMs, availableMs) {
    var now = this._getCurTimeMs();
    // perform zapping no more than once every 4 seconds
    if( now - _syncParams.lastZapTime > _syncParams.PERIOD ) {
      var expPosMs = this._getSyncModeCurPos();
      if( expPosMs > curTimeMs ) {
        var minRest = Math.min(this._params.syncBuffer - 50, 500); // 500 msec seems minimum possible buffer size for MSE to keep playing
        var availPos = curTimeMs + availableMs - minRest;
        // this._logger.debug(`_syncPlayback availPos = ${availPos}, curTimeMs = ${curTimeMs}`);
        if( availPos <= curTimeMs ) {
          expPosMs = curTimeMs;
        } else if( availPos < expPosMs ) {
          expPosMs = availPos;
        }
      }
      var dist = expPosMs - curTimeMs;
      var absDist = Math.abs(dist);
      var shouldSync = false;

      // this._logger.debug('syncPlayback absDist', absDist);
      if( absDist > 0.1 ) {
        shouldSync = true;
      } else if( absDist > _syncParams.SYNC_BORDER ) {
        _syncParams.integralDist += dist;
        this._logger.debug('Integral distance for zapping', _syncParams.integralDist, absDist);
        if( undefined === _syncParams.start ) {
          _syncParams.start = now;
        }
        if( now - _syncParams.start > 15000 ) {
          _syncParams.start = now;
          _syncParams.integralDist = dist;
        } else if( (Math.abs(_syncParams.integralDist ) >= 4) && (absDist >= 0.02) ) {
          shouldSync = true;
          this._logger.debug('zapping by integral decision', _syncParams.integralDist);
        }
      }

      if( shouldSync ) {
        _syncParams.integralDist = 0;
        _syncParams.start = undefined;

        if( absDist > 3 ) {
          // seek
        } else {
          _syncParams.lastZapTime = now;
          _zap(dist);
        }
      }
    }
  }

  set ptsOffset(val) {
    this._ptsOffsetMs = val;
  }

  _getSyncModeCurPos() {
    const nowMs = this._getCurTimeMs() + this._clockOffsetMs;
    let expPosMs = nowMs - this._ptsOffsetMs - this._bufferMs;
    this._logger.debug(
      `Diff = ${this._curTsUs / 1000 - expPosMs}, exp pos = ${expPosMs}, cur ts = ${this._curTsUs}`
    );
    return expPosMs;
  }

  _retrieveParams() {
    if (this._smParamsHandler) return;

    this._ptsOffsetMs = 0;
    this._smParamsHandler = (e) => {
      const msg = e.data;
      if (!msg || msg.aux) return;
      if (msg.type === "sync-mode-params") {
        this._logger.debug(`Set sync mode pts offset = ${msg.ptsOffsetMs}`);
        this._ptsOffsetMs = msg.ptsOffsetMs;
        this._port.removeEventListener("message", this._smParamsHandler);
        this._smParamsHandler = undefined;
      }
    };
    this._port.addEventListener("message", this._smParamsHandler);
  }
}
