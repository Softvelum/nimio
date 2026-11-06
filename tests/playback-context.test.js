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

describe("PlaybackContext VOD levels remember their source", () => {
  it("levelsSourceUrl is the master playlist the levels came from", () => {
    const ctx = PlaybackContext.getInstance("ctx-levels-source");
    expect(ctx.levelsSourceUrl).toBeUndefined();

    ctx.setLevels(
      [{ url: ["https://a.test/old/720p/playlist.m3u8"], height: 720 }],
      "https://a.test/old/playlist.m3u8",
    );

    expect(ctx.levelsSourceUrl).toBe("https://a.test/old/playlist.m3u8");
  });
});

describe("PlaybackContext.setLevels() current level validity", () => {
  function levels(n, base) {
    return Array.from({ length: n }, (_, i) => ({
      url: [`${base}/${(i + 1) * 360}p/playlist.m3u8`],
      height: (i + 1) * 360,
    }));
  }

  // A stream URL change resets the current configuration while the old
  // live metadata is still present, so neither the stream mapping nor the
  // VOD-only fallback picks a level; a selection index from the previous
  // archive must not survive a replacement with fewer levels.
  it("falls back to a valid level when the replacement has fewer levels", () => {
    const ctx = PlaybackContext.getInstance("ctx-fewer-levels");
    ctx._ordRenditions = [{}]; // live metadata of the previous stream
    ctx._curConf = []; // reset by setSourceUrl() of the new URL
    ctx.setLevels(levels(3, "https://a.test/old"), "https://a.test/old/p.m3u8");
    ctx.setCurrentLevelIdx(2);

    ctx.setLevels(levels(1, "https://a.test/new"), "https://a.test/new/p.m3u8");

    expect(ctx.getCurrentLevel()).toBeDefined();
    expect(ctx.getCurrentLevel().idx).toBe(0);
  });

  it("keeps a selection that is still valid", () => {
    const ctx = PlaybackContext.getInstance("ctx-kept-level");
    ctx._ordRenditions = [{}];
    ctx._curConf = [];
    ctx.setLevels(levels(3, "https://a.test/old"), "https://a.test/old/p.m3u8");
    ctx.setCurrentLevelIdx(1);

    ctx.setLevels(levels(3, "https://a.test/new"), "https://a.test/new/p.m3u8");

    expect(ctx.getCurrentLevel().idx).toBe(1);
  });
});
