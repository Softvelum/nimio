export class PlaybackProgressProxy {
  constructor(eventBus, playbackIface) {
    this._eventBus = eventBus;
    this._playbackIface = playbackIface;
    this._playbackIface.setExtProgressNotifier(this);
  }

  vodProgress(position, duration) {
    this._eventBus.emit("nimio:vod-progress", { position, duration });
  }

  liveProgress(position, buffer) {
    this._eventBus.emit("nimio:live-progress", { buffer });
  }

  seekVod(position) {
    return this._playbackIface.updateVodPosition(position);
  }

  seekLive(buffer) {
    return this._playbackIface.updateLivePosition(buffer);
  }
}
