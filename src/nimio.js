import { ScriptPathProvider } from "./shared/script-path-provider";
import { EventBus } from "./event-bus";
import { Ui } from "./ui/ui";
import { NimioLive } from "./nimio-live";
import { NimioVod } from "./nimio-vod";
import { NimioEvents } from "./nimio-events";
import { NimioVolume } from "./nimio-volume";
import { createConfig } from "./player-config";
import { resolveContainer } from "./shared/container";
import { PlaybackContext } from "./playback/context";
import { PlaybackProgressService } from "./playback/progress-service";
import { PlaybackProgressProxy } from "./playback/progress-proxy";
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

    const { element: containerElem, storageKey } = resolveContainer(
      this._config.container,
      { logger: this._logger, fallbackId: this._instName },
    );
    this._config.container = containerElem;
    this._config.volumeId = storageKey;

    this._ui = new Ui(
      this._instName,
      this._config.container,
      {
        width: this._config.width, // TODO: get from video?
        height: this._config.height,
        metricsOverlay: this._config.metricsOverlay,
        autoAbr: !!this._config.adaptiveBitrate,
        fullscreen: !!this._config.fullscreen && !this._config.audioOnly,
        splashScreen: this._config.splashScreen,
        audioOnly: this._config.audioOnly,
        vod: this._config.vod,
      },
      this._eventBus,
    );

    this._context = PlaybackContext.getInstance(this._instName);
    this._createVUMeter();

    this._livePlayer = new NimioLive(this._instName, this._ui, this._config);
    if (this._config.vod) {
      this._vodPlayer = new NimioVod(this._instName, this._config.vod);
      this._eventBus.on("nimio:connection-established", this._onLiveConnected);
    }

    this._actPlayer = this._livePlayer;
    this._mode = "live";

    this._playProgressSvc = PlaybackProgressService.getInstance(this._instName);
    this._playProgressSvc.positionChangeCb = this._onPlaybackPositionChange;
    this._playProgressProxy = new PlaybackProgressProxy(
      this._eventBus,
      this._playProgressSvc,
    );
  }

  destroy() {
    if (!this._ui) return;

    this._ui.destroy();
    this._ui = undefined;

    this._vuMeterSvc.clear();

    if (this._vodPlayer) {
      this._vodPlayer.destroy;
      this._vodPlayer = undefined;
    }

    this._livePlayer.destroy();
    this._livePlayer = undefined;
  }

  setParameters(params) {
    this._livePlayer.setParameters(params);
  }

  play() {
    this._actPlayer.play();
  }

  setStreamURL(url) {
    // _setMgr.setStreamURL(url);
    if (this._vodPlayer && this._vodPlayer.isRunning()) {
      this._vodPlayer.stop(() => {
        this._livePlayer.attach(this._ui);
        this._livePlayer.setStreamURL();
      });
      return;
    }

    this._livePlayer.setStreamURL();
  };

  pause() {
    this._actPlayer.pause();
  }

  stop() {
    if (this._vodPlayer && this._vodPlayer.isRunning()) {
      this._vodPlayer.stop(() => {
        this._livePlayer.attach(this._ui);
        this._livePlayer.stop(true);
      });
      return;
    }

    this._livePlayer.stop(true);
  };

  seekVod(position) {
    if (this._vodPlayer && this._vodPlayer.isRunning()) {
      return this._playProgressProxy.seekVod(position);
    }

    return this._runVodFromStart(position);
  }

  seekLive(buffer) {
    if (buffer === undefined || buffer === null) buffer = 0;
    return this._playProgressProxy.seekLive(buffer);
  }

  getVodPlayerHandler() {
    return this._vodPlayer?.isLoaded() ? this._vodPlayer.getHandler() : null;
  }

  version() {
    return __NIMIO_VERSION__;
  }

  static version() {
    return __NIMIO_VERSION__;
  }

  _createVUMeter() {
    this._vuMeterSvc = VUMeterService.getInstance(this._instName);
    this._vuMeterSvc.init(this._config.vuMeter, (magnitudes, decibels) => {
      this._eventBus.emit("nimio:vumeter-update", { magnitudes, decibels });
    });
  }

  _runVodFromStart(pos) {
    if (this._vodPlayer?.isLoaded() && !this._vodPlayer.isRunning()) {
      this._vodPlayer.initialize(_ui.mediaElement).then(() => {
        let curState = this._context.state.value;
        this._switchToVod(pos);
        this._context.setState(curState, true);
        this._context.setAutoAbr(!!this._config.adaptiveBitrate);
      });

      return true;
    }

    return false;
  }

  _onVodPlaybackError(error) {
    // Switch to live player for now.
    // TODO: expand this behavior as new options appear
    this._logger.warn("VOD playback error: " + error);
    this._eventBus.emit("nimio:playback-error", { mode: "vod", error });
    if (this._config.vod?.liveFailover) {
      this._switchToLive(0);
    } else {
      this._ui.showNotPlaying();
    }
  }

  _switchToVod(position) {
    if (!this._vodPlayer || this._mode === "vod") return false;
    this._mode = "pend";

    return this._livePlayer.detach(() => {
      // TODO: re-check parameters
      this._actPlayer = this._vodPlayer;
      this._actPlayer.attach(this._ui, position, () => {
        this._mode = "vod";
      });
    });
  }

  _switchToLive(buffering) {
    if (!this._vodPlayer || this._mode === "live") return false;
    this._mode = "pend";

    this._logger.debug("Attach live with buffering = " + buffering);

    // pbError shows that VOD player couldn't play stream on start
    // that means that there is no playable stream source at the moment
    let pbError =
      this._context.state.initial && this._vodPlayer.hasPlaybackErrors();
    return this._vodPlayer.detach(() => {
      this._actPlayer = this._livePlayer;
      this._actPlayer.attach(this._ui, { buffering, pbError });
      this._mode = "live";
    });
  }

  _onLiveConnected = () => {
    if (!this._vodPlayer || this._vodPlayer.isPlaying()) return;
    this._vodPlayer.initialize();
  };

  _onPlaybackPositionChange = (type, val) => {
    this._logger.debug(
      `_onPlaybackPositionChange type = ${type}, value = ${val}, mode = ${this._mode}`,
    );
    if (this._mode === "pend") return false;

    if (type === this._mode) {
      return this._actPlayer.goto(val);
    }

    return type === "vod" ? this._switchToVod(val) : this._switchToLive(val);
  };

  _addVolumeEventHandlers() {
    this._onMuteUnmuteClick = this._onMuteUnmuteClick.bind(this);
    this._onVolumeChange = this._onVolumeChange.bind(this);
    this._eventBus.on("ui:mute-unmute-click", this._onMuteUnmuteClick);
    this._eventBus.on("ui:volume-change", this._onVolumeChange);
  }

  _removeVolumeEventHandlers() {
    this._eventBus.off("ui:mute-unmute-click", this._onMuteUnmuteClick);
    this._eventBus.off("ui:volume-change", this._onVolumeChange);
  }
}

Object.assign(Nimio.prototype, NimioEvents);
Object.assign(Nimio.prototype, NimioVolume);

if (typeof window !== "undefined") {
  // Expose globally when used via <script type="module"> without manual assignment
  window.Nimio = Nimio;
}
