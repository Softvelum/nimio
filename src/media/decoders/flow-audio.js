import { DecoderFlow } from "./flow";

export class DecoderFlowAudio extends DecoderFlow {
  constructor(trackId, timescale) {
    super(trackId, timescale, "./decoder-audio.js");
    this._type = "audio";
  }

  _prepareFrame(data) {
    data.audioFrame.rawTimestamp = data.rawTimestamp;
    data.audioFrame.decTimestamp = data.decTimestamp;
    return data.audioFrame;
  }

  async _handleDecoderOutput(frame, data) {
    await this._handleDecodedFrame(frame);
    this._state.setAudioDecoderQueue(data.decoderQueue);
  }
}
