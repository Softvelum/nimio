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

}
