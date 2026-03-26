import { MODE, STATE } from "@/shared/values";
import { EventBus } from "@/event-bus";
import { multiInstanceService } from "@/shared/service";
import { LoggersFactory } from "@/shared/logger";

class VodPlaybackService {
  constructor(instName) {
    this._instName = instName;
    this._eventBus = EventBus.getInstance(instName);
    this._logger = LoggersFactory.create(instName, "VOD Playback Service");
  }

  init(mediaElement) {
    this._mediaElement = mediaElement;
    this._state = STATE.STOPPED;

    if (this._mediaElement?._pauseOnStart) {
      this._mediaElement._pauseOnStart = undefined;
      this._state = STATE.PAUSED;
    }
  }

  startPlayback(params) {
    if (this._state === STATE.PLAYING && this._playEventReceived) return;

    this._logger.debug(
      `startPlayback, buf ranges count = ${this._mediaElement.buffered.length}`,
    );
    if (this._mediaElement.buffered.length > 0) {
      this._logger.debug(
        `media element buffer start = ${this._mediaElement.buffered.start(0)}, end = ${this._mediaElement.buffered.end(0)}`,
      );
    }

    return this._playMedia(params);
  }

  clear() {
    this.resetPosition();
    this._mediaElement = undefined;
  }

  resetPosition() {
    if (this._mediaElement && this._mediaElement.currentTime !== 0) {
      this.setCurrentTime(0);
    }

    this._state = STATE.STOPPED;
    this._playEventReceived = false;
  }

  getCurrentTime() {
    return this._mediaElement ? this._mediaElement.currentTime : 0;
  }

  setCurrentTime(time) {
    if (!this._mediaElement) return null;

    var curTime = this._mediaElement.currentTime;
    this._logger.debug(`setCurrentTime from ${curTime} to ${time}`);
    this._mediaElement.currentTime = time;
    return time;
  }

  handlePlay() {
    if (this._state === STATE.PLAYING) return;
    this._playMedia();
  }

  handlePause() {
    if (this._state === STATE.PAUSED || this._state === STATE.STOPPED) {
      return false;
    }

    this._mediaElement.pause();
    this._state = STATE.PAUSED;
    return true;
  }

  handlePlayEvent() {
    if (this._playEventReceived) return;

    this._playEventReceived = true;
    this._eventBus.emit("nimio:playback-start", { mode: MODE.VOD });
  }

  handlePauseEvent() {
    if (!this._playEventReceived) return;

    if (this._mediaElement.ended) {
      this._playEventReceived = false;
      this._eventBus.emit("nimio:playback-end", { mode: MODE.VOD });
      return;
    }
    this.resumeIfAutoPaused();
  }

  resumeIfAutoPaused() {
    if (this._mediaElement?.paused && this._state === STATE.PLAYING) {
      this._logger.debug("Resume auto paused");

      var autoPauseTime = this.getCurrentTime();
      this._playMedia({ recover: true });

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

  get state() {
    return this._state;
  }

  _playMedia(params = {}) {
    this._logger.debug(`play media, state = ${this._state}`, params);
    if (!this._mediaElement) return;

    const playPromise = this._mediaElement.play();
    const reportFail = !params.recover;

    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          this._state = STATE.PLAYING;
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
      this._state = STATE.PLAYING;
    }

    return playPromise;
  }
}

VodPlaybackService = multiInstanceService(VodPlaybackService);
export { VodPlaybackService };
