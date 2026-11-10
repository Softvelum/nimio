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
    const notifier = { vodProgress: vi.fn(), liveProgress: vi.fn() };
    svc.extProgressNotifier = notifier;
    const positions = [];
    svc.positionChangeCb = (mode, pos) => {
      positions.push([mode, pos]);
      return true;
    };
    return { svc, notifier, positions };
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
    svc.updateVodProgress(4, 10); // the archive played: its media duration too

    svc.resetVodDuration();
    svc.updateVodPosition(700);

    expect(positions).toEqual([[MODE.VOD, 700]]);
  });

  it("the reset tells the seek bar, the time indicator and the external progress listener", () => {
    // neither the player's own displays nor an application's may keep the
    // old archive's scale until the new playlist arrives
    const { svc, notifier } = createService();
    const ui = { updateDuration: vi.fn() };
    svc.setUI(ui);
    const timeInd = { update: vi.fn() };
    svc.setTimeIndUI(timeInd);
    svc.updateVodPlaylistDuration(10);
    notifier.vodProgress.mockClear();

    svc.resetVodDuration();

    expect(ui.updateDuration).toHaveBeenLastCalledWith(0);
    expect(timeInd.update).toHaveBeenLastCalledWith(0, 0);
    expect(notifier.vodProgress).toHaveBeenCalledWith(0, 0);
  });

  it("a position accepted while the duration was unknown is dropped by the reset too", () => {
    // it would be carried into the next archive as its first position
    const { svc, notifier } = createService();
    svc.updateVodPosition(500);

    svc.resetVodDuration();

    expect(notifier.vodProgress).toHaveBeenCalledWith(0, 0);
    svc.updateVodPlaylistDuration(120);
    expect(notifier.vodProgress).toHaveBeenLastCalledWith(0, 120);
  });

  it("ignores a seek-bar interaction while no duration is known", () => {
    // between a source change and the new playlist the bar has no scale:
    // a drag would map to position 0 and to the live branch
    const { svc, positions } = createService();
    const ui = { updateDuration: vi.fn() };
    svc.setUI(ui);
    svc.updateVodPlaylistDuration(10);
    svc.resetVodDuration();

    ui.onPositionUpdated(0); // the bar reports a fraction of its scale

    expect(positions).toEqual([]);
  });

  it("maps a seek-bar interaction with a known duration", () => {
    const { svc, positions } = createService();
    const ui = { updateDuration: vi.fn() };
    svc.setUI(ui);
    svc.updateVodPlaylistDuration(10);

    ui.onPositionUpdated(0.5);

    expect(positions).toEqual([[MODE.VOD, 5]]);
  });

  it("a seek-bar interaction with only a live duration known still maps to live", () => {
    // the scale the guard checks is the whole bar's, not the archive's
    const { svc, positions } = createService();
    const ui = { update: vi.fn() };
    svc.setUI(ui);
    svc.updateLiveProgress(0, 25);

    ui.onPositionUpdated(0.5);

    expect(positions).toEqual([[MODE.LIVE, 12.5]]);
  });

  it("a seek accepted while the duration was unknown is clamped when the playlist arrives", () => {
    // the application must not be told a position beyond the duration
    const { svc, notifier, positions } = createService();

    svc.updateVodPosition(500);
    expect(positions).toEqual([[MODE.VOD, 500]]);

    svc.updateVodPlaylistDuration(120);

    expect(notifier.vodProgress).toHaveBeenLastCalledWith(120, 120);
  });

  it("a position inside the new playlist is kept when it arrives", () => {
    const { svc, notifier } = createService();

    svc.updateVodPosition(30);
    svc.updateVodPlaylistDuration(120);

    expect(notifier.vodProgress).toHaveBeenLastCalledWith(30, 120);
  });

  it("a playlist with no duration validates nothing", () => {
    // 0 is "unknown" for the service: the target stays as requested
    const { svc, notifier } = createService();

    svc.updateVodPosition(500);
    svc.updateVodPlaylistDuration(0);

    expect(notifier.vodProgress).toHaveBeenLastCalledWith(500, 0);
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
    // the URL changed twice before any playlist arrived: the application
    // hears about the unknown duration once
    const svc = PlaybackProgressService.getInstance(NAME);
    const notifier = { vodProgress: vi.fn() };
    svc.extProgressNotifier = notifier;
    svc.updateVodPlaylistDuration(10);
    notifier.vodProgress.mockClear();

    svc.resetVodDuration();
    svc.resetVodDuration();

    expect(notifier.vodProgress).toHaveBeenCalledTimes(1);
    expect(notifier.vodProgress).toHaveBeenCalledWith(0, 0);
  });
});
