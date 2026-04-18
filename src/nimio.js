import { ScriptPathProvider } from "./shared/script-path-provider";
import { EventBus } from "./event-bus";
import { MODE, ERROR } from "./shared/values";
import { UI } from "./ui/ui";
import { NimioLive } from "./nimio-live";
import { NimioVod } from "./nimio-vod";
import { NimioEvents } from "./nimio-events";
import { NimioVolume } from "./nimio-volume";
import { NimioExtAPI } from "./nimio-ext-api";
import { createConfig, updateConfigStreamURL } from "./player-config";
import { resolveContainer } from "./shared/container";
import { PlaybackContext } from "./playback/context";
import { PlaybackProgressService } from "./playback/progress-service";
import { PlaybackProgressProxy } from "./playback/progress-proxy";
import { VUMeterService } from "./vumeter/service";
import { LoggersFactory } from "./shared/logger";
import { AudioVolumeController } from "./audio/volume-controller";

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

    this._ui = new UI(
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
    this._audioVolumeCtrl = AudioVolumeController.getInstance(this._instName);
    this._addVolumeEventHandlers();
    this._createVUMeter();

    this._livePlayer = new NimioLive(this._instName, this._ui, this._config);
    if (this._config.vod) {
      this._vodPlayer = new NimioVod(this._instName, this._config.vod);
      this._eventBus.on("nimio:connection-established", this._onLiveConnected);
    }

    this._actPlayer = this._livePlayer;
    this._mode = MODE.LIVE;
    this._eventBus.on("aux:playback-error", this._onError);

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
    this._removeVolumeEventHandlers();
    this._vuMeterSvc.clear();

    if (this._vodPlayer) {
      this._vodPlayer.destroy();
      this._vodPlayer = undefined;
    }

    this._livePlayer.destroy();
    this._livePlayer = undefined;
    this._eventBus.off("nimio:connection-established", this._onLiveConnected);
    this._eventBus.off("aux:playback-error", this._onError);
  }

  setParameters(params) {
    this._livePlayer.setParameters(params);
  }

  play() {
    this._actPlayer.play();
  }

  setStreamURL(url) {
    updateConfigStreamURL(this._config, url);
    if (this._vodPlayer && this._vodPlayer.isRunning()) {
      this._vodPlayer.stop(() => {
        this._livePlayer.attach(this._ui);
        this._livePlayer.setStreamURL();
      });
      return;
    }

    this._livePlayer.setStreamURL();
  }

  pause() {
    this._actPlayer.pause();
  }

  stop() {
    if (this._vodPlayer && this._vodPlayer.isRunning()) {
      this._vodPlayer.stop(() => {
        this._livePlayer.attach(this._ui);
        this._livePlayer.stop();
      });
      return;
    }

    this._livePlayer.stop();
  }

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
      this._vodPlayer.initialize(this._ui.mediaElement).then(() => {
        let curState = this._context.state.value;
        this._switchToVod(pos);
        this._context.setState(curState, true);
        this._context.autoAbr = !!this._config.adaptiveBitrate;
      });

      return true;
    }

    return false;
  }

  _switchToVod(position) {
    if (!this._vodPlayer || this._mode === MODE.VOD) return false;
    this._mode = MODE.PEND;

    return this._livePlayer.detach(() => {
      // TODO: re-check parameters
      this._actPlayer = this._vodPlayer;
      this._actPlayer.attach(this._ui, position, () => {
        this._mode = MODE.VOD;
      });
    });
  }

  _switchToLive(latency) {
    if (!this._vodPlayer || this._mode === MODE.LIVE) return false;
    this._mode = MODE.PEND;

    this._logger.debug(
      `Attach live with ${latency === 0 ? "default latency" : "latency = " + latency}`,
    );

    // pbError shows that VOD player couldn't play stream on start
    // that means that there is no playable stream source at the moment
    let pbError =
      this._context.state.initial && this._vodPlayer.hasPlaybackErrors();
    return this._vodPlayer.detach(() => {
      this._actPlayer = this._livePlayer;
      this._actPlayer.attach(this._ui, { latency, pbError });
      this._mode = MODE.LIVE;
    });
  }

  _onLivePlaybackError(type, allowFailover) {
    this._logger.warn(`Live playback error: ${ERROR[type]}`);
    switch (type) {
      case "NOT_SUP":
        this._eventBus.emit("nimio:playback-error", {
          error: ERROR[type],
          mode: MODE.LIVE,
        });
        break;
      case "NO_SRC":
        // Start playback from the beginning
        let vodStarted = false;
        if (allowFailover && this._config.vod?.startupVodFailover) {
          // TODO: VOD failover happens on the first run only, to make it
          // always try VOD use the same logic as seekVod() method does
          vodStarted = this._runVodFromStart();
        }

        if (!vodStarted) {
          if (this._vodPlayer?.isRunning()) {
            this._vodPlayer.stop();
          }
          this._eventBus.emit("nimio:playback-error", {
            error: ERROR[type],
            mode: MODE.LIVE,
          });
        }
        break;
      default:
        this._logger.error(`Live error type is not recognized: ${type}`);
        break;
    }
  }

  _onVodPlaybackError(type) {
    // Switch to live player for now.
    this._logger.warn(`VOD playback error: ${ERROR[type]}`);
    if (this._config.vod?.liveFailover) {
      this._switchToLive(0);
    } else {
      this._eventBus.emit("nimio:playback-error", {
        error: ERROR[type],
        mode: MODE.VOD,
      });
    }
  }

  _onError = (data) => {
    if (data.mode === MODE.LIVE) {
      this._onLivePlaybackError(data.type, !data.stop);
    } else {
      this._onVodPlaybackError(data.type);
    }
  };

  _onLiveConnected = () => {
    if (!this._vodPlayer || this._vodPlayer.isPlaying()) return;
    this._vodPlayer.initialize();
  };

  _onPlaybackPositionChange = (mode, val) => {
    this._logger.debug(
      `_onPlaybackPositionChange new mode = ${mode}, value = ${val}, cur mode = ${this._mode}`,
    );
    if (this._mode === MODE.PEND) return false;

    if (mode === this._mode) {
      return this._actPlayer.goto(val);
    }

    return mode === MODE.VOD ? this._switchToVod(val) : this._switchToLive(val);
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

  _checkRenditionType(type) {
    if (type !== "video" && type !== "audio") {
      this._logger.error("Rendition type must be either 'video' or 'audio'");
      return false;
    }
    return true;
  }
}

Object.assign(Nimio.prototype, NimioEvents);
Object.assign(Nimio.prototype, NimioVolume);
Object.assign(Nimio.prototype, NimioExtAPI);

if (typeof window !== "undefined") {
  // Expose globally when used via <script type="module"> without manual assignment
  window.Nimio = Nimio;
}
