import { FrameBuffer } from "./frame-buffer";

export class AudioBuffer extends FrameBuffer {
  constructor(instName, maxFrames = 100) {
    super(instName, "Audio", maxFrames);
  }
}
