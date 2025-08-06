import { DecoderFlow } from './flow';

export class DecoderFlowVideo extends DecoderFlow {
  constructor(trackId, timescale) {
    super(trackId, timescale, "./decoder-video.js");
  }

}
