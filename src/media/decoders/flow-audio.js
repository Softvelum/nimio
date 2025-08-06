import { DecoderFlow } from './flow';

export class DecoderFlowAudio extends DecoderFlow {
  constructor(trackId, timescale) {
    super(trackId, timescale, "./decoder-audio.js");
  }
  
}
