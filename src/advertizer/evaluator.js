import { LoggersFactory } from "@/shared/logger";

export class AdvertizerEvaluator {
  #types = [];

  constructor(instName, port) {
    this._tracks = {};
    this._switches = {};
    this._swCnt = 0;

    if (port) {
      port.addEventListener("message", this._portMessageHandler.bind(this));
    } else {
      this._pendingActions = [];
    }

    this._logger = LoggersFactory.create(instName, "Advertizer Eval", port);
  }

  reset() {
    this.clearPendingActions();
  }

  isApplicable() {
    return this._swCnt > 0;
  }

  computeShift(curTsUs, availUs) {
    // skip for a while if a track is being switched
    if (this._tracks.video === null || this._tracks.audio === null) return 0;

    // debugger;
    let res = 0;
    let shiftPos = 0;
    let matches = [];
    for (let j = 0; j < this.#types.length; j++) {
      let switches = this._switches[ this._tracks[ this.#types[j] ] ];
      for (let i = 0; i < switches.length; i++) {
        if (switches[i].from > curTsUs) break;
        if (switches[i].to < curTsUs) continue;
        if (switches[i].to > shiftPos) shiftPos = switches[i].to;
        matches.push(i);
      }
    }
    if (matches.length === this.#types.length) {
      let delta = shiftPos - curTsUs;
      if (delta + this._bufToKeep <= availUs) {
        for (let j = 0; j < this.#types.length; j++) {
          let switches = this._switches[ this._tracks[ this.#types[j] ] ];
          switches.splice(0, matches[j] + 1);
        }
        res = delta;
      }
    }

    return res;
  }

  handleAction(data) {
    this._logger.debug(`handleAction`, data);
    switch (data.op) {
      case "init-switch":
        if (!this._switches[data.id]) {
          this._switches[data.id] = [];
        }
        this._switches[data.id].push({
          from: data.data.fromPtsUs,
          to: data.data.toPtsUs,
        });
        this._swCnt++;
        break;
      case "main":
        this._tracks[data.type] = data.id;
        if (!this.#types.includes(data.type)) {
          this.#types.push(data.type);
        }
        break;
      case "rem":
        if (this._switches[data.id]) {
          this._swCnt -= this._switches[data.id].length;
        }
        this._switches[data.id] = undefined;
        if (this._tracks[data.type] === data.id) {
          this._tracks[data.type] = null;
        }
        break;
      default:
        this._logger.error(`Unknown action ${data.op}`);
        break;
    }
  }

  hasPendingActions() {
    return !!this._pendingActions && this._pendingActions.length > 0;
  }

  clearPendingActions() {
    if (this._pendingActions) this._pendingActions.length = 0;
  }

  get pendingActions() {
    return this._pendingActions;
  }

  set bufferToKeep(valUs) {
    this._bufToKeep = Math.min(200_000, valUs);
  }

  _portMessageHandler(event) {
    const msg = event.data;
    if (!msg || msg.aux) return;
    if (msg.type === "transp-track-action") {
      this.handleAction(msg.data);
    }
  }
}
