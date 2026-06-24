import { describe, it, expect, beforeEach, vi } from "vitest";
import { StateManager } from "@/state-manager";
import { STATE, IDX } from "@/shared/values";
import { createSharedBuffer } from "@/shared/shared-buffer";

const bufferLength = 20;
const buffer = createSharedBuffer(bufferLength * 4);
const flags = new Uint32Array(buffer);
let manager;
let isShared;

beforeEach(() => {
  flags.fill(0);
});

describe("StateManager", () => {
  beforeEach(() => {
    manager = new StateManager(buffer);
    isShared = manager.isShared();
  });

  it("set and get state correctly", () => {
    manager.start();
    expect(manager.isPlaying()).toBe(true);

    manager.pause();
    expect(manager.isPaused()).toBe(true);

    manager.stop();
    expect(manager.isStopped()).toBe(true);

    manager.value = STATE.PLAYING;
    expect(manager.value).toBe(STATE.PLAYING);
  });

  it("handle silence microseconds counter", () => {
    expect(manager.getSilenceUs()).toBe(0);
    manager.incSilenceUs(500);
    expect(manager.getSilenceUs()).toBe(500);
  });

  it("handle available audio/video and decoder queue/latency setters and getters", () => {
    manager.setAvailableAudioMs(123);
    expect(manager.getAvailableAudioMs()).toBe(123);
    manager.setAvailableVideoMs(456);
    expect(manager.getAvailableVideoMs()).toBe(456);
    manager.setVideoDecoderQueue(5);
    expect(manager.getVideoDecoderQueue()).toBe(5);
    manager.setVideoDecoderLatency(7);
    expect(manager.getVideoDecoderLatency()).toBe(7);
    manager.setAudioDecoderQueue(9);
    expect(manager.getAudioDecoderQueue()).toBe(9);
  });

  it("handle current timestamp sample counter (64-bit)", () => {
    expect(manager.getCurrentTsSmp()).toBe(0);
    manager.incCurrentTsSmp(123);
    expect(manager.getCurrentTsSmp()).toBe(123);
    manager.resetCurrentTsSmp();
    expect(manager.getCurrentTsSmp()).toBe(0);
  });

  it("handle video latest timestamp (64-bit)", () => {
    manager.setVideoLatestTsUs(1234567890123);
    expect(manager.getVideoLatestTsUs()).toBe(1234567890123);
  });

  it("handle playback start timestamp (64-bit)", () => {
    manager.setPlaybackStartTsUs(987654321000);
    expect(manager.getPlaybackStartTsUs()).toBe(987654321000);
  });

  it("handle available audio and video duration in ms", () => {
    manager.setAvailableAudioMs(100);
    expect(manager.getAvailableAudioMs()).toBe(100);
    manager.setAvailableVideoMs(200);
    expect(manager.getAvailableVideoMs()).toBe(200);
  });

  it("handle decoder queue and latency", () => {
    manager.setVideoDecoderQueue(5);
    expect(manager.getVideoDecoderQueue()).toBe(5);
    manager.setVideoDecoderLatency(12);
    expect(manager.getVideoDecoderLatency()).toBe(12);
    manager.setAudioDecoderQueue(7);
    expect(manager.getAudioDecoderQueue()).toBe(7);
  });

  it("throws if 64-bit add overflows", () => {
    const idx = IDX.CURRENT_TS[0];
    flags[idx] = 0xffffffff;
    flags[idx + 1] = 0xffffffff;
    expect(() => manager.incCurrentTsSmp(1)).toThrow(
      "Resulting value exceeds 64 bits",
    );
  });

  it("throws if added value >= 2^32", () => {
    expect(() => manager.incCurrentTsSmp(0x0100000000)).toThrow(
      "Added value must be less than 2^32",
    );
  });

  it("stores and load 64-bit values", () => {
    const timestamp = 2 ** 32 + 42;
    manager.setPlaybackStartTsUs(timestamp);
    expect(manager.getPlaybackStartTsUs()).toBe(timestamp);

    manager.setVideoLatestTsUs(timestamp);
    expect(manager.getVideoLatestTsUs()).toBe(timestamp);
  });

  it("adds correctly without overflow in 64-bit", () => {
    const start = 1000;
    manager.incCurrentTsSmp(start);
    expect(manager.getCurrentTsSmp()).toBe(start);
    manager.incCurrentTsSmp(500);
    expect(manager.getCurrentTsSmp()).toBe(start + 500);
  });

  it("increments currentTs correctly with overflow carry", () => {
    const idx = IDX.CURRENT_TS[0];

    flags[idx] = 0xfffffffe; // near max low 32-bits
    flags[idx + 1] = 0;

    manager.incCurrentTsSmp(3); // this should overflow low and add 1 to high

    const result = manager.getCurrentTsSmp();
    // low: (0xFFFFFFFE + 3) -> 1 with carry, high: 1
    expect(result).toBe(1 + 1 * 0x0100000000);
  });

  it("retries _atomicLoad64 if high parts differ", () => {
    if (!isShared) return;
    const idx = IDX.CURRENT_TS[0];
    let callCount = 0;

    const origLoad = Atomics.load;
    Atomics.load = (arr, index) => {
      if (index === idx + 1 && callCount < 1) {
        callCount++;
        return 1;
      }
      return origLoad(arr, index);
    };

    flags[idx] = 10;
    flags[idx + 1] = 1;

    // Retry and return combined 64-bit number correctly
    const val = manager.getCurrentTsSmp();
    expect(val).toBe(10 + 1 * 0x0100000000);

    Atomics.load = origLoad;
  });

  it("retries _atomicStore64 if compareExchange fails", () => {
    if (!isShared) return;
    const idx = IDX.CURRENT_TS[0];
    let attempts = 0;

    const origCompareExchange = Atomics.compareExchange;
    Atomics.compareExchange = (arr, index, oldVal, newVal) => {
      attempts++;
      if (attempts === 1) {
        return oldVal + 1; // fail first attempt by returning a different value
      }
      if (arr[index] === oldVal) {
        arr[index] = newVal;
        return oldVal;
      }
      return arr[index];
    };

    manager._atomicStore64(IDX.CURRENT_TS, 12345);

    expect(manager.getCurrentTsSmp()).toBe(12345);

    Atomics.compareExchange = origCompareExchange;
  });

  it("retries _atomicAdd64 if compareExchange fails", () => {
    if (!isShared) return;
    const idx = IDX.CURRENT_TS[0];
    let attempts = 0;

    const origCompareExchange = Atomics.compareExchange;
    Atomics.compareExchange = (arr, index, oldVal, newVal) => {
      attempts++;
      if (attempts === 1) {
        return oldVal + 1; // fail first attempt by returning a different value
      }
      if (arr[index] === oldVal) {
        arr[index] = newVal;
        return oldVal;
      }
      return arr[index];
    };

    flags[idx] = 0;
    flags[idx + 1] = 0;

    const newVal = manager._atomicAdd64(IDX.CURRENT_TS, 5);

    expect(newVal).toBe(0);
    expect(manager.getCurrentTsSmp()).toBe(5);

    Atomics.compareExchange = origCompareExchange;
  });

  it("handles multi-thread race condition in getCurrentTsSmp", () => {
    const idx = IDX.CURRENT_TS[0];

    let toggle = false;
    const origLoad = Atomics.load;
    Atomics.load = (arr, index) => {
      if (index === idx + 1 && !toggle) {
        toggle = true;
        return 1;
      }
      return origLoad(arr, index);
    };

    flags[idx] = 100;
    flags[idx + 1] = 1;

    const val = manager.getCurrentTsSmp();
    expect(val).toBe(100 + 1 * 0x0100000000);

    Atomics.load = origLoad;
  });
});

