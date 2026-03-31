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
    this._audioCtxProvider.reset();
    this._ready = false;
  }

  canConnectSource(node) {
    return this._audioGraphCtrl.canAcceptSource(node);
  }

  connectSource(node, channels) {
    let needsReassemble = !this._audioGraphCtrl.canAcceptSource(node);
    if (needsReassemble) {
      this._audioGraphCtrl.dismantle();
    }
    this._ready = this._audioGraphCtrl.setSource(node, channels);

    if (needsReassemble) {
      let vIdx = this._audioGraphCtrl.appendNode(this._audioVolumeCtrl.node);
      this._ready = this._audioGraphCtrl.assemble(["src", vIdx], [vIdx, "dst"]);
    }

    this._ensureAudioContextRunning();
  }

  _ensureAudioContextRunning() {
    if (this._audioCtxProvider.isSuspended()) {
      this._audioCtxProvider.get().resume();
    }
  }
}

AudioController = multiInstanceService(AudioController);
export { AudioController };
