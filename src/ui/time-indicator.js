export class UITimeIndicator {
  constructor(instName) {
    this._instName = instName;
    this._create();
  }

  destroy() {
    this._inst = this._curTime = this._durTime = undefined;
  }

  node() {
    return this._inst;
  }

  update(cur, total) {
    if (cur !== undefined) {
      this._curTime.textContent = Utils.secondsToHumanClock(cur, "--");
    }
    if (total !== undefined) {
      this._durTime.textContent = Utils.secondsToHumanClock(total, "--");
    }
    this._inst.style.display = "inline-block";
  }

  _create() {
    if (this._inst) return;

    this._inst = document.createElement("div");
    this._inst.className = "sldp-time-ind-wrp";
    this._inst.style.display = "none";
    let timeWrp = document.createElement("span");
    timeWrp.className = "sldp-time-ind";

    this._curTime = document.createElement("span");
    this._curTime.className = "sldp-time-cur";
    this._curTime.textContent = "--";

    let sep = document.createElement("span");
    sep.className = "sldp-time-sep";
    sep.textContent = " / ";

    this._durTime = document.createElement("span");
    this._durTime.className = "sldp-time-dur";
    this._durTime.textContent = "--";

    timeWrp.appendChild(this._curTime);
    timeWrp.appendChild(sep);
    timeWrp.appendChild(this._durTime);
    this._inst.appendChild(timeWrp);
  }
}
