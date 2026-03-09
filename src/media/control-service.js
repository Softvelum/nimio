import { PlaybackService } from "@/playback/service";
import { multiInstanceService } from "@/shared/service";
import { LoggersFactory } from "@/shared/logger";

class MediaControlService {
  constructor (instanceId) {
    this._stored = {};
    this._logger = LoggersFactory.create(instanceId, 'MediaControlService');
    this._playbackService = PlaybackService.getInstance(instanceId);
  }

  init (mediaElement) {
    this._playbackService.init(mediaElement);

    if (!this._api) {
      this._preInitialized = true;
      return;
    }

    if (!this._initialized) {
      this._setStoredParams();
      this._initialized = true;
    }
  }

  clear (params) {
    if (!params || !params.keepPlayback) {
      this._playbackService.unset();
    }

    if ((!params || !params.shallow) && this._api) {
      this._api.clear();
    }

    this._initialized = this._preInitialized = false;
    this._api = this._name = undefined;
  }

  keepPlaybackState (context) {
    context.setState(
      this._playbackService.isPlaying(),
      this._playbackService.isPaused(),
    );
    context.setStateInitial(false);
  }

  useApi (name, api) {
    this._name = name;
    this._api = api;
    this._api.setControlCallbacks({
      onPlayStarted: this._onPlayStarted,
      onPlayFinished: this._onPlayFinished,
    });

    if (!this._initialized && this._preInitialized) {
      this._setStoredParams();
      this._initialized = true;
    }
  }

  setVolume (vol) {
    
    this._stored.volume = vol;
  }

  getVolume () {

    return (undefined === this._stored.volume) ? 1 : this._stored.volume;
  }

  setMuted (val) {


    this._stored.muted = val;
  }

  isMuted () {

    return !!this._stored.muted;
  }

  _setStoredParams () {

    this._stored.volume = undefined;
    this._stored.muted = undefined;
  }

}

MediaControlService = multiInstanceService(MediaControlService);
export { MediaControlService };
