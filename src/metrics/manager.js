import LoggersFactory from "@/shared/logger";
import { MetricsStore } from "./store.js";
import { multiInstanceService } from "@/shared/service.js";

class MetricsManager {
  constructor(instanceName) {
    this._instName = instanceName;
    this._logger = LoggersFactory.create(instanceName, "MetricsManager");
    this._metrics = new Map();
  }

  add(id, type) {
    if (undefined !== this._metrics.get(id)) {
      this._logger.error(`metric for ID ${id} already exists. Overwriting.`);
    }
    let m = new MetricsStore(this._instName, id, type);
    this._metrics.set(id, m);
    return m;
  }

  remove(id) {
    let m = this._findMetricFor("remove", id);
    if (!m) return null;

    m.destroy();
    this._metrics.delete(id);
    return m;
  }

  run(id) {
    this._exec("run", id);
  }

  stop(id) {
    this._exec("stop", id);
  }

  reportBandwidth(id, bytes, timestamp) {
    this._exec("reportBandwidth", id, bytes, timestamp);
  }

  reportBufLevel(id, lvl, bufEnd) {
    this._exec("reportBufLevel", id, lvl, bufEnd);
  }

  reportLowBuffer(id) {
    this._exec("reportLowBuffer", id);
  }

  getMetric(id) {
    return this._findMetricFor("getMetric", id);
  }

  _exec(op, id, ...args) {
    let m = this._findMetricFor(op, id);
    if (!m) return;
    m[op](args);
  }

  _findMetricFor(op, id) {
    let m = this._metrics.get(id);
    if (!m) {
      this._logger.error(`${op}: no metric found for ${id} track.`);
      return null;
    }
    return m;
  }
}

MetricsManager = multiInstanceService(MetricsManager);
export { MetricsManager };
