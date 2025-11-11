import { LoggersFactory } from "@/shared/logger";

export class TimestampManager {
  constructor(instName, opts = {}) {
    this._isVideo = type === "video";
    this._logger = LoggersFactory.create(instName, "TimestampManager");

    this._dropZeroDurationFrames = !!opts.dropZeroDurationFrames;
    this._adjustZeroDistDts = !!opts.adjustZeroDistDts;
    this.reset();
  }

  reset() {
    this._dtsDistCompensation = 0;
    this._lastChunkDuration = 0;
    this._lastChunk = null;
  }

  validateChunk(data) {
    let dts = data.pts - data.offset;
    if (!this._lastChunk) {
      this._setLastChunk(dts, dts, data.offset);
      return true;
    }

    let curChunk = this._lastChunk;
    let dtsDiff = dts - curChunk.rawDts;
    if (this._isVideo) {
      if (dtsDiff === 0) {
        if (curChunk.offset === data.offset - this._dtsDistCompensation) {
          // same DTS and same offset
          if (this._dropZeroDurationFrames) {
            this._logger.debug(
              `Drop zero duration frame ts = ${dts}, offset = ${data.offset}`
            );
            return false;
          }

          // TODO: how to handle this properly?
        }
        
        if (this._adjustZeroDistDts) {
          // same DTS but different offset, adjust DTS but keep PTS
          if (data.offset > this._dtsDistCompensation) {
            this._dtsDistCompensation += 1;
            dtsDiff = 1;
            data.offset -= this._dtsDistCompensation;
            Logger.debug(
              `Fix zero distance DTS. Total DTS compensation = ${this._dtsDistCompensation}. Offset = ${data.offset}`
            );
          } else {
            dtsDiff = this._revertDtsDistCompensation();
          }
        }
      } else if (this._dtsDistCompensation > 0 && dtsDiff > 0) {
        // DTS compensation has been already applied to previous frames' DTS, so now
        // it should be subtracted from current dtsDiff
        let repay = Math.min(this._dtsDistCompensation, dtsDiff - 1);
        dtsDiff -= repay;
        this._dtsDistCompensation -= repay;
        Logger.debug(
          `Complete DTS compensation (${this._dtsDistCompensation}). Ts = ${dts}, offset = ${data.offset}, dtsDiff = ${dtsDiff}`, repay
        );

        if (this._dtsDistCompensation > 0) {
          // can't compensate the rest of the DTS distance
          dtsDiff += this._revertDtsDistCompensation();
        }
      }
    }

    if( this._hasDiscontinuity(dtsDiff) ) {
      // Logger.debug(`Incorrect DTS difference (${dtsDiff}) between previous (ts: ${curChunk.rawDts}, offset: ${curChunk.offset}, sap: ${curChunk.sap}) and current frame (ts: ${ts}, offset: ${offset}, sap: ${isSAP})`);
      dtsDiff = this._lastChunkDuration;
      this._dtsDistCompensation = 0;
    }

    let rawDts = dts;
    dts = curChunk.dts + dtsDiff;
    if(
      dtsDiff > 0 && this._dtsDistCompensation === 0 ||
      dtsDiff > 1
    ) {
      this._lastChunkDuration = dtsDiff;
    }
    data.pts = dts + data.offset;

    this._setLastChunk(dts, rawDts, data.offset);
    return res;
  }

  _revertDtsDistCompensation () {
    // Can't compensate DTS distance by offset, so the only way left is to treat 
    // it as discontinuity. We already introduced ts shift by the compensation,
    // so we should replace it with a multiple of regular dts distance.
    let frameCnt = Math.floor(this._dtsDistCompensation / this._lastChunkDuration) + 1;
    let result = frameCnt * this._lastChunkDuration - this._dtsDistCompensation;
    this._dtsDistCompensation = 0;

    Logger.debug(
      `Rollback DTS distance compensation. Frame count = ${frameCnt}, result = ${result}`,
      this._dtsDistCompensation, lastDtsDist
    );

    return result;
  }

  _hasDiscontinuity(tsDiff) {
    return (tsDiff < 0) || (tsDiff > 10_000_000);
  }

  _setLastChunk(dts, rawDts, offset) {
    this._lastChunk = { dts, rawDts, offset };
  }
}
