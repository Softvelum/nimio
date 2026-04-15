import { multiInstanceService } from "@/shared/service";
import { MODE } from "@/shared/values";
import { LoggersFactory } from "@/shared/logger";

class PlaybackProgressService {
  constructor(instanceName) {
    this._logger = LoggersFactory.create(instanceName, "Progress Service");
    this._vodPosition = 0;
    this._vodDuration = 0;
    this._vodPlaylistDuration = 0;

    this._livePosition = 0;
    this._liveDuration = 0;
  }

  updateVodProgress(pos, dur) {
    // this._logger.debug(`updateVod pos = ${pos}, dur = ${dur}`);
    if (!isNaN(dur) && dur !== this._vodDuration) {
      this._logger.debug(
        `updateVodProgress prev duration = ${this._vodDuration}, new duration = ${dur}`,
      );
      this._vodDuration = dur;
    }
    this._vodPosition = pos;
    if (this._ui) {
      this._ui.updatePosition(this._calcPosition(MODE.VOD));
    }

    let fullDuration = this._fullVodDuration();
    if (this._timeIndUI) {
      this._timeIndUI.update(this._vodPosition, fullDuration);
    }

    this._extProgressNotifier.vodProgress(this._vodPosition, fullDuration);
  }

  updateVodPlaylistDuration(dur) {
    this._logger.debug(`update VOD duration = ${dur}`);
    this._vodPlaylistDuration = dur;
    if (this._ui) {
      this._ui.updateDuration(this._totalDuration());
    }
    let fullDuration = this._fullVodDuration();
    if (this._timeIndUI) {
      this._timeIndUI.update(this._vodPosition, fullDuration);
    }

    this._extProgressNotifier.vodProgress(this._vodPosition, fullDuration);
  }

  updateLiveProgress(pos, dur) {
    this._logger.debug(`updateLive pos = ${pos}, dur = ${dur}`);
    this._livePosition = pos;
    this._liveDuration = dur;
    if (this._ui) {
      this._ui.update(this._calcPosition(MODE.LIVE), this._totalDuration());
    }
    if (this._timeIndUI) {
      this._timeIndUI.update(-1);
    }

    this._extProgressNotifier.liveProgress(
      this._livePosition,
      this._liveDuration,
    );
  }

  setUI(ui) {
    this._ui = ui;
    this._ui.onPositionUpdated = this._onPositionUpdated;
  }

  setTimeIndUI(ui) {
    this._timeIndUI = ui;
  }

  unsetUI() {
    this._ui = undefined;
  }

  unsetTimeIndUI() {
    this._timeIndUI = undefined;
  }

  updateVodPosition(position) {
    if (position < 0) position = 0;

    let fullVodDuration = this._fullVodDuration();
    if (position > fullVodDuration) position = fullVodDuration;
    let res = this._positionChangeCallback(MODE.VOD, position);
    if (res) {
      this._vodPosition = position;
      this._livePosition = 0;
    }

    return res;
  }

  updateLivePosition(buffer) {
    if (buffer < 0) buffer = 0;
    if (buffer > 25) buffer = 25;
    let res = this._positionChangeCallback(MODE.LIVE, buffer);
    if (res) {
      this._livePosition = this._vodPosition = 0;
    }

    return res;
  }

  set positionChangeCb(cb) {
    this._positionChangeCallback = cb;
  }

  set extProgressNotifier(inst) {
    this._extProgressNotifier = inst;
  }

  _onPositionUpdated = function (pos) {
    if (!this._ui) {
      this._logger.error("onPositionUpdated is invoked without UI set!");
      return;
    }
    this._doPositionUpdate(pos * this._totalDuration());
  }.bind(this);

  _doPositionUpdate(pos) {
    this._logger.debug(
      `update position = ${pos}, vodDuration = ${this._vodDuration}, playlistDuration = ${this._vodPlaylistDuration}`,
    );
    if (pos < this._fullVodDuration()) {
      if (this._positionChangeCallback(MODE.VOD, pos)) {
        this._vodPosition = pos;
        this._livePosition = 0;
      }
      return;
    }

    if (this._positionChangeCallback(MODE.LIVE, this._totalDuration() - pos)) {
      // this._livePosition = pos - this._fullVodDuration();
      this._vodPosition = this._livePosition = 0;
    }
  }

  _fullVodDuration() {
    return this._vodDuration > this._vodPlaylistDuration
      ? this._vodDuration
      : this._vodPlaylistDuration;
  }

  _totalDuration() {
    return this._fullVodDuration() + this._liveDuration;
  }

  _calcPosition(mode) {
    let fullVodDuration = this._fullVodDuration();
    if (fullVodDuration === 0 && this._liveDuration === 0) {
      return 0;
    }

    let position;
    if (mode === MODE.VOD) {
      position = this._vodPosition / this._totalDuration();
    } else {
      position = (fullVodDuration + this._livePosition) / this._totalDuration();
    }

    // this._logger.debug(
    //   `calc position: ${position}, totalDur = ${this._totalDuration()}, liveDur = ${this._liveDuration}, vodPos = ${this._vodPosition}`,
    // );
    if (position > 1) {
      this._logger.error(
        "position is greater than the whole scale",
        position,
        mode,
      );
      position = 1;
    }

    return position;
  }
}

PlaybackProgressService = multiInstanceService(PlaybackProgressService);
export { PlaybackProgressService };
