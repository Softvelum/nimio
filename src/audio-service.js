import { parseAACConfig } from "./media/parsers/aac-config-parser";
import { parseMp3Config } from "./media/parsers/mp3-config-parser";
import { parseOpusConfig } from "./media/parsers/opus-config-parser";

export class AudioService {
  constructor(sampleRate = 0, numberOfChannels = 0, sampleCount = 0) {
    this._sampleRate = sampleRate;
    this._numberOfChannels = numberOfChannels;
    this._sampleCount = sampleCount;
    this._parsers = {
      AAC: parseAACConfig,
      MP3: parseMp3Config,
      OPUS: parseOpusConfig,
    };
  }

  parseAudioConfig(codecData, codecFamily) {
    let parserFn = this._parsers[codecFamily];
    if (!parserFn) {
      console.error("No parser for the give codec", codecFamily);
      return null;
    }
    let config = parserFn(codecData);
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
