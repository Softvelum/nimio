export class WorkletLogReceiver {
  constructor(enabled) {
    this._enabled = enabled;
    this._worklets = [];
  }

  add(worklet) {
    if (!this._enabled) return false;

    for (let i = 0; i < this._worklets.length; i++) {
      if (Object.is(this._worklets[i].inst, worklet)) {
        return false;
      }
    }
    this._worklets.push({ inst: worklet, onmsg: worklet.port.onmessage });

    let exMsgHandler = worklet.port.onmessage;
    worklet.port.onmessage = function (ev) {
      let msg = ev.data;
      if (msg?.log) {
        console[msg.lf].apply(console, msg.args);
        return;
      }
      if (exMsgHandler) exMsgHandler(ev);
    };
    return true;
  }

  reset() {
    if (!this._enabled) return;

    for (let i = 0; i < this._worklets.length; i++) {
      this._worklets[i].inst.port.onmessage = this._worklets[i].onmsg;
    }
    this._worklets.length = 0;
  }
}
