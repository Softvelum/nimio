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
    };
  },

  _onVideoSetupReceived(data) {
    if (!data || !data.config) {
      this._noVideo = true;
      return;
    }

    if (this._isNextRenditionTrack(data.trackId)) {
      return this._createNextRenditionFlow("video", data);
    }

    if (this._decoderFlows["video"]) {
      this._logger.warn("Received video setup while video flow already exist");
      return;
    }

    this._createMainDecoderFlow("video", data);
    if (this._abrController) {
      this._renditionProvider.init(this._config.adaptiveBitrate, this._ui.size);
      this._abrController.start();
      this._lastBufReportMs = performance.now() + 100;
    }
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
    if (data.data) {
      this._metricsManager.reportBandwidth(data.trackId, data.data.byteLength);
    }

    if (this._abrController.isProbing(data.trackId)) {
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
    if (data.data) {
      this._metricsManager.reportBandwidth(data.trackId, data.data.byteLength);
    }

    let audioAvailable = true;
    let curConfigVals = this._audioConfig.get();
    let newConfigVals = this._audioConfig.parse(data.data, data.family);
    let decoderFlow, buffer;
    if (this._isNextRenditionTrack(data.trackId)) {
      if (!newConfigVals || !this._audioConfig.isCompatible(curConfigVals)) {
        this._logger.warn(
          "Received incompatible audio config for next rendition",
          data.trackId,
          curConfigVals,
          newConfigVals,
        );
        this._audioConfig.set(curConfigVals);
        this._nextRenditionData.decoderFlow.destroy();
        this._onRenditionSwitchResult("audio", false);
        return;
      }

      decoderFlow = this._nextRenditionData.decoderFlow;
      buffer = this._tempBuffer;
      this._decoderFlows["audio"].switchTo(decoderFlow);
    } else {
      audioAvailable = this._prepareAudioOutput(newConfigVals);
      decoderFlow = this._decoderFlows["audio"];
      buffer = this._audioBuffer;
    }

    if (audioAvailable) {
      decoderFlow.setCodecData({ codecData: data.data, config: newConfigVals });
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
    this._metricsManager.reportBandwidth(
      data.trackId,
      data.frameWithHeader.byteLength,
      data.timestamp,
    );

    if (flow.processChunk(data)) return;

    if (this._isNextRenditionTrack(data.trackId)) {
      this._nextRenditionData.decoderFlow.processChunk(data);
    } else if (this._abrController?.isProbing(data.trackId)) {
      this._abrController.handleChunkTs(data.timestamp);
    }
  },
};
