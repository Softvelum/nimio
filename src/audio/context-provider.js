import { multiInstanceService } from "@/shared/service";
import LoggersFactory from "@/shared/logger";

class AudioContextProvider {
  constructor(instName) {
    this._instName = instName;
    this._logger = LoggersFactory.create(instName, "AudioContextProvider");
  }

  init(sampleRate) {
    let AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtxClass) {
      this._logger.error("Can't initialize AudioContext!");
      return false;
    }

    if (!this._audioCtx) {
      this._audioCtx = new AudioCtxClass({
        sampleRate: sampleRate || 48000,
        latencyHint: "interactive",
      });
      // setInterval(() => {
      //   this._logger.debug(
      //     `Channels: ${that._audioCtx.destination.channelCount}, Max: ${that._audioCtx.destination.maxChannelCount}, state: ${that._audioCtx.state}`
      //   );
      // }, 200);
      if (this._audioCtx.state !== "suspended") {
        this._suspended = false;
      } else {
        this._callbacks = [];
        let provider = this;
        this._audioCtx.onstatechange = function () {
          provider._logger.debug(
            `onstatechange state=${provider._audioCtx.state}, suspended=${provider._suspended}`,
          );

          if (provider._suspended && "running" === provider._audioCtx.state) {
            provider._logger.debug("Audio context switched to running");
            provider._audioCtx.onstatechange = undefined;
            provider._suspended = false;

            for (let i = 0; i < provider._callbacks.length; i++) {
              provider._callbacks[i](provider._audioCtx);
            }
            provider._callbacks = undefined;
          }
        };
        this._logger.debug("Audio context is created, but it's suspended");
        this._suspended = true;
        this._audioCtx.resume();
      }
    } else if (this._suspended) {
      this._logger.debug("Trying to resume suspended audio context");
      this._audioCtx.resume();
    }
  }

  onContextRunning(cb) {
    if (this._callbacks) {
      this._callbacks.push(cb);
    } else {
      this._logger.error("onContextRunning callbacks are not defined");
    }
  }

  isSuspended() {
    return this._suspended;
  }

  setChannelCount(val) {
    if (this._audioCtx) {
      let maxCount = this._audioCtx.destination.maxChannelCount;
      if (maxCount < val && maxCount > 0) val = maxCount;
      this._audioCtx.destination.channelCount = val;

      this._logger.debug(
        `setChannelCount ${val}, max channel count ${maxCount}`,
      );
    }
  }

  get() {
    return this._audioCtx;
  }
}

AudioContextProvider = multiInstanceService(AudioContextProvider);
export { AudioContextProvider };
