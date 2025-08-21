export const NimioApi = {

  getRenditions() {
    if (!this._context) return [];
    return this._context.videoRenditions.map((r) => ({
      index: r.idx,
      width: r.width,
      height: r.height,
      rendition: r.rendition,
    }));
  },

  setVideoRendition(rIdx) {
    if (!this._context) return false;
    if (this._context.isCurrentVideoStream(rIdx)) {
      return true;
    }

    let stream = this._context.streams[rIdx];
    if (!stream || !stream.stream_info || !stream.stream_info.vcodecSupported) {
      this._logger.error(
        `Video rendition with index ${rIdx} is not found or not supported`
      );
      return false;
    }
    if (this._nextRenditionData) {
      this._logger.warn(
        `Can't switch to rendition ${rIdx} while a switch to ${this._nextRenditionData.idx} is in progress`
      );
      return false;
    }

    this._nextRenditionData = {
      idx: rIdx,
      trackId: this._sldpManager.requestStream("video", rIdx),
    };

    return true;
  },

};
