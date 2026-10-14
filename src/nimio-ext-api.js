// Every method is a safe no-op on a destroyed player (no active engine).
export const NimioExtAPI = {
  startAbr() {
    this._actPlayer?.startAbr();
  },

  stopAbr() {
    this._actPlayer?.stopAbr();
  },

  isAbr() {
    return this._actPlayer ? this._actPlayer.isAbr() : false;
  },

  getRenditions(type) {
    return this._actPlayer ? this._actPlayer.getRenditions(type) : [];
  },

  getCurrentRendition(type) {
    return this._actPlayer ? this._actPlayer.getCurrentRendition(type) : null;
  },

  setVideoRendition(id) {
    return this.setCurrentRendition("video", id);
  },

  setAudioRendition(id) {
    return this.setCurrentRendition("audio", id);
  },

  setCurrentRendition(type, id) {
    if (!this._context || !this._actPlayer) return false;
    if (!this._checkRenditionType(type)) return false;

    return this._actPlayer.setCurrentRendition(type, id);
  },

  getCaptionTracks() {
    return this._actPlayer ? this._actPlayer.getCaptionTracks() : {};
  },

  getCurrentCaptionTrack() {
    return this._actPlayer ? this._actPlayer.getCurrentCaptionTrack() : {};
  },

  setCaptionTrack(name) {
    return this._actPlayer ? this._actPlayer.setCaptionTrack(name) : false;
  },

  getCurrentStreamBandwidth() {
    return this._actPlayer ? this._actPlayer.getCurrentStreamBandwidth() : 0;
  },

  getStreamEncodedFramerate() {
    return this._spsHolder?.sps?.maxFps;
  },

  getVodThumbnailUrl(time) {
    if (this._thumbnailSvc && this._thumbnailSvc.isSetUp()) {
      return this._thumbnailSvc.getUrl(time);
    }
  },

  getCurrentTimestamp() {
    return this._actPlayer ? this._actPlayer.getCurrentTimestamp() : 0;
  },
};
