import { multiInstanceService } from '@/shared/service';
import { LoggersFactory } from '@/shared/logger';

class PlaybackService {
  constructor (instName) {
    this._instName = instName;
    this._logger = LoggersFactory.create(instName, 'PlaybackService');
  }

  init (mediaElement) {
    this._mediaElement = mediaElement;
    this._isPlaying = false;
    this._isPaused = false;

    if (this._mediaElement._pauseOnStart) {
      this._mediaElement._pauseOnStart = undefined;
      this._isPaused = true;
    }
  }

  unset () {
    this._mediaElement = undefined;
  }

  resetPosition () {
    if( this._mediaElement && this._mediaElement.currentTime !== 0 ) {
      this.setCurrentTime(0);
    }

    this._isPaused = false;
    this._isPlaying = false;
  }

  getCurrentTime () {
    return this._mediaElement ? this._mediaElement.currentTime : 0;
  }

  setCurrentTime (time) {
    var curTime = this._mediaElement.currentTime;
    this._logger.debug(`setCurrentTime from ${curTime} to ${time}`);
    this._mediaElement.currentTime = time;
    return time;
  }

  set onPlayFailed (cb) {
    this._onPlayFailedCallback = cb;
  }

  handlePlay () {
    if( this._mediaElement && !this._isPlaying ) {
      this.playMedia();
    }
  }

  handlePause () {
    if (!this._mediaElement || this._isPaused || !this._isPlaying) return false; 

    this._mediaElement.pause();
    this._isPaused  = true;
    this._isPlaying = false;
    return true;
  }

  resumeIfAutoPaused () {
    if(this._mediaElement?.paused && this._isPlaying && !this._isPaused ) {
      this._logger.debug("Resume auto paused");

      var autoPauseTime = this.getCurrentTime();
      this.playMedia({recover: true});
      
      var inst = this;
      setTimeout(function () {
        if (inst.getCurrentTime() === 0) {
          inst._logger.debug(
            `resume autopaused set media element currentTime to ${autoPauseTime}`
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

  playMedia (params = {}) {
    this._logger.debug('play media', params, this._isPlaying);

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
          if (reportFail) this._onPlayFailedCallback();
        });
    } else {
      // Just in case fallback
      this._isPlaying = true;
      this._isPaused = false;
    }

    return playPromise;
  }
}

PlaybackService = multiInstanceService(PlaybackService);
export { PlaybackService };
