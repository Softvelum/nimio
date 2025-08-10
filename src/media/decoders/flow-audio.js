import { DecoderFlow } from "./flow";

export class DecoderFlowAudio extends DecoderFlow {
  constructor(trackId, timescale) {
    super(trackId, timescale, "./decoder-audio.js");
  }

  async _processDecoderMessage(e) {
    const type = e.data.type;
    switch (type) {
      case "audioFrame":
        e.data.audioFrame.rawTimestamp = e.data.rawTimestamp;
        e.data.audioFrame.decTimestamp = e.data.decTimestamp;
        await this._handleFrame(e.data.audioFrame);
        e.data.audioFrame.close();
        this._state.setAudioDecoderQueue(e.data.decoderQueue);
        break;
      case "decoderError":
        this._onDecodingError("audio");
        break;
      default:
        console.warn(`Unknown message type in DecoderFlowAudio: ${type}`);
        break;
    }
  }

  async _handleFrame(frame) {
    if (this._state.isStopped()) {
      return true;
    }

    if (this._startTsUs === 0) {
      let res = await this._onStartTsNotSet(frame);
      if (!res) return false; // audio output failed

      // check _startTsUs to avoid multiple assignments when all promises are resolved
      if (this._startTsUs === 0) {
        this._startTsUs = this._state.getPlaybackStartTsUs();
      }
    }

    this._buffer.pushFrame(frame);
  }
}
