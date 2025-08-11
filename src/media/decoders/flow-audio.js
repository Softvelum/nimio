import { DecoderFlow } from "./flow";

export class DecoderFlowAudio extends DecoderFlow {
  constructor(trackId, timescale) {
    super(trackId, timescale, "./decoder-audio.js");
    this._type = "audio";
  }

  async _handleDecodedData(data) {
    data.audioFrame.rawTimestamp = data.rawTimestamp;
    data.audioFrame.decTimestamp = data.decTimestamp;
    await this._handleDecodedFrame(data.audioFrame);
    this._state.setAudioDecoderQueue(data.decoderQueue);
  }

}
