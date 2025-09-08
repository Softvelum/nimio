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
    let audioAvailable = true;
    let prevConfig = this._audioService.currentConfig;
    let config = this._audioService.parseAudioConfig(data.data, data.family);
    let decoderFlow, buffer;
    if (this._isNextRenditionTrack(data.trackId)) {
      if (!config || !this._audioService.isConfigCompatible(prevConfig)) {
        this._logger.warn(
          "Received incompatible audio config for next rendition",
          data.trackId,
          prevConfig,
          config,
        );
        this._audioService.setConfig(prevConfig);
        this._nextRenditionData.decoderFlow.destroy();
        this._onRenditionSwitchResult("audio", false);
        return;
      }

      decoderFlow = this._nextRenditionData.decoderFlow;
      buffer = this._tempBuffer;
      this._decoderFlows["audio"].switchTo(decoderFlow);
    } else {
      audioAvailable = this._prepareAudioOutput(config);
      decoderFlow = this._decoderFlows["audio"];
      buffer = this._audioBuffer;
    }

    if (audioAvailable) {
      decoderFlow.setCodecData({ codecData: data.data, config: config });
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
    let res = flow.processChunk(data);
    if (!res && this._isNextRenditionTrack(data.trackId)) {
      this._nextRenditionData.decoderFlow.processChunk(data);
    }
  },

};