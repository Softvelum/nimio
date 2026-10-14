import { describe, it, expect } from "vitest";
import { PlaybackContext } from "@/playback/context";

function stream(name, height) {
  return {
    stream: name,
    stream_info: {
      resolution: `640x${height}`,
      vcodec: "avc1.42e01e",
      bandwidth: "1000",
      vtimescale: "90000",
    },
  };
}

describe("PlaybackContext.setStreams() concurrency", () => {
  it("a superseded call commits nothing and the newest call wins", async () => {
    const ctx = PlaybackContext.getInstance("ctx-seq");
    const support = { video: { "avc1.42e01e": true }, audio: {} };
    let settleOld;
    ctx._checkSupportedCodecs = () =>
      settleOld
        ? Promise.resolve(support)
        : new Promise((resolve) => (settleOld = () => resolve(support)));

    const old = ctx.setStreams([stream("a", 360), stream("b", 720)]);
    const fresh = ctx.setStreams([stream("c", 480)]);
    await expect(fresh).resolves.toBe(true);
    settleOld();

    await expect(old).resolves.toBe(false);
    expect(ctx.streams.map((s) => s.stream)).toEqual(["c"]);
    expect(ctx.videoRenditions).toHaveLength(1);
    expect(ctx.videoRenditions[0].name).toBe("c");
  });

  it("cancelPendingStreams() makes a pending call commit nothing", async () => {
    const ctx = PlaybackContext.getInstance("ctx-cancel");
    let settle;
    ctx._checkSupportedCodecs = () =>
      new Promise((resolve) => (settle = resolve));

    const pending = ctx.setStreams([stream("a", 360)]);
    ctx.cancelPendingStreams(); // the run was stopped meanwhile
    settle({ video: { "avc1.42e01e": true }, audio: {} });

    await expect(pending).resolves.toBe(false);
    expect(ctx.streams).toHaveLength(0);
  });

  it("a committed call exposes its renditions", async () => {
    const ctx = PlaybackContext.getInstance("ctx-commit");
    ctx._checkSupportedCodecs = async () => ({
      video: { "avc1.42e01e": true },
      audio: {},
    });

    await expect(
      ctx.setStreams([stream("hi", 720), stream("lo", 360)]),
    ).resolves.toBe(true);

    expect(ctx.videoRenditions.map((r) => r.name)).toEqual(["lo", "hi"]);
  });
});
