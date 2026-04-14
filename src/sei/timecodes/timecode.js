export class Timecode {
  constructor (numUnitsInTick, timeScale) {
    this.hours = this.minutes = this.seconds = this.nFrames = 0;
    this.numUnitsInTick = numUnitsInTick;
    this.timeScale = timeScale;
  }

  clockTs () {
    return (
      ( ( this.hours * 60 + this.minutes ) * 60 + this.seconds ) * this.timeScale +
      this.nFrames * ( this.numUnitsInTick * ( 1 + this.unitFieldBasedFlag ) ) +
      this.timeOffset
    );
  }

  stringTs () {
    return `${this._padded(this.hours)}:${this._padded(this.minutes)}:${this._padded(this.seconds)}.${this._padded(this.nFrames)} ${this.timeOffset}`;
  }

  _padded (val) {
    return (val < 10) ? '0' + val : val;
  }
}
