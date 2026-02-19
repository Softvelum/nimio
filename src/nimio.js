import { ScriptPathProvider } from "./shared/script-path-provider";
import { EventBus } from "./event-bus";
import { NimioLive } from "./nimio-live";
import { NimioVod } from "./nimio-vod";
import { NimioEvents } from "./nimio-events";
import { createConfig } from "./player-config";
import { VUMeterService } from "./vumeter/service";
import { LoggersFactory } from "./shared/logger";

let scriptPath;
if (document.currentScript === null) {
  // Javascript module
  scriptPath = import.meta.url;
} else if (document.currentScript) {
  // Javascript library
  scriptPath = document.currentScript.src;
}
if (scriptPath) {
  scriptPath = scriptPath.substr(0, scriptPath.lastIndexOf("/") + 1);
}

export default class Nimio {
  constructor(options) {
    if (options && !options.instanceName) {
      options.instanceName = "nimio_" + (Math.floor(Math.random() * 10000) + 1);
    }
    this._instName = options.instanceName;
    ScriptPathProvider.getInstance(this._instName).setScriptPath(scriptPath);
    this._eventBus = EventBus.getInstance(this._instName);

    this._config = createConfig(options);
    this._logger = LoggersFactory.create(this._instName, "Nimio");
    this._logger.debug("Nimio " + this.version());

    this._createVUMeter();

    this._livePlayer = new NimioLive(this._instName, this._config);
    if (this._config.vod) {
      this._vodPlayer = new NimioVod(this._instName, this._config.vod);
    }
  }

  destroy() {
    if (!this._livePlayer) return;

    this._vuMeterSvc.clear();

    if (this._vodPlayer) {
      this._vodPlayer.destroy;
      this._vodPlayer = undefined;
    }

    this._livePlayer.destroy();
    this._livePlayer = undefined;
  }

  seekVod(position) {
    if (this._vodPlayer && this._vodPlayer.isRunning()) {
      return _sdkPlaybackProgressProxy.seekVod(position);
    }

    return this._runVodFromStart(position);
  };

  seekLive(buffer) {
    if (buffer === undefined || buffer === null) buffer = 0;
    return _sdkPlaybackProgressProxy.seekLive(buffer);
  };

  getVodPlayerHandler() {
    return this._vodPlayer?.isLoaded() ? this._vodPlayer.getHandler() : null;
  };

  version() {
    return __NIMIO_VERSION__;
  }

  static version() {
    return __NIMIO_VERSION__;
  }

  _createVUMeter() {
    this._vuMeterSvc = VUMeterService.getInstance(this._instName);
    const onUpdate = this._onVUMeterUpdate.bind(this);
    this._vuMeterSvc.init(this._config.vuMeter, onUpdate);
  }

  _onVUMeterUpdate(magnitudes, decibels) {}

  _runVodFromStart(pos) {
    if (this._vodPlayer?.isLoaded() && !this._vodPlayer.isRunning()) {
      this._vodPlayer.initialize(_ui.mediaElement).then(() => {
        let isCurPlaying = this._context.getState().playing;
        this._switchToVod(pos);
        this._context.setState(isCurPlaying, false);
        this._context.setStateInitial(true);
        this._context.setAutoAbr(!!this._config.adaptiveBitrate);
      });

      return true;
    }

    return false;
  }

  _onVodPlaybackError (error) {
    // Switch to SLDP player for now.
    // TODO: expand this behavior as new options appear
    this._logger.warn('VOD playback error: ' + error);
    // _runSdkCallback( 'onError', error, {type: 'vod'});
    if (this._config.vod?.liveFailover) {
      this._switchToLive(0);
    } else {
      this._ui.showNotPlaying();
    }
  }

  _onPlaybackPositionChange (type, value) {
    this._logger.debug(`_onPlaybackPositionChange type = ${type}, value = ${value}, mode = ${_mode}`);
    if (this._mode === 'pend') return false;

    if (type === this._mode) {
      return this._actPlayer.goto(value);
    }

    return (type === 'vod') ? this._switchToVod(value) : this._switchToLive(value);
  }

  _switchToVod(position) {
    if (!this._vodPlayer || this._mode === 'vod') return false;
    this._mode = 'pend';

    return this._sldpPlayer.detach(() => {
      // TODO: re-check parameters
      this._actPlayer = this._vodPlayer;
      this._actPlayer.attach(this._ui, position, () => {
        this._mode = 'vod';
      });
    });

  }

  _switchToLive(buffering) {
    if (!this._vodPlayer || this._mode === 'live') return false;
    this._mode = 'pend';

    this._logger.debug('Attach live with buffering = ' + buffering);

    // pbError shows that VOD player couldn't play stream on start
    // that means that there is no playable stream source at the moment
    let pbError = this._context.getState().initial && this._vodPlayer.hasPlaybackErrors();
    return this._vodPlayer.detach(function () {
      this._actPlayer = this._sldpPlayer;
      this._actPlayer.attach(this._ui, {buffering, pbError});
      this._mode = 'live';
    });
  }
}

Object.assign(Nimio.prototype, NimioEvents);

if (typeof window !== "undefined") {
  // Expose globally when used via <script type="module"> without manual assignment
  window.Nimio = Nimio;
}