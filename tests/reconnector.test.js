import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Reconnector } from "@/reconnector";
import { EventBus } from "@/event-bus";
import { releaseInstances } from "@/shared/service";

// The live engine destroys its reconnector: the bus subscription that resets
// the attempt counter must go, and a reconnect already scheduled must never
// call play() on the destroyed engine.
describe("Reconnector.destroy()", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    releaseInstances("rc-1");
    releaseInstances("rc-2");
  });

  it("removes its connection-established subscription", () => {
    const bus = EventBus.getInstance("rc-1");
    const rc = new Reconnector("rc-1", 3);
    expect(bus.listenerCount("nimio:connection-established")).toBe(1);

    rc.destroy();

    expect(bus.listenerCount("nimio:connection-established")).toBe(0);
  });

  it("cancels a scheduled reconnect", () => {
    const rc = new Reconnector("rc-2", 3);
    const cb = vi.fn();
    expect(rc.schedule(cb)).toBe(true);

    rc.destroy();
    vi.advanceTimersByTime(5000);

    expect(cb).not.toHaveBeenCalled();
  });
});
