import { AudioConfig } from "./audio/config";
import { TransportAdapter } from "./transport/adapter";

export const NimioTransport = {
  _initTransport(instName, url) {
    this._transport = new TransportAdapter(instName, url);
    this._transport.callbacks = {
      videoSetup: this._onVideoSetupReceived.bind(this),
      videoCodec: this._onVideoCodecDataReceived.bind(this),
      videoChunk: this._onVideoChunkReceived.bind(this),

      audioSetup: this._onAudioSetupReceived.bind(this),
      audioCodec: this._onAudioCodecDataReceived.bind(this),
      audioChunk: this._onAudioChunkReceived.bind(this),
      disconnect: this._onDisconnect.bind(this),
    };
    this._eventBus.on("transp:track-action", this._onTrackAction.bind(this));
  },

  _onTrackAction(data) {
    this._advertizerEval.handleAction(data);
    if (!this._audioNode) {
      this._advertizerEval.pendingActions.push(data);
      return;
    }

    this._audioNode.port.postMessage({ type: "transp-track-action", data });
  },

  _onDisconnect(data) {
    this._state.stop();
    this._sldpManager.resetCurrentStreams();
    if (this._isAutoAbr()) {
      this._abrController.stop({ hard: true });
    }
    this._resetPlayback();
    if (!this._reconnect.schedule(this._playCb)) {
      this._logger.debug("Stop reconnecting");
      return this._ui.drawPlay();
    }
    this._logger.debug("Attempt to reconnect");
  },

  _onVideoSetupReceived(data) {
    if (!data || !data.config) {
      this._setNoVideo();
      return;
    }

    data.config.hardwareAcceleration = this._config.hardwareAcceleration;
    if (this._isNextRenditionTrack(data.trackId)) {
      return this._createNextRenditionFlow("video", data);
    }

    if (this._decoderFlows["video"]) {
      this._logger.warn("Received video setup while video flow already exist");
      return;
    }

    this._createMainDecoderFlow("video", data);
    if (this._isAutoAbr()) {
      this._rendProvider.init(this._config.adaptiveBitrate, this._ui.size);
      this._startAbrController();
    }

    this._eventBus.emit("nimio:rendition-list", this._makeUiRenditionList());
    let curRend = this._context.getCurrentRendition("video");
    this._eventBus.emit("nimio:rendition-set", {
      name: curRend.rendition,
      id: curRend.idx + 1,
    });
  },

  _onAudioSetupReceived(data) {
    if (!data || !data.config) {
      this._startNoAudioMode();
      return;
    }

    if (this._isNextRenditionTrack(data.trackId)) {
      return this._createNextRenditionFlow("audio", data);
    }

    if (this._decoderFlows["audio"]) {
      this._logger.warn("Received audio setup while audio flow already exist");
      return;
    }

    this._createMainDecoderFlow("audio", data);
  },

  _onVideoCodecDataReceived(data) {
    this._runMetrics(data);
    this._timestampManager.rebaseTrack(data.trackId);

    if (this._abrController?.isProbing(data.trackId)) {
      return this._abrController.handleCodecData(data);
    }

    let decoderFlow = this._decoderFlows["video"];
    let buffer = this._videoBuffer;
    if (this._isNextRenditionTrack(data.trackId)) {
      decoderFlow = this._nextRenditionData.decoderFlow;
      buffer = this._tempBuffer;
      this._decoderFlows["video"].switchTo(decoderFlow);
    }

    decoderFlow.setCodecData({ codecData: data.data });
    decoderFlow.setBuffer(buffer, this._state);
  },

  _onAudioCodecDataReceived(data) {
    this._runMetrics(data);
    this._timestampManager.rebaseTrack(data.trackId);

    let audioAvailable, decoderFlow, buffer;
    let newCfg = new AudioConfig().parse(data.data, data.family);
    if (this._isNextRenditionTrack(data.trackId)) {
      if (!this._audioConfig.isCompatible(newCfg)) {
        this._logger.warn(
          "Incompatible audio config for rendition switch",
          data.trackId,
          this._audioConfig.get(),
          newCfg.get(),
        );

        this._nextRenditionData.decoderFlow.destroy();
        this._onRenditionSwitchResult("audio", false);
        this._sldpManager.cancelStream(data.trackId);
        return;
      }

      audioAvailable = true;
      this._audioConfig = newCfg;
      buffer = this._tempBuffer;
      decoderFlow = this._nextRenditionData.decoderFlow;
      this._decoderFlows["audio"].switchTo(decoderFlow);
    } else {
      if (!this._audioBuffer || this._audioConfig.isCompatible(newCfg)) {
        this._audioConfig = newCfg;
        audioAvailable = this._prepareAudioOutput();
      } else {
        this._logger.warn(
          "Incompatible audio config update",
          data.trackId,
          this._audioConfig.get(),
          newCfg.get(),
        );
      }

      if (audioAvailable) {
        decoderFlow = this._decoderFlows["audio"];
        buffer = this._audioBuffer;
      } else {
        this._decoderFlows["audio"].destroy();
        this._decoderFlows["audio"] = null;
        this._sldpManager.cancelStream(data.trackId);
        this._context.resetCurrentStream("audio");
      }
    }

    if (audioAvailable) {
      decoderFlow.setCodecData({ codecData: data.data, config: newCfg.get() });
      decoderFlow.setBuffer(buffer, this._state);
    }
  },

  _onVideoChunkReceived(data) {
    this._processChunk(this._decoderFlows["video"], data);
  },

  _onAudioChunkReceived(data) {
    this._processChunk(this._decoderFlows["audio"], data);
  },

  _processChunk(flow, data) {
    if (!flow) return;
    if (!this._timestampManager.validateChunk(data.trackId, data)) {
      this._logger.warn("Drop invalid chunk", data.trackId, data.pts);
      return;
    }

    if (this._syncModeParams && !this._syncModeParams.inited) {
      this._initSyncModeParams(data);
    }

    this._metricsManager.reportBandwidth(
      data.trackId,
      data.frameWithHeader.byteLength,
      data.pts,
    );

    if (flow.processChunk(data)) return;

    if (this._isNextRenditionTrack(data.trackId)) {
      this._nextRenditionData.decoderFlow.processChunk(data);
    } else if (this._abrController?.isProbing(data.trackId)) {
      this._abrController.handleChunkTs(data.pts);
    }
  },

  _runMetrics(data) {
    this._metricsManager.run(data.trackId);
    if (data.data) {
      this._metricsManager.reportBandwidth(data.trackId, data.data.byteLength);
    }
  },

  _makeUiRenditionList() {
    let res = [];
    let renditions = this._context.videoRenditions;
    for (let i = 0; i < renditions.length; i++) {
      res.push({ name: renditions[i].rendition, id: renditions[i].idx + 1 });
    }
    return res;
  },
};
