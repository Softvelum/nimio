import { multiInstanceService } from "@/shared/service";
import { LoggersFactory } from "@/shared/logger";
import { EventBus } from "@/event-bus";

const DISCONT_THRESH_US = 10_000_000;

class TimestampManager {
  constructor(instName) {
    this._instName = instName;
    this._tsValidators = new Map();
    this._eventBus = EventBus.getInstance(instName);
    this._logger = LoggersFactory.create(instName, "TimestampManager");
  }

  init(settings) {
    this._settings = settings;
  }

  addTrack(id, type) {
    let tv = new TimestampValidator(this._instName, id, type, this._settings);
    this._tsValidators.set(id, tv);
  }

  rebaseTrack(id) {
    let tv = this._tsValidators.get(id);
    if (!tv) return false;
    this._logger.debug(`Rebase track ${id}`);
    if (tv.timeBase) {
      if (!this._baseSwitch) this._baseSwitch = { ids: {}, cnt: 0, rcnt: 0 };
      if (this._baseSwitch.ids[id] === 0) {
        this._baseSwitch.tb = undefined;
      }
      this._baseSwitch.ids[id] = 1;
      this._baseSwitch.rcnt++;
      this._baseSwitch.cnt++;
    }
  }

  validateChunk(id, chunk) {
    let tv = this._tsValidators.get(id);
    if (!tv) return false;

    // check if new init segment arrived (advertizer)
    this._checkBaseSwitch(tv, id, chunk);
    return tv.validateChunk(chunk);
  }

  updateTimeBase(targetId, sourceId) {
    let srcValidator = this._tsValidators.get(sourceId);
    let tgtValidator = this._tsValidators.get(targetId);
    if (srcValidator && tgtValidator) {
      tgtValidator.timeBase = srcValidator.timeBase;
    }
  }

  removeTrack(id) {
    this._tsValidators.delete(id);
  }

  _checkBaseSwitch(tv, id, chunk) {
    if (!this._baseSwitch || this._baseSwitch.ids[id] !== 1) return;

    let tbase = tv.timeBase;

    let chDts = chunk.pts - chunk.offset;
    let dtsDiff = chDts - tbase.rawDts;
    let switchData = {
      trackId: id,
      fromPtsUs: tbase.dts + tbase.offset,
      toPtsUs: tbase.dts + dtsDiff + chunk.offset,
    };
    this._logger.debug(
      `checkBaseSwitch track ${id}, dts diff = ${dtsDiff}, cur chunk pts = ${chunk.pts}, prev chunk dts = ${tbase.dts}, rawDts = ${tbase.rawDts}`
    );

    if (dtsDiff < 0 || dtsDiff > DISCONT_THRESH_US) {
      let newTbase = { rawDts: chDts };
      if (this._baseSwitch.tb === undefined) {
        newTbase.dts = tbase.dts + 3_000_000;
        this._baseSwitch.tb = newTbase;
      } else {
        let bsDtsDiff = chDts - this._baseSwitch.tb.rawDts;
        newTbase.dts = this._baseSwitch.tb.dts + bsDtsDiff;
      }
      this._logger.debug(
        `Apply base switch time for ${id}, new time base: dts = ${newTbase.dts}, rawDts = ${newTbase.rawDts}`,
      );
      tv.timeBase = newTbase;
      switchData.toPtsUs = newTbase.dts + chunk.offset;
    }
    this._baseSwitch.ids[id] = 0;
    this._baseSwitch.cnt--;
    if (
      this._baseSwitch.cnt === 0 &&
      this._baseSwitch.rcnt === this._tsValidators.size
    ) {
      this._baseSwitch = undefined;
    }
    this._eventBus.emit("transp:init-switch", switchData);
  }
}

class TimestampValidator {
  constructor(instName, id, type, settings) {
    const name = `TS Validator [${type}][${id}]`;
    this._logger = LoggersFactory.create(instName, name);

    this._isVideo = type === "video";
    this._dropZeroDurationFrames = settings.dropZeroDurationFrames;
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
      if (this._timeBase) {
        // There is a timebase from another validator that may contain
        // ts discontinuity adjustment that is needed to be applied for
        // successful rendition switch
        this._applyTimeBase(data);
      } else {
        this._setLastChunk(dts, dts, data.offset);
      }
      return true;
    }

