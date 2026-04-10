export const NimioExtAPI = {
  startAbr() {
    this._actPlayer.startAbr();
  },

  stopAbr() {
    this._actPlayer.stopAbr();
  },

  isAbr() {
    return this._actPlayer.isAbr();
  },

  getRenditions(type) {
    return this._actPlayer.getRenditions(type);
  },

  getCurrentRendition(type) {
    return this._actPlayer.getCurrentRendition(type);
  },

  setVideoRendition(id) {
    return this.setCurrentRendition("video", id);
  },

  setAudioRendition(id) {
    return this.setCurrentRendition("audio", id);
  },

  setCurrentRendition(type, id) {
    if (!this._context) return false;
    if (!this._checkRenditionType(type)) return false;

    return this._actPlayer.setCurrentRendition(type, id);
  },

  getCaptionTracks() {
    return this._actPlayer.getCaptionTracks();
  },

  getCurrentCaptionTrack() {
    return this._actPlayer.getCurrentCaptionTrack();
  },

  setCaptionTrack(name) {
    return this._actPlayer.setCaptionTrack(name);
  },
};
