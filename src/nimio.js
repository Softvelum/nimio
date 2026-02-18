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
}

Object.assign(Nimio.prototype, NimioEvents);

if (typeof window !== "undefined") {
  // Expose globally when used via <script type="module"> without manual assignment
  window.Nimio = Nimio;
}