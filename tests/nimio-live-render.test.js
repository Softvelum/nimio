import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NimioLive } from "@/nimio-live";
import { MODE } from "@/shared/values";

// The render loop's first drawn frame emits nimio:playback-start. An
// application listener may stop or destroy the player from there, or throw;
// the popped frame must still be closed and nothing must touch a cleared UI.
function createRenderer() {
  const live = Object.create(NimioLive.prototype);
  const flags = { stopped: false };
  const frame = { close: vi.fn() };
  live._logger = { error: vi.fn(), debug: vi.fn() };
  live._noVideo = false;
  live._state = {
    isPlaying: () => !flags.stopped,
    isStopped: () => flags.stopped,
  };
  live._audioWorkletReady = true;
  live._playbackStartTsUs = 1;
  live._speed = 1;
  live._audioCtxProvider = { isSuspended: () => true };
  live._latencyCtrl = {
    incCurrentVideoTime: () => 1000,
    isPending: () => false,
  };
  live._updateBufferLevelMetrics = vi.fn();
  live._videoBuffer = { popFrameForTime: vi.fn(() => frame) };
  live._playGen = 0;
  live._playbackStarted = false;
  live._eventBus = { emit: vi.fn() };
  live._grabber = {
    start: vi.fn(),
    isNeedFrame: () => false,
    handleLiveFrame: vi.fn(),
  };
  live._offscreenCanvas = false;
  live._ui = { drawFrame: vi.fn() };
  return { live, flags, frame };
}

describe("NimioLive first rendered frame", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("emits nimio:playback-start, starts the grabber once and draws the frame", () => {
    const { live, frame } = createRenderer();

    live._renderVideoFrame(live._playGen);
    live._renderVideoFrame(live._playGen);

    expect(live._eventBus.emit).toHaveBeenCalledTimes(1);
    expect(live._eventBus.emit).toHaveBeenCalledWith("nimio:playback-start", {
      mode: MODE.LIVE,
    });
    expect(live._grabber.start).toHaveBeenCalledTimes(1);
    expect(live._grabber.start).toHaveBeenCalledWith(MODE.LIVE);
    expect(live._ui.drawFrame).toHaveBeenCalledTimes(2);
    expect(frame.close).toHaveBeenCalledTimes(2);
  });

  it("a listener that destroys the player: the frame is closed, nothing drawn, no grabber", () => {
    const { live, flags, frame } = createRenderer();
    live._eventBus.emit = vi.fn(() => {
      live._destroyed = true; // what destroy() does first
      flags.stopped = true;
    });

    expect(live._renderVideoFrame(live._playGen)).toBe(false);

    expect(frame.close).toHaveBeenCalledTimes(1);
    expect(live._ui.drawFrame).not.toHaveBeenCalled();
    expect(live._grabber.start).not.toHaveBeenCalled();
  });

  it("a listener that stops the player: the frame is closed, nothing drawn, no grabber", () => {
    const { live, flags, frame } = createRenderer();
    live._eventBus.emit = vi.fn(() => (flags.stopped = true));

    expect(live._renderVideoFrame(live._playGen)).toBe(false);

    expect(frame.close).toHaveBeenCalledTimes(1);
    expect(live._ui.drawFrame).not.toHaveBeenCalled();
    expect(live._grabber.start).not.toHaveBeenCalled();
  });

  it("a throwing listener is logged and the frame is still drawn and closed", () => {
    const { live, frame } = createRenderer();
    live._eventBus.emit = vi.fn(() => {
      throw new Error("listener boom");
    });

    expect(() => live._renderVideoFrame(live._playGen)).not.toThrow();

    expect(live._logger.error).toHaveBeenCalledTimes(1);
    expect(live._logger.error.mock.calls[0][1].message).toBe("listener boom");
    expect(live._ui.drawFrame).toHaveBeenCalledTimes(1);
    expect(frame.close).toHaveBeenCalledTimes(1);
    expect(live._grabber.start).toHaveBeenCalledTimes(1);
  });

  it("a throwing listener that also stopped the player: the frame is closed, nothing drawn", () => {
    const { live, flags, frame } = createRenderer();
    live._eventBus.emit = vi.fn(() => {
      flags.stopped = true;
      throw new Error("listener boom");
    });

    expect(live._renderVideoFrame(live._playGen)).toBe(false);

    expect(frame.close).toHaveBeenCalledTimes(1);
    expect(live._ui.drawFrame).not.toHaveBeenCalled();
  });

  it("the loop ends on a destroyed engine without scheduling another frame", () => {
    const { live } = createRenderer();
    live._destroyed = true;

    expect(live._renderVideoFrame(live._playGen)).toBe(true);

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(live._ui.drawFrame).not.toHaveBeenCalled();
  });

  it("a listener that stops and restarts playback: the frame is closed, nothing drawn", () => {
    const { live, frame } = createRenderer();
    live._eventBus.emit = vi.fn(() => {
      // stop() + play(): the state is playing again, only the generation
      // moved (what _resetPlayback() and the new loop start do)
      live._playGen++;
    });

    expect(live._renderVideoFrame(live._playGen)).toBe(false);

    expect(frame.close).toHaveBeenCalledTimes(1);
    expect(live._ui.drawFrame).not.toHaveBeenCalled();
    expect(live._grabber.start).not.toHaveBeenCalled();
  });

  it("a callback of a superseded loop exits without scheduling or popping", () => {
    const { live } = createRenderer();
    live._playGen = 3;

    expect(live._renderVideoFrame(2)).toBe(true);

    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(live._videoBuffer.popFrameForTime).not.toHaveBeenCalled();
  });
});
