import { DecoderFlow } from "./flow";
import aDecoderUrl from "./decoder-audio?worker&url"; // ?worker&url - Vite initiate new Rollup build

export class DecoderFlowAudio extends DecoderFlow {
  constructor(instanceName, trackId, timescale) {
    super(instanceName, trackId, timescale, "audio", aDecoderUrl);
  }

  _prepareFrame(data) {
    data.audioFrame.rawTimestamp = data.rawTimestamp;
    data.audioFrame.decTimestamp = data.decTimestamp;
    return data.audioFrame;
  }

  async _handleDecoderOutput(frame, data) {
    if (await this._handleDecodedFrame(frame)) {
      this._state.setAudioLatestTsUs(this._buffer.lastFrameTs);
    }
    this._state.setAudioDecoderQueue(data.decoderQueue);
  }
}
