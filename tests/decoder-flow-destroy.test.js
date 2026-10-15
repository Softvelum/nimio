import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DecoderFlowAudio } from "@/media/decoders/flow-audio";

// destroy() owns a worker. Whatever a cleanup step does (the input cancel
// reaches the SLDP manager and the transport, the shutdown reaches the
// metrics and timestamp services and the event bus), the worker must still
// be terminated and the buffer released, or a destroyed player keeps a
// decoder thread alive.
function createFlow() {
  const flow = Object.create(DecoderFlowAudio.prototype);
  flow._logger = { debug: vi.fn(), error: vi.fn() };
  flow._decoder = {
    postMessage: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    terminate: vi.fn(),
  };
  flow._eventBus = { emit: vi.fn() };
  flow._metricsManager = { remove: vi.fn() };
  flow._timestampManager = { removeTrack: vi.fn() };
  flow._trackId = 7;
  flow._type = "audio";
  flow._buffer = { reset: vi.fn() };
  flow._state = { isStopped: () => false };
  flow.onInputCancel = vi.fn();
  flow._addDecoderListener();
  return flow;
}

describe("DecoderFlow.destroy() with a failing cleanup step", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("a throwing input cancel is logged; the worker is still shut down, terminated and the buffer released", () => {
    const flow = createFlow();
    flow._switchContext = { src: true, inputCancelled: false };
    flow.onInputCancel = vi.fn(() => {
      throw new Error("cancelStream boom");
    });

    expect(() => flow.destroy()).not.toThrow();

    expect(flow._logger.error).toHaveBeenCalledTimes(1);
    expect(flow._decoder.postMessage).toHaveBeenCalledWith({
      type: "shutdown",
    });
    expect(flow._buffer).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(flow._decoder).toBeNull();
  });

  it("a throwing shutdown is logged; the worker is still terminated and the buffer released", () => {
    const flow = createFlow();
    const buffer = flow._buffer;
    const decoder = flow._decoder;
    flow._metricsManager.remove = vi.fn(() => {
      throw new Error("metrics boom");
    });

    expect(() => flow.destroy()).not.toThrow();

    expect(flow._logger.error).toHaveBeenCalledTimes(1);
    expect(buffer.reset).toHaveBeenCalledTimes(1);
    expect(flow._buffer).toBeNull();
    expect(flow._trackId).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(decoder.terminate).toHaveBeenCalledTimes(1);
    expect(flow._decoder).toBeNull();
  });

  it("without a failure nothing is logged and the worker is shut down once", () => {
    const flow = createFlow();

    flow.destroy();
    flow.destroy();

    expect(flow._logger.error).not.toHaveBeenCalled();
    expect(flow._decoder.postMessage).toHaveBeenCalledTimes(1);
    expect(flow._buffer).toBeNull();
  });

  // The peer notification runs the main flow's switch-result and
  // decoding-error callbacks, which reach the engine, the facade and finally
  // an application nimio:playback-error listener. A throw anywhere on that chain must not
  // leave this flow marked destroyed with a live worker.
  it("a throwing switch-peer notification is logged; the worker is still shut down and terminated", () => {
    const flow = createFlow(); // the next rendition's flow (src side)
    const main = createFlow(); // the main flow (dst side), paired with it
    main._switchContext = { dst: true, inputCancelled: true };
    main._switchPeerFlow = flow;
    flow._switchContext = { src: true, inputCancelled: true };
    flow._switchPeerFlow = main;
    main.onSwitchResult = () => {
      throw new Error("playback-error listener boom");
    };

    expect(() => flow.destroy()).not.toThrow();

    expect(flow._logger.error).toHaveBeenCalledTimes(1);
    expect(main._switchPeerFlow).toBeNull(); // the pairing was dropped first
    expect(flow._decoder.postMessage).toHaveBeenCalledWith({
      type: "shutdown",
    });
    expect(flow._buffer).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(flow._decoder).toBeNull();
  });
});
