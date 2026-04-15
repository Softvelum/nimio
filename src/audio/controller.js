import { multiInstanceService } from "@/shared/service";
import { AudioGraphController } from "./graph-controller";
import { AudioVolumeController } from "./volume-controller";
import { LoggersFactory } from "@/shared/logger";
import { AudioContextProvider } from "./context-provider";

class AudioController {
  constructor(instName) {
    this._instName = instName;
    this._logger = LoggersFactory.create(instName, "Audio Controller");
    this._audioCtxProvider = AudioContextProvider.getInstance(this._instName);
    this._audioVolumeCtrl = AudioVolumeController.getInstance(this._instName);
    this._audioGraphCtrl = AudioGraphController.getInstance(this._instName);
    this._ready = false;
  }

  isReady() {
    return this._ready;
  }

  initContext(sampleRate, channels) {
    const audCtx = this._audioCtxProvider.get();
    if (!audCtx || audCtx.sampleRate !== sampleRate) {
      this._logger.debug(
        `Init audio context, sampleRate = ${sampleRate}, channels = ${channels}`,
      );
      this._audioCtxProvider.init(sampleRate);
    }
    this._audioCtxProvider.setChannelCount(channels);
    return this._audioCtxProvider.get();
  }

  initVolume(volumeId, muted) {
    this._audioVolumeCtrl.init(volumeId, muted);
  }

  reset() {
    // TODO: keep audio graph if context doesn't have to be recreated
    this._audioGraphCtrl.dismantle();
    this._audioCtxProvider.reset();
    this._ready = false;
  }

  setSource(node, channels) {
    this._audioGraphCtrl.setSource(node, channels);
    let vIdx = this._audioGraphCtrl.appendNode(this._audioVolumeCtrl.node);
    this._ready = this._audioGraphCtrl.assemble(["src", vIdx], [vIdx, "dst"]);
    if (this._audioCtxProvider.isSuspended()) {
      this._audioCtxProvider.get().resume();
    }
  }

  removeSource() {
    this._audioGraphCtrl.removeSource();
  }
}

AudioController = multiInstanceService(AudioController);
export { AudioController };
