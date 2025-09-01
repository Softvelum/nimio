import LoggersFactory from "@/shared/logger";
import { MetricsStore } from "./metric.js";

export class MetricsManager {
  constructor(instanceName) {
    this._instName = instanceName;
    this._logger = LoggersFactory.create(instanceName, "MetricsManager");
    this._metrics = new Map();
  }

  add(id, type, timescale) {
    if (undefined !== this._metrics.get(id)) {
      this._logger.error(`metric for ID ${id} already exists. Overwriting.`);
    }
    let m = new MetricsStore(this._instName, id, type, timescale);
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

  setParams(lowBufferThresholdSec = 0.5, bucketSizeMs = 250, maxWindowMs = 5000) {
    this.lowBufferThresholdSec = lowBufferThresholdSec;
    this.bucketSizeMs = bucketSizeMs;
    this.maxWindowMs = maxWindowMs;
    this.windows = [500, 1000, 5000, Infinity]; // reporting windows

    this.streams = new Map(); // streamId -> { buckets: [], startTime: number }
  }

  _getStream(streamId) {
    if (!this.streams.has(streamId)) {
      this.streams.set(streamId, {
        buckets: [], // { startMs, bytes, timestampsUs: [], buffers: [], arrivals: [] }
        startTime: performance.now()
      });
    }
    return this.streams.get(streamId);
  }

  addFrame(streamId, { sizeBytes, timestampUs, bufferLevelSec }) {
    const nowMs = performance.now();
    const stream = this._getStream(streamId);

    // Find or create current bucket
    const bucketStart = nowMs - (nowMs % this.bucketSizeMs);
    let bucket = stream.buckets.find(b => b.startMs === bucketStart);
    if (!bucket) {
      bucket = { startMs: bucketStart, bytes: 0, timestampsUs: [], buffers: [], arrivals: [] };
      stream.buckets.push(bucket);

      // Clean old buckets
      const cutoff = nowMs - this.maxWindowMs;
      stream.buckets = stream.buckets.filter(b => b.startMs >= cutoff);
    }

    // Update bucket
    bucket.bytes += sizeBytes;
    bucket.timestampsUs.push(timestampUs);
    bucket.buffers.push(bufferLevelSec);
    bucket.arrivals.push(nowMs);
  }

  _computeMetricsForWindow(stream, windowMs, nowMs) {
    let buckets = stream.buckets;
    if (windowMs !== Infinity) {
      const cutoff = nowMs - windowMs;
      buckets = buckets.filter(b => b.startMs >= cutoff);
    }
    if (buckets.length === 0) {
      return {
        bandwidthBps: 0,
        rateBps: 0,
        avgBufferSec: 0,
        lowBufferCount: 0,
        jitterMs: 0,
        bufferPercentiles: {}
      };
    }

    // Bandwidth
    const totalBytes = buckets.reduce((a, b) => a + b.bytes, 0);
    const spanMs = (buckets[buckets.length - 1].startMs - buckets[0].startMs) || 1;
    const bandwidthBps = (totalBytes * 1000) / spanMs;

    // Rate (timestamps span)
    const allTs = buckets.flatMap(b => b.timestampsUs);
    const tsSpanUs = (Math.max(...allTs) - Math.min(...allTs)) || 1;
    const rateBps = (totalBytes * 1e6) / tsSpanUs;

    // Buffers
    const allBufs = buckets.flatMap(b => b.buffers);
    const avgBufferSec = allBufs.reduce((a, x) => a + x, 0) / allBufs.length;
    const lowBufferCount = allBufs.filter(x => x < this.lowBufferThresholdSec).length;

    // Jitter (stddev of inter-arrival times)
    const allArrivals = buckets.flatMap(b => b.arrivals);
    let jitterMs = 0;
    if (allArrivals.length > 1) {
      const deltas = [];
      for (let i = 1; i < allArrivals.length; i++) {
        deltas.push(allArrivals[i] - allArrivals[i - 1]);
      }
      const mean = deltas.reduce((a, d) => a + d, 0) / deltas.length;
      const variance = deltas.reduce((a, d) => a + (d - mean) ** 2, 0) / deltas.length;
      jitterMs = Math.sqrt(variance);
    }

    // Percentiles of buffer levels
    const sortedBufs = [...allBufs].sort((a, b) => a - b);
    const percentile = (p) => {
      if (sortedBufs.length === 0) return 0;
      const idx = Math.floor(p / 100 * (sortedBufs.length - 1));
      return sortedBufs[idx];
    };
    const bufferPercentiles = {
      p50: percentile(50),
      p95: percentile(95)
    };

    return {
      bandwidthBps,
      rateBps,
      avgBufferSec,
      lowBufferCount,
      jitterMs,
      bufferPercentiles
    };
  }

  getAllMetrics(streamId = null) {
    const nowMs = performance.now();
    const results = {};
    const streams = streamId ? [[streamId, this._getStream(streamId)]] : Array.from(this.streams);

    for (const [id, stream] of streams) {
      results[id] = {};
      for (const w of this.windows) {
        results[id][w === Infinity ? "all" : `${w}ms`] =
          this._computeMetricsForWindow(stream, w, nowMs);
      }
    }

    // Aggregate across streams
    if (!streamId && streams.length > 1) {
      results["all_streams"] = {};
      for (const w of this.windows) {
        const winKey = w === Infinity ? "all" : `${w}ms`;
        let agg = {
          bandwidthBps: 0, rateBps: 0, avgBufferSec: 0,
          lowBufferCount: 0, jitterMs: 0,
          bufferPercentiles: { p50: 0, p95: 0 }
        };
        let count = 0;
        for (const [id, stream] of streams) {
          const m = this._computeMetricsForWindow(stream, w, nowMs);
          agg.bandwidthBps += m.bandwidthBps;
          agg.rateBps += m.rateBps;
          agg.avgBufferSec += m.avgBufferSec;
          agg.lowBufferCount += m.lowBufferCount;
          agg.jitterMs += m.jitterMs;
          agg.bufferPercentiles.p50 += m.bufferPercentiles.p50;
          agg.bufferPercentiles.p95 += m.bufferPercentiles.p95;
          count++;
        }
        if (count > 0) {
          agg.avgBufferSec /= count;
          agg.jitterMs /= count;
          agg.bufferPercentiles.p50 /= count;
          agg.bufferPercentiles.p95 /= count;
        }
        results["all_streams"][winKey] = agg;
      }
    }
    return results;
  }
}
