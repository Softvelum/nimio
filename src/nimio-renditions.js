import { MODE } from "./shared/values";

export const NimioRenditions = {
  getRenditions(type) {
    if (!this._context) return [];
    if (type && !this._checkRenditionType(type)) return [];

    // empty type means all renditions
    let renditions = this._context.allRenditions;
    if (type === "video") {
      renditions = this._context.videoRenditions;
    } else if (type === "audio") {
      renditions = this._context.audioRenditions;
    }

    return renditions.map((r) => this._renditionParams(type, r));
  },

  getCurrentRendition(type) {
    if (!this._context) return null;
    if (!type) type = "video";
    if (!this._checkRenditionType(type)) return null;

    let rendition = this._context.getCurrentRendition(type);
    if (!rendition) return null;

    return this._renditionParams(type, rendition);
  },

  setCurrentRendition(type, id) {
    this._logger.debug(`set ${type} rendition ID ${id}`);
    if (!this._isSwitchPossible(type)) return false;

    let rendIdx = id - 1;
    if (this._context.isCurrentStream(type, rendIdx)) {
      this._logger.debug("specified rendition is already the current one");
      return true;
    }

    let stream = this._context.streams[rendIdx];
    if (
      !stream ||
      !stream.stream_info ||
      !stream.stream_info[`${type[0]}codecSupported`]
    ) {
      this._logger.error(
        `${type} rendition with ID ${id} is not found or not supported`,
      );
      return false;
    }
    if (this._nextRenditionData) {
      let nextId = this._nextRenditionData.idx + 1;
      this._logger.warn(
        `Can't switch to ${type} rendition ${id} while a switch to ${nextId} is in progress`,
      );
      return false;
    }

    this._eventBus.emit("nimio:rendition-select", {
      rendition: stream.stream_info.name,
      name: stream.stream,
    });

    this._nextRenditionData = {
      idx: rendIdx,
      trackId: this._sldpManager.requestStream(type, rendIdx),
      rendition: stream.stream_info.name,
      name: stream.stream,
    };

    return true;
  },

  _onRenditionChange(data) {
    if (data.mode !== MODE.LIVE || !data.rend) return;

    if (data.rend.name === "Auto") {
      this._eventBus.emit("nimio:rendition-select", { rendition: "Auto" });
      return this.startAbr();
    }
    this.stopAbr();
    return this.setCurrentRendition("video", data.rend.id);
  },

  _onRenditionSwitchResult(type, done) {
    let nextId = this._nextRenditionData.idx + 1;
    if (done) {
      this._context.setCurrentStream(
        type,
        this._nextRenditionData.idx,
        this._nextRenditionData.trackId,
      );

      if (type === "video" && this._nalProcessor) {
        this._updateNalUnitProcessors(this._decoderFlows["video"].codec);
      }

      this._eventBus.emit("nimio:rendition-set", {
        rendition: this._nextRenditionData.rendition,
        name: this._nextRenditionData.name,
        id: nextId,
      });
    }
    this._nextRenditionData = null;

    if (this._isAutoAbr()) {
      this._abrController.restart(true);
    }
    this._logger.debug(
      `${type} rendition switch to ID ${nextId} ${done ? "completed successfully" : "failed"}`,
    );
  },

  _renditionParams(type, rendition) {
    let res = { id: rendition.idx + 1, bandwidth: rendition.bandwidth };
    if (!type || type === "video") {
      res.width = rendition.width;
      res.height = rendition.height;
      res.rendition = rendition.rendition;
      res.vcodec = rendition.vcodec;
    }
    if (!type || type === "audio") {
      res.acodec = rendition.acodec;
    }
    return res;
  },

  _isSwitchPossible(type) {
    if (
      (type === "video" && this._noVideo) ||
      (type === "audio" && this._noAudio)
    ) {
      this._logger.warn(
        `Can't switch ${type} rendition, ${type} streams are not avaialble or disabled`,
      );
      return false;
    }

    return true;
  },
};
