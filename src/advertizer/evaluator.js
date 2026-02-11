import { LoggersFactory } from "@/shared/logger";

export class AdvertizerEvaluator {
  constructor(instName, port) {
    this._tracks = {};
    this._switches = {};

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

  handleAction(data) {
    this._logger.debug(`handleAction`, data);
    switch (data.op) {
      case "init-switch":
        break;
      case "main":
        break;
      case "rem":
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

  _portMessageHandler(event) {
    const msg = event.data;
    if (!msg || msg.aux) return;
    if (msg.type === "transp-track-action") {
      this.handleAction(msg.data);
    }
  };
}
