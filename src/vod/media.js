import LoggersFactory from "@/shared/logger";
import { VodPlaybackService } from "./playback-service";

class VodMedia {
  constructor (instanceId) {
    this._logger = LoggersFactory.create(instanceId, "VodMedia");
    this._playbackService = VodPlaybackService.getInstance(instanceId);
  }

  init (mediaElement) {
    this._mediaElement = mediaElement;
  }

  clear () {
    this._playStarted = false;
    this._mediaElement = undefined;
  }

  startPlayback (params) {
    this._logger.debug('startPlayback, buffered ranges count ', this._mediaElement.buffered.length);
    if( this._mediaElement.buffered.length > 0 ) {
      this._logger.debug('video element buffer', this._mediaElement.buffered.start(0), this._mediaElement.buffered.end(0) );
    }

    if( !this._playbackService.isPlaying() && !this._playStarted ) {
      return this._playbackService.playMedia(params);
    }
  }

  handlePlayEvent () {
    if( !this._playStarted ) {
      this._playStarted = true;
      this._onPlayStartedCallback();
    }
  }

  handlePauseEvent () {
    if (!this._playStarted) return;

    if (this._mediaElement.ended) {
      this._playStarted = false;
      this._onPlayFinishedCallback();
      return;
    }
    this._playbackService.resumeIfAutoPaused();
  }

}

export default VodMedia;
