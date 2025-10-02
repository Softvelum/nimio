import { ScriptProcessorMeter } from "./script-processor";
import { AudioWorkletMeter } from "./audio-worklet";

function VUMeterFactory(instName) {
  return {
    create: function (settings) {
      let instance;
      switch (settings.mode) {
        case "peak":
        case "rms":
        case "avg":
          let runWorklet = false;
          if (window.isSecureContext) {
            runWorklet =
              undefined !== window.AudioWorkletNode &&
              "audioworklet" === settings.api.toLowerCase();
          }
          instance = runWorklet
            ? new AudioWorkletMeter(settings, instName)
            : new ScriptProcessorMeter(settings, instName);
          break;
        default:
          break;
      }
      return instance;
    },
  };
}

export { VUMeterFactory };
