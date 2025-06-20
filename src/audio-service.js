import { parseAACConfig } from "./media/parsers/aac-config-parser.js";

export class AudioService {
  constructor(sampleRate = 0, numberOfChannels = 0, sampleCount = 0) {
    this._sampleRate = sampleRate;
    this._numberOfChannels = numberOfChannels;
    this._sampleCount = sampleCount;
  }

  parseAudioConfig(codecData) {
    // TODO: handle all audio codecs besides AAC
    let config = parseAACConfig(codecData);
    this._sampleRate = config.sampleRate;
    this._numberOfChannels = config.numberOfChannels;
    this._sampleCount = config.sampleCount;

    return config;
  }

  smpCntToTsUs(smpCnt) {
    if (this._sampleRate === 0) return 0;
    return (smpCnt * 1000) / (this._sampleRate / 1000);
  }

  get sampleRate() {
    return this._sampleRate;
  }

  get numberOfChannels() {
    return this._numberOfChannels;
  }

  get sampleCount() {
    return this._sampleCount;
  }
}
