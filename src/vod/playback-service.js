import { MODE } from '@/shared/values';
import { EventBus } from '@/event-bus';
import { multiInstanceService } from '@/shared/service';
import { LoggersFactory } from '@/shared/logger';

class VodPlaybackService {
  constructor (instName) {
    this._instName = instName;
    this._eventBus = EventBus.getInstance(instName);
    this._logger = LoggersFactory.create(instName, 'Playback Service');
  }

  init (mediaElement) {
    this._mediaElement = mediaElement;
    this._isPlaying = false;
    this._isPaused = false;

    if (this._mediaElement?._pauseOnStart) {
      this._mediaElement._pauseOnStart = undefined;
      this._isPaused = true;
    }
  }

  startPlayback (params) {
    if (this.isPlaying() && this._playEventReceived) return;

    this._logger.debug(
      `startPlayback, buf ranges count = ${this._mediaElement.buffered.length}`,
    );
    if( this._mediaElement.buffered.length > 0 ) {
      this._logger.debug(
        `media element buffer start = ${this._mediaElement.buffered.start(0)}, end = ${this._mediaElement.buffered.end(0)}`,
      );
    }

    return this._playMedia(params);
  }

  clear () {
    this.resetPosition();
    this._mediaElement = undefined;
  }

  resetPosition () {
    if( this._mediaElement && this._mediaElement.currentTime !== 0 ) {
      this.setCurrentTime(0);
    }

    this._isPaused = false;
    this._isPlaying = false;
    this._playEventReceived = false;
  }

  getCurrentTime () {
    return this._mediaElement ? this._mediaElement.currentTime : 0;
  }

  setCurrentTime (time) {
    if (!this._mediaElement) return null;

    var curTime = this._mediaElement.currentTime;
    this._logger.debug(`setCurrentTime from ${curTime} to ${time}`);
    this._mediaElement.currentTime = time;
    return time;
  }

  handlePlay () {
    if (this.isPlaying()) return;
    this._playMedia();
  }

  handlePause () {
    if (!this.isPlaying() || this._isPaused) return false; 

    this._mediaElement.pause();
    this._isPaused = true;
    this._isPlaying = false;
    return true;
  }

  handlePlayEvent () {
    if (this._playEventReceived) return;

    this._playEventReceived = true;
    this._eventBus.emit("nimio:playback-started");
  }

  handlePauseEvent () {
    if (!this._playEventReceived) return;

    if (this._mediaElement.ended) {
      this._playEventReceived = false;
      this._eventBus.emit("nimio:playback-ended", { mode: MODE.VOD });
      return;
    }
    this.resumeIfAutoPaused();
  }

  resumeIfAutoPaused () {
    if(this._mediaElement?.paused && this._isPlaying && !this._isPaused ) {
      this._logger.debug("Resume auto paused");

      var autoPauseTime = this.getCurrentTime();
      this._playMedia({recover: true});
      
      var inst = this;
      setTimeout(function () {
        if (inst.getCurrentTime() === 0) {
          inst._logger.debug(
            `resume autopaused set media element currentTime to ${autoPauseTime}`,
          );
          inst.setCurrentTime(autoPauseTime);
        }
      }, 10);
    }
  }

  isPaused () {
    return this._mediaElement ? this._isPaused : false;
  }

  isPlaying () {
    return this._mediaElement ? this._isPlaying : false;
  }

  _playMedia (params = {}) {
    this._logger.debug("play media", params, this._isPlaying);
    if (!this._mediaElement) return;

    const playPromise = this._mediaElement.play();
    const reportFail = !params.recover;
  
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          this._isPlaying = true;
          this._isPaused = false;
        })
        .catch((err) => {
          if (err.name === "NotAllowedError") {
            this._logger.debug("Autoplay blocked");
          }
          if (reportFail) {
            this._eventBus.emit("nimio:playback-error", {
              mode: "vod",
              error: err.name,
            });
          }
        });
    } else {
      // Just in case fallback
      this._isPlaying = true;
      this._isPaused = false;
    }

    return playPromise;
  }
}

VodPlaybackService = multiInstanceService(VodPlaybackService);
export { VodPlaybackService };
