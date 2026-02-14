import { LoggersFactory } from "@/shared/logger";

export class AdvertizerEvaluator {
  #types = [];
  #confIvalUs = 2_000_000;

  constructor(instName, port) {
    this._tracks = {};
    this._switches = {};
    this._swCnt = 0;

    if (port) {
      port.addEventListener("message", this._portMessageHandler.bind(this));
      port.postMessage("transp-discont-eval-ready");
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

    let res = 0;
    let preMatches = [];
    let win = [Infinity, 0];
    let del = {};
    for (let j = 0; j < this.#types.length; j++) {
      let trackId = this._tracks[this.#types[j]];
      let switches = this._switches[trackId];
      if (!switches) {
        this._logger.debug(`No switches for ${this.#types[j]}`);
        break;
      }

      for (let i = 0; i < switches.length; i++) {
        if (switches[i].to < curTsUs) {
          this._logger.debug(
            `Skip switch ${this.#types[j]}, Cur ts = ${curTsUs}, to = ${switches[i].to}`,
          );
          del[trackId] = i;
          continue;
        }
        if (switches[i].from - curTsUs > this.#confIvalUs) {
          this._logger.debug(
            `Switch ${this.#types[j]} is yet far ${(switches[i].from - curTsUs) / 1000}. Cur ts = ${curTsUs}, from = ${switches[i].from}`,
          );
          break;
        }
        if (win[0] > switches[i].from) win[0] = switches[i].from;
        if (win[1] < switches[i].to) win[1] = switches[i].to;
        preMatches.push(i);
      }
    }
    if (preMatches.length === this.#types.length && win[0] - curTsUs < 3_000) {
      win[1] += 150_000;
      let delta = win[1] - curTsUs;
      this._logger.debug(`Switch delta is ${delta / 1000}ms, curTs = ${curTsUs/1000}, to = ${win[1] / 1000}, from = ${win[0] / 1000}`);
      if (delta + this._bufToKeep <= availUs) {
        for (let j = 0; j < this.#types.length; j++) {
          let switches = this._switches[this._tracks[this.#types[j]]];
          switches.splice(0, preMatches[j] + 1);
          this._logger.debug(
            `Remove ${this.#types[j]} switches till ${preMatches[j] + 1}. Cur ts = ${curTsUs}. Left ${switches.length}`,
          );
        }
        del = null;
        // res = delta + availUs - this._bufToKeep;
        res = delta;
        this._logger.debug(`Going to seek by ${res/1000} to ${win[1] / 1000}`);
      } else {
        this._logger.debug(`Not enough buffer to switch delta = ${delta/1000}ms, availMs = ${availUs/1000}`);
      }
    }
    if (del) {
      for (let tId in del) {
        this._switches[tId].splice(0, del[tId] + 1);
        this._logger.debug(
          `Remove ${tId} switches till ${del[tId] + 1}. Cur ts = ${curTsUs}. Left ${this._switches[tId].length}`,
        );
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
    this._bufToKeep = Math.min(valUs, 200_000);
  }

  _portMessageHandler(event) {
    const msg = event.data;
    if (!msg || msg.aux) return;
    if (msg.type === "transp-track-action") {
      this.handleAction(msg.data);
    }
  }
}
