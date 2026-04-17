import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlaybackSegmentTracker } from "@/playback/segment-tracker";

describe("PlaybackSegmentTracker", () => {
  const instanceId = "test-instance";

  beforeEach(() => {
    vi.resetModules();
  });

  function createSegments(arr) {
    return arr.map((s, i) => ({ ...s, programDateTime: i + 1 }));
  }

  it("returns null and logs error if no instanceId is provided", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const tracker = PlaybackSegmentTracker.getInstance();

    expect(tracker).toBeNull();
    expect(spy).toHaveBeenCalled();

    spy.mockRestore();
  });

  it("creates and reuses instances per instanceId", () => {
    const t1 = PlaybackSegmentTracker.getInstance("a");
    const t2 = PlaybackSegmentTracker.getInstance("a");
    const t3 = PlaybackSegmentTracker.getInstance("b");

    expect(t1).toBe(t2);
    expect(t1).not.toBe(t3);
  });

  it("isSetUp returns false when no segments", () => {
    const tracker = PlaybackSegmentTracker.getInstance(instanceId);
    expect(tracker.isSetUp()).toBeFalsy();
  });

  it("isSetUp returns true when segments exist", () => {
    const tracker = PlaybackSegmentTracker.getInstance(instanceId + "-setup");
    tracker.setup(createSegments([{ start: 0, duration: 10 }]));

    expect(tracker.isSetUp()).toBeTruthy();
  });

  it("setup ignores invalid segments (empty array)", () => {
    const tracker = PlaybackSegmentTracker.getInstance(instanceId + "-empty");
    tracker.setup([]);

    expect(tracker.isSetUp()).toBeFalsy();
  });

  it("setup ignores segments with invalid programDateTime", () => {
    const tracker = PlaybackSegmentTracker.getInstance(instanceId + "-invalid");
    tracker.setup([{ start: 0, duration: 10, programDateTime: 0 }]);

    expect(tracker.isSetUp()).toBeFalsy();
  });

  it("setup resets segments on invalid setup", () => {
    const tracker = PlaybackSegmentTracker.getInstance(instanceId + "-setup");
    tracker.setup(createSegments([{ start: 0, duration: 10 }]));

    tracker.setup([{ start: 0, duration: 10, programDateTime: 0 }]);
    expect(tracker.isSetUp()).toBeFalsy();
  });

  it("setup sorts segments if not sorted", () => {
    const tracker = PlaybackSegmentTracker.getInstance(
      instanceId + "-unsorted",
    );

    const segments = createSegments([
      { start: 20, duration: 5 },
      { start: 0, duration: 5 },
      { start: 10, duration: 5 },
    ]);

    tracker.setup(segments);

    const result = tracker.get(2);
    expect(result?.start).toBe(0);
  });

  it("setup keeps segments if already sorted", () => {
    const tracker = PlaybackSegmentTracker.getInstance(instanceId + "-sorted");

    const segments = createSegments([
      { start: 0, duration: 5 },
      { start: 10, duration: 5 },
    ]);

    tracker.setup(segments);

    const result = tracker.get(1);
    expect(result?.start).toBe(0);
  });

  it("get returns undefined if not set up", () => {
    const tracker = PlaybackSegmentTracker.getInstance(
      instanceId + "-no-setup",
    );
    expect(tracker.get(5)).toBeUndefined();
  });

  it("get finds segment in middle (binary search hit)", () => {
    const tracker = PlaybackSegmentTracker.getInstance(instanceId + "-middle");

    tracker.setup(
      createSegments([
        { start: 0, duration: 5 },
        { start: 10, duration: 5 },
        { start: 20, duration: 5 },
      ]),
    );

    const result = tracker.get(12);
    expect(result?.start).toBe(10);
  });

  it("get searches left branch", () => {
    const tracker = PlaybackSegmentTracker.getInstance(instanceId + "-left");

    tracker.setup(
      createSegments([
        { start: 0, duration: 5 },
        { start: 10, duration: 5 },
        { start: 20, duration: 5 },
      ]),
    );

    const result = tracker.get(2);
    expect(result?.start).toBe(0);
  });

  it("get searches right branch", () => {
    const tracker = PlaybackSegmentTracker.getInstance(instanceId + "-right");

    tracker.setup(
      createSegments([
        { start: 0, duration: 5 },
        { start: 10, duration: 5 },
        { start: 20, duration: 5 },
      ]),
    );

    const result = tracker.get(22);
    expect(result?.start).toBe(20);
  });

  it("get returns undefined when time is outside all segments", () => {
    const tracker = PlaybackSegmentTracker.getInstance(instanceId + "-miss");

    tracker.setup(
      createSegments([
        { start: 0, duration: 5 },
        { start: 10, duration: 5 },
      ]),
    );

    expect(tracker.get(6)).toBeUndefined();
    expect(tracker.get(100)).toBeUndefined();
  });

  it("get respects segment boundaries (inclusive start, exclusive end)", () => {
    const tracker = PlaybackSegmentTracker.getInstance(
      instanceId + "-boundary",
    );

    tracker.setup(createSegments([{ start: 0, duration: 10 }]));

    expect(tracker.get(0)).toBeTruthy(); // inclusive
    expect(tracker.get(9)).toBeTruthy(); // inside
    expect(tracker.get(10)).toBeUndefined(); // exclusive end
  });
});
