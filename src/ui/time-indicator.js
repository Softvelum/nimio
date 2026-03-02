import { secondsToHumanClock } from "@/shared/time-helpers";

export class UITimeIndicator {
  constructor(instName, wrp) {
    this._instName = instName;
    this._parentWrp = wrp;
    this._create();
  }

  destroy() {
    this._parentWrp = this._inst = this._curTime = this._durTime = undefined;
  }

  update(cur, total) {
    if (cur !== undefined) {
      this._curTime.textContent = secondsToHumanClock(cur, "--");
    }
    if (total !== undefined) {
      this._durTime.textContent = secondsToHumanClock(total, "--");
    }
    this._inst.style.display = "inline-block";
  }

  _create() {
    if (this._inst) return;

    this._inst = this._parentWrp.querySelector(".time-ind-wrp");
    this._curTime = this._parentWrp.querySelector(".time-cur");
    this._durTime = this._parentWrp.querySelector(".time-dur");
    this._curTime.textContent = "--";
    this._durTime.textContent = "--";
  }
}
