import { describe, it, expect, vi, afterEach } from "vitest";
import { PlaybackProgressService } from "@/playback/progress-service";
import { releaseInstances } from "@/shared/service";
import { MODE } from "@/shared/values";

// A seek through the progress proxy is clamped to the VOD duration the
// service knows. After a stream URL change that duration belongs to the
// old archive until the new playlist arrives; a seek in that window must
// pass through unclamped instead of landing at the old archive's end.
describe("PlaybackProgressService VOD duration after a URL change", () => {
  const NAME = "progress-url-change";

  afterEach(() => {
    releaseInstances(NAME);
  });

  function createService() {
    const svc = PlaybackProgressService.getInstance(NAME);
    svc._extProgressNotifier = { vodProgress: vi.fn() };
    const positions = [];
    svc.positionChangeCb = (mode, pos) => {
      positions.push([mode, pos]);
      return true;
    };
    return { svc, positions };
  }

  it("clamps a seek to a known VOD duration", () => {
    const { svc, positions } = createService();
    svc.updateVodPlaylistDuration(10);

    svc.updateVodPosition(600);

    expect(positions).toEqual([[MODE.VOD, 10]]);
  });

  it("passes a seek through once the duration was reset for a new source", () => {
    const { svc, positions } = createService();
    svc.updateVodPlaylistDuration(10);

    svc.resetVodDuration();
    svc.updateVodPosition(700);

    expect(positions).toEqual([[MODE.VOD, 700]]);
  });

  it("the reset tells the external progress listener and the time indicator", () => {
    // an application's own progress display must not keep the old
    // archive's duration until the new playlist arrives
    const { svc } = createService();
    svc._timeIndUI = { update: vi.fn() };
    svc.updateVodPlaylistDuration(10);
    svc._extProgressNotifier.vodProgress.mockClear();

    svc.resetVodDuration();

    expect(svc._extProgressNotifier.vodProgress).toHaveBeenCalledWith(0, 0);
    expect(svc._timeIndUI.update).toHaveBeenCalledWith(0, 0);
  });

  it("ignores a seek-bar interaction while no duration is known", () => {
    // between a source change and the new playlist the bar has no scale:
    // a drag would map to position 0 and to the live branch
    const { svc, positions } = createService();
    svc.updateVodPlaylistDuration(10);
    svc.resetVodDuration();

    svc._doPositionUpdate(0);

    expect(positions).toEqual([]);
  });

  it("maps a seek-bar interaction with a known duration", () => {
    const { svc, positions } = createService();
    svc.updateVodPlaylistDuration(10);

    svc._doPositionUpdate(5);

    expect(positions).toEqual([[MODE.VOD, 5]]);
  });

  it("clamps again when the new source's playlist duration arrives", () => {
    const { svc, positions } = createService();
    svc.updateVodPlaylistDuration(10);
    svc.resetVodDuration();

    svc.updateVodPlaylistDuration(900);
    svc.updateVodPosition(950);

    expect(positions).toEqual([[MODE.VOD, 900]]);
  });
});

describe("PlaybackProgressService.resetVodDuration() twice", () => {
  const NAME = "progress-reset-twice";

  afterEach(() => {
    releaseInstances(NAME);
  });

  it("a second reset with nothing known tells nobody", () => {
    // the facade resets at the URL change and the engine again at its
    // reload: the application hears about the unknown duration once
    const svc = PlaybackProgressService.getInstance(NAME);
    svc._extProgressNotifier = { vodProgress: vi.fn() };
    svc.updateVodPlaylistDuration(10);
    svc._extProgressNotifier.vodProgress.mockClear();

    svc.resetVodDuration();
    svc.resetVodDuration();

    expect(svc._extProgressNotifier.vodProgress).toHaveBeenCalledTimes(1);
    expect(svc._extProgressNotifier.vodProgress).toHaveBeenCalledWith(0, 0);
  });
});
