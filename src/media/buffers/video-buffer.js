import { FrameBuffer } from "./frame-buffer";

export class VideoBuffer extends FrameBuffer {
  constructor(instName, maxFrames = 100) {
    super(instName, "Video", maxFrames);
  }

  _disposeFrame(data) {
    if (data && data.frame) {
      data.frame.close();
    }
  }
}
