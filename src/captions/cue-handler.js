export class CueHandler {

  constructor (presenter, capId) {
    this._presenter = presenter;
    this._capId = capId;
  }

  activate () {
    if (!this._activated) {
      this._presenter.activateCaptionTrack(this._capId);
      this._activated = true;
    }
  }

  newCue (startTime, screen) {
    if ((undefined === this._startTime) || this._startTime > startTime) {
      this._startTime = startTime;
    }

    this._screen = screen;
    this._presenter.addCaptions(this._capId, startTime, screen);
  }

  finalizeCue (endTime, isEmpty) {
    if (undefined === this._startTime) {
      return;
    }

    this._presenter.updateCaptions(
      this._capId,
      this._startTime,
      endTime,
      this._screen,
      isEmpty
    );
    this._startTime = undefined;
  }

  reset () {
    this._startTime = undefined;
    this._activated = false;
    this._screen = undefined;
  }
}