    let curChunk = this._lastChunk;
    let dtsDiff = dts - curChunk.rawDts;
    if (this._isVideo) {
      if (dtsDiff === 0) {
        const sameOffset =
          curChunk.offset === data.offset - this._dtsDistCompensation;
        if (sameOffset && this._dropZeroDurationFrames) {
          this._logger.debug(
            `Drop zero duration frame ts = ${dts}, offset = ${data.offset}`,
          );
          return false;
        }

        // same DTS but different offset, adjust DTS but keep PTS
        if (!sameOffset && data.offset > this._dtsDistCompensation) {
          // TODO: deside on how to updates the resulting PTS, because requestAnimationFrame
          // fires according to the screen update frequency, which is maximum 120-144Hz
          // for now. So it make sense to update the PTS in the resulting video buffer to make
          // sure all frames can be displayed.
          this._dtsDistCompensation += 1;
          dtsDiff = 1;
          data.offset -= this._dtsDistCompensation;
          this._logger.debug(
            `Fix zero distance DTS. Total DTS compensation = ${this._dtsDistCompensation}. Offset = ${data.offset}`,
          );
        } else {
          dtsDiff = this._revertDtsDistCompensation();
        }
      } else if (this._dtsDistCompensation > 0 && dtsDiff > 0) {
        // DTS compensation has been already applied to previous frames' DTS, so now
        // it should be subtracted from current dtsDiff
        let repay = Math.min(this._dtsDistCompensation, dtsDiff - 1);
        dtsDiff -= repay;
        this._dtsDistCompensation -= repay;
        this._logger.debug(
          `Complete DTS compensation (${this._dtsDistCompensation}). Ts = ${dts}, offset = ${data.offset}, dtsDiff = ${dtsDiff}`,
          repay,
        );

        if (this._dtsDistCompensation > 0) {
          // can't compensate the rest of the DTS distance
          dtsDiff += this._revertDtsDistCompensation();
        }
      }
    }

    if (this._hasDiscontinuity(dtsDiff)) {
      this._logger.debug(
        `Incorrect DTS difference (${dtsDiff}) between previous (ts: ${curChunk.rawDts}, offset: ${curChunk.offset}) and current frame (ts: ${dts}, offset: ${data.offset})`,
      );
      dtsDiff = this._lastChunkDuration;
      this._dtsDistCompensation = 0;
    }

    let rawDts = dts;
    dts = curChunk.dts + dtsDiff;
    if (dtsDiff > 1000) {
      this._lastChunkDuration = dtsDiff; // 1ms at least
    }
    data.pts = dts + data.offset;

    this._setLastChunk(dts, rawDts, data.offset);
    return true;
  }

  set timeBase(tb) {
    this._lastChunk = null;
    this._timeBase = tb;
  }

  get timeBase() {
    if (!this._lastChunk) return null;
    return {
      dts: this._lastChunk.dts,
      rawDts: this._lastChunk.rawDts,
      offset: this._lastChunk.offset,
    };
  }

  _applyTimeBase(chunk) {
    let chDts = chunk.pts - chunk.offset;
    let rawDts = chDts;
    if (Math.abs(chDts - this._timeBase.rawDts) <= DISCONT_THRESH_US) {
      let dtsDiff = this._timeBase.dts - this._timeBase.rawDts;
      if (dtsDiff !== 0) {
        let newDts = chDts + dtsDiff;
        chunk.pts = newDts + chunk.offset;
        this._logger.debug(
          `Apply time base adjustment. DTS diff: ${dtsDiff}. Old DTS: ${chDts}, new DTS: ${newDts}, offset: ${chunk.offset}`,
        );
        chDts = newDts;
      }
    }
    this._setLastChunk(chDts, rawDts, chunk.offset);
    this._timeBase = null;
  }

  _revertDtsDistCompensation() {
    // Can't compensate DTS distance by offset, so the only way left is to treat
    // it as discontinuity. We already introduced ts shift by the compensation,
    // so we should replace it with a multiple of regular dts distance.
    let chunksToRepay = this._dtsDistCompensation / this._lastChunkDuration;
    let frameCnt = Math.floor(chunksToRepay) + 1;
    let result = frameCnt * this._lastChunkDuration - this._dtsDistCompensation;
    this._dtsDistCompensation = 0;

    this._logger.debug(
      `Rollback DTS distance compensation. Frame count = ${frameCnt}, result = ${result}`,
      this._dtsDistCompensation,
      this._lastChunkDuration,
    );

    return result;
  }

  _hasDiscontinuity(tsDiff) {
    return tsDiff < 0 || tsDiff > DISCONT_THRESH_US;
  }

  _setLastChunk(dts, rawDts, offset) {
    this._lastChunk = { dts, rawDts, offset };
  }
}

TimestampManager = multiInstanceService(TimestampManager);
export { TimestampManager };