describe("StateManager on PortMessage", () => {
  let onPortMessage;
  let messageChannel;
  let counterManager;
  let postMessageSpy;

  beforeEach(() => {
    onPortMessage = vi.fn();
    messageChannel = new MessageChannel();
    manager = new StateManager(buffer, {shared: false, port: messageChannel.port1});
    counterManager = new StateManager(buffer, { shared: false, port: messageChannel.port2 });
    postMessageSpy = vi.spyOn(messageChannel.port1, 'postMessage')
    postMessageSpy.mockClear();

  });

  it("handle state", () => {
    manager.start();
    expect(postMessageSpy).toBeCalled();
    expect(manager.isPlaying()).toBe(true);
    expect(counterManager.isPlaying()).toBe(true);

    counterManager.pause();
    expect(postMessageSpy).toBeCalled();
    expect(manager.isPaused()).toBe(true);
    expect(counterManager.isPaused()).toBe(true);

    manager.stop();
    expect(postMessageSpy).toBeCalled();
    expect(manager.isStopped()).toBe(true);
    expect(counterManager.isStopped()).toBe(true);

    counterManager.value = STATE.PLAYING;
    expect(postMessageSpy).toBeCalled();
    expect(manager.value).toBe(STATE.PLAYING);
    expect(counterManager.value).toBe(STATE.PLAYING);
  });

  it("handle silence microseconds counter", () => {
    expect(manager.getSilenceUs()).toBe(0);
    
    manager.incSilenceUs(500);
    expect(manager.getSilenceUs()).toBe(500);
    expect(counterManager.getSilenceUs()).toBe(500);
    
    counterManager.incSilenceUs(300);
    expect(manager.getSilenceUs()).toBe(800);
    expect(counterManager.getSilenceUs()).toBe(800);
  });

  it("handle timestamp value", () => {
    expect(manager.getCurrentTsSmp()).toBe(0);
    expect(counterManager.getCurrentTsSmp()).toBe(0);
    postMessageSpy.mockClear();
    manager.incCurrentTsSmp(1000);
    expect(postMessageSpy).toBeCalled();
    counterManager.incCurrentTsSmp(300);
    expect(manager.getCurrentTsSmp()).toBe(1300);
    expect(counterManager.getCurrentTsSmp()).toBe(1300);

    manager.resetCurrentTsSmp();
    expect(manager.getCurrentTsSmp()).toBe(0);
    expect(counterManager.getCurrentTsSmp()).toBe(0);
    expect(postMessageSpy).toBeCalled();
  });

  it("handle available audio/video and decoder queue/latency", () => {
    manager.setAvailableAudioMs(123);
    expect(manager.getAvailableAudioMs()).toBe(123);
    expect(counterManager.getAvailableAudioMs()).toBe(123);

    counterManager.setAvailableVideoMs(456);
    expect(manager.getAvailableVideoMs()).toBe(456);
    expect(counterManager.getAvailableVideoMs()).toBe(456);

    counterManager.setVideoDecoderQueue(5);
    expect(manager.getVideoDecoderQueue()).toBe(5);
    expect(counterManager.getVideoDecoderQueue()).toBe(5);
    
    manager.setVideoDecoderLatency(7);
    expect(manager.getVideoDecoderLatency()).toBe(7);
    expect(counterManager.getVideoDecoderLatency()).toBe(7);

    manager.setAudioDecoderQueue(9);
    expect(manager.getAudioDecoderQueue()).toBe(9);
    expect(counterManager.getAudioDecoderQueue()).toBe(9);
  })

  it("handle minBuffer and speed", () => {
    counterManager.setMinBufferMs("short", 300);
    counterManager.setMinBufferMs("long", 700);
    expect(manager.getMinBufferMs("short")).toBe(300)
    expect(manager.getMinBufferMs("long")).toBe(700)
    expect(counterManager.getMinBufferMs("short")).toBe(300)
    expect(counterManager.getMinBufferMs("long")).toBe(700)

    manager.setCurrentSpeed(1.5)
    expect(manager.getCurrentSpeed()).toBe(15000)
    expect(counterManager.getCurrentSpeed()).toBe(15000)
    counterManager.setCurrentSpeed(0.8)
    expect(manager.getCurrentSpeed()).toBe(8000)
    expect(counterManager.getCurrentSpeed()).toBe(8000)
  });  

});

