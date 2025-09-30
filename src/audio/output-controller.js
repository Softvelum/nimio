import { multiInstanceService } from "@/shared/service";
import LoggersFactory from "@/shared/logger";

class AudioOutputController {
  constructor(instName) {
    this._instName = instName;
    this._logger = LoggersFactory.create(instName, "AudioOutputController");
  }
}

AudioOutputController = multiInstanceService(AudioOutputController);
export { AudioOutputController };
