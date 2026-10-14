import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NimioLive } from "@/nimio-live";
import { STATE } from "@/shared/values";

// attach() runs after a VOD detach handed the UI back to the live player.
// A connected transport is the preserved server session; it must be reused
// regardless of the state recorded at detach time, otherwise a second session
// is opened (wrong viewer statistics) and the first one is left dangling.

function createLive({ connected, savedState }) {
  const live = Object.create(NimioLive.prototype);
  live._config = { streamUrl: "wss://example.test/live", startOffset: 0 };
  live._transport = { connected };
  live._context = { state: { value: savedState } };
  live._sldpManager = {
    requestCurrentStreams: vi.fn(),
    start: vi.fn(),
    sessionReady: true,
  };
  live._state = { start: vi.fn(), isStopped: () => false };
  live._latencyCtrl = { start: vi.fn() };
  live._isAutoAbr = () => false;
  live._attachUI = vi.fn();
  live._renderVideoFrame = () => {};
  return live;
}

describe("NimioLive.attach() connection reuse", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses a connected transport even when the saved state is PAUSED", () => {
    const live = createLive({ connected: true, savedState: STATE.PAUSED });

    expect(live.attach({}, { latency: 0 })).toBe(true);

    expect(live._sldpManager.requestCurrentStreams).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).not.toHaveBeenCalled();
  });

  it("reuses a connected transport when the saved state is PLAYING", () => {
    const live = createLive({ connected: true, savedState: STATE.PLAYING });

    live.attach({}, { latency: 0 });

    expect(live._sldpManager.requestCurrentStreams).toHaveBeenCalledTimes(1);
    expect(live._sldpManager.start).not.toHaveBeenCalled();
  });

  it("handshakes again when the session's metadata never committed", () => {
    // connected, but a detach cancelled the pending status commit: the context
    // is empty, so reusing the socket would request nothing
    const live = createLive({ connected: true, savedState: STATE.PLAYING });
    live._sldpManager.sessionReady = false;

    live.attach({}, { latency: 0 });

    expect(live._sldpManager.start).toHaveBeenCalledWith(
      "wss://example.test/live",
      0,
    );
    expect(live._sldpManager.requestCurrentStreams).not.toHaveBeenCalled();
  });

  it("starts a new connection when the transport is disconnected", () => {
    const live = createLive({ connected: false, savedState: STATE.PAUSED });

    live.attach({}, { latency: 0 });

    expect(live._sldpManager.start).toHaveBeenCalledWith(
      "wss://example.test/live",
      0,
    );
    expect(live._sldpManager.requestCurrentStreams).not.toHaveBeenCalled();
  });
});
