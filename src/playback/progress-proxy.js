export class PlaybackProgressProxy {
  constructor(eventBus, playbackIface) {
    this._eventBus = eventBus;
    this._playbackIface = playbackIface;
    this._playbackIface.extProgressNotifier = this;
    this._vodQueue = null; // reports queued while one is being delivered
  }

  // A listener may make the service report again from inside the event (a
  // stream URL change resets the duration): that report is delivered once
  // the current one reached every listener, so that none is left with the
  // superseded values. A listener that threw (the URL change resets the
  // duration all the same) ends the current report; the queued ones are
  // delivered before the exception goes on.
  vodProgress(position, duration) {
    if (this._vodQueue) {
      this._vodQueue.push({ position, duration });
      return;
    }
    this._vodQueue = [{ position, duration }];
    // the first exception, rethrown once the queue is delivered; a thrown
    // undefined is one too, so the fact is kept apart from the value
    let threw = false;
    let thrown;
    for (let i = 0; i < this._vodQueue.length; i++) {
      try {
        this._eventBus.emit("nimio:vod-progress", this._vodQueue[i]);
      } catch (e) {
        if (!threw) {
          threw = true;
          thrown = e;
        }
      }
    }
    this._vodQueue = null;
    if (threw) throw thrown;
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
