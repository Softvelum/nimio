export const NimioApi = {

  getRenditions(type) {
    if (!this._context) return [];
    if (!type) type = "video";
    if (!this._checkRenditionType(type)) return [];

    let renditions = type === "video" ? this._context.videoRenditions : this._context.audioRenditions;
    return renditions.map((r) => this._renditionParams(type, r));
  },

  setVideoRendition(rIdx) {
    return this.setRendition("video", rIdx);
  },

  setAudioRendition(rIdx) {
    return this.setRendition("audio", rIdx);
  },

  setRendition(type, rIdx) {
    if (!this._context) return false;
    if (!this._checkRenditionType(type)) return false;

    if (this._context.isCurrentStream(type, rIdx)) {
      return true;
    }

    let stream = this._context.streams[rIdx];
    if (!stream || !stream.stream_info || !stream.stream_info[`${type[0]}codecSupported`]) {
      this._logger.error(
        `${type} rendition with index ${rIdx} is not found or not supported`
      );
      return false;
    }
    if (this._nextRenditionData) {
      this._logger.warn(
        `Can't switch to ${type} rendition ${rIdx} while a switch to ${this._nextRenditionData.idx} is in progress`
      );
      return false;
    }

    this._nextRenditionData = {
      idx: rIdx,
      trackId: this._sldpManager.requestStream(type, rIdx),
    };

    return true;
  },

  _checkRenditionType(type) {
    if (type !== "video" && type !== "audio") {
      this._logger.error("Rendition type must be either 'video' or 'audio'");
      return false;
    }
    return true;
  },

  _renditionParams(type, rendition) {
    return type === "video" ? {
      index: rendition.idx,
      width: rendition.width,
      height: rendition.height,
      rendition: rendition.rendition,
      bandwidth: rendition.bandwidth,
      vcodec: rendition.vcodec,
    } : {
      index: rendition.idx,
      bandwidth: rendition.bandwidth,
      acodec: rendition.acodec,
    };
  },

};
