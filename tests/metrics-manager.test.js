import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetricsManager } from "@/metrics/manager";

describe("MetricsManager.destroy()", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("stops every store's interval and forgets the stores", () => {
    const mgr = MetricsManager.getInstance("mm-destroy");
    mgr.add(1, "video");
    mgr.add(2, "audio");
    mgr.run(1);
    mgr.run(2);
    expect(vi.getTimerCount()).toBe(2);

    mgr.destroy();

    expect(vi.getTimerCount()).toBe(0);
    expect(mgr.getMetric(1)).toBeNull();
    expect(mgr.getMetric(2)).toBeNull();
    expect(() => mgr.destroy()).not.toThrow();
  });
});
