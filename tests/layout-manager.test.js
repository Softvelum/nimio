import { describe, it, expect, beforeEach } from "vitest";
import { MODE } from "@/shared/values";
import { UILayoutManager } from "@/ui/layout-manager";

describe("UILayoutManager", () => {
  describe("constructor behavior", () => {
    it("uses provided numeric dimensions", () => {
      const ui = new UILayoutManager(640, 480, "16:9");

      expect(ui.containerLayout(false)).toEqual({
        width: "640px",
        height: "480px",
      });
    });

    it("uses provided string dimensions", () => {
      const ui = new UILayoutManager("100%", "50vh", "16:9");

      expect(ui.containerLayout(false)).toEqual({
        width: "100%",
        height: "50vh",
      });
    });

    it('defaults dimensions to "auto"', () => {
      const ui = new UILayoutManager();

      expect(ui.containerLayout(false)).toEqual({
        width: "auto",
        height: "auto",
      });
    });

    it("derives dimensions from frame size when width/height are omitted", () => {
      const ui = new UILayoutManager();

      ui.setFrameSize(1920, 1080);

      expect(ui.containerLayout(false)).toEqual({
        width: "1920px",
        height: "1080px",
      });
    });

    it("does not overwrite explicit dimensions after setFrameSize", () => {
      const ui = new UILayoutManager("100%", "500px");

      ui.setFrameSize(1920, 1080);

      expect(ui.containerLayout(false)).toEqual({
        width: "100%",
        height: "500px",
      });
    });

    it("accepts colon-separated aspect ratios", () => {
      const ui = new UILayoutManager(640, 480, "16:9");

      const result = ui.fullLayout(1920, 1080, MODE.LIVE, false);

      expect(result.output["aspect-ratio"]).toBe("16 / 9");
    });

    it("accepts slash-separated aspect ratios", () => {
      const ui = new UILayoutManager(640, 480, "4/3");

      const result = ui.fullLayout(800, 600, MODE.LIVE, false);

      expect(result.output["aspect-ratio"]).toBe("4 / 3");
    });

    it("ignores malformed aspect ratios", () => {
      const ui = new UILayoutManager(640, 480, "broken");

      const result = ui.fullLayout(1920, 1080, MODE.LIVE, false);

      expect(result).toBeNull();
    });
  });

  describe("pause/resume", () => {
    let ui;

    beforeEach(() => {
      ui = new UILayoutManager(640, 480, "16:9");
    });

    it("disables fullLayout while paused", () => {
      ui.pause();

      expect(ui.fullLayout(1920, 1080, MODE.LIVE, false)).toBeNull();
    });

    it("disables computeRenderProps while paused", () => {
      ui.setFrameSize(1920, 1080);

      ui.pause();

      expect(ui.computeRenderProps(1280, 720)).toBeNull();
    });

    it("restores functionality after resume", () => {
      ui.pause();
      ui.resume();

      const result = ui.fullLayout(1920, 1080, MODE.LIVE, false);

      expect(result).not.toBeNull();
    });
  });

  describe("setFrameSize", () => {
    it("ignores invalid width", () => {
      const ui = new UILayoutManager();

      ui.setFrameSize(null, 1080);

      expect(ui.fullLayout(1920, 1080, MODE.LIVE, false)).toBeNull();
    });

    it("ignores invalid height", () => {
      const ui = new UILayoutManager();

      ui.setFrameSize(1920, null);

      expect(ui.fullLayout(1920, 1080, MODE.LIVE, false)).toBeNull();
    });

    it("derives aspect ratio from frame dimensions when not forced", () => {
      const ui = new UILayoutManager();

      ui.setFrameSize(1920, 1080);

      const result = ui.fullLayout(1920, 1080, MODE.LIVE, false);

      expect(result.output["aspect-ratio"]).toBe("1920 / 1080");
    });

    it("preserves explicit aspect ratio", () => {
      const ui = new UILayoutManager(undefined, undefined, "4:3");

      ui.setFrameSize(1920, 1080);

      const result = ui.fullLayout(1920, 1080, MODE.LIVE, false);

      expect(result.output["aspect-ratio"]).toBe("4 / 3");
    });

    it("uses contain fit for derived aspect ratio", () => {
      const ui = new UILayoutManager();

      ui.setFrameSize(1920, 1080);

      const result = ui.fullLayout(1920, 1080, MODE.LIVE, false);

      expect(result.output["object-fit"]).toBe("contain");
    });

    it("uses fill fit for forced aspect ratio", () => {
      const ui = new UILayoutManager(undefined, undefined, "16:9");

      ui.setFrameSize(1920, 1080);

      const result = ui.fullLayout(1920, 1080, MODE.LIVE, false);

      expect(result.output["object-fit"]).toBe("fill");
    });
  });

  describe("containerLayout", () => {
    it("returns fullscreen dimensions in fullscreen mode", () => {
      const ui = new UILayoutManager(640, 480);

      expect(ui.containerLayout(true)).toEqual({
        width: "100vw",
        height: "100vh",
      });
    });

    it("returns configured dimensions in windowed mode", () => {
      const ui = new UILayoutManager(640, 480);

      expect(ui.containerLayout(false)).toEqual({
        width: "640px",
        height: "480px",
      });
    });
  });

  describe("fullLayout", () => {
    describe("LIVE mode", () => {
      it("fills both dimensions when container size is fixed", () => {
        const ui = new UILayoutManager(640, 480, "16:9");

        const result = ui.fullLayout(1920, 1080, MODE.LIVE, false);

        expect(result.output.width).toBe("100%");
        expect(result.output.height).toBe("100%");
      });

      it("does not force width when container width is auto", () => {
        const ui = new UILayoutManager(undefined, 480, "16:9");

        const result = ui.fullLayout(1920, 1080, MODE.LIVE, false);

        expect(result.output.width).toBeUndefined();
        expect(result.output.height).toBe("100%");
      });

      it("does not force height when container height is auto", () => {
        const ui = new UILayoutManager(640, undefined, "16:9");

        const result = ui.fullLayout(1920, 1080, MODE.LIVE, false);

        expect(result.output.width).toBe("100%");
        expect(result.output.height).toBeUndefined();
      });
    });

    describe("VOD mode", () => {
      it("fits by height when container is wider than content", () => {
        const ui = new UILayoutManager(640, 480, "16:9");

        const result = ui.fullLayout(1920, 1080, MODE.VOD, false);

        expect(result.output.width).toBe("auto");
        expect(result.output.height).toBe("100%");
      });

      it("fits by width when container is taller than content", () => {
        const ui = new UILayoutManager(640, 480, "16:9");

        const result = ui.fullLayout(500, 1000, MODE.VOD, false);

        expect(result.output.width).toBe("100%");
        expect(result.output.height).toBe("auto");
      });

      it("handles near-equal aspect ratios", () => {
        const ui = new UILayoutManager(640, 480, "16:9");

        const result = ui.fullLayout(1777, 1000, MODE.VOD, false);

        expect(result.output.height).toBe("100%");
      });
    });

    it("returns container dimensions in fullscreen mode", () => {
      const ui = new UILayoutManager(640, 480, "16:9");

      const result = ui.fullLayout(1920, 1080, MODE.LIVE, true);

      expect(result.container).toEqual({
        width: "100vw",
        height: "100vh",
      });
    });

    it("returns base output for unknown mode", () => {
      const ui = new UILayoutManager(640, 480, "16:9");

      const result = ui.fullLayout(1920, 1080, "custom-mode", false);

      expect(result.output).toEqual({
        "object-fit": "fill",
        "aspect-ratio": "16 / 9",
      });
    });
  });

  describe("computeRenderProps", () => {
    let ui;

    beforeEach(() => {
      ui = new UILayoutManager();
      ui.setFrameSize(1920, 1080);
    });

    it("returns null without dimensions", () => {
      expect(ui.computeRenderProps(null, 720)).toBeNull();
      expect(ui.computeRenderProps(1280, null)).toBeNull();
    });

    it("returns null when aspect ratio is unavailable", () => {
      const noAr = new UILayoutManager();

      expect(noAr.computeRenderProps(1280, 720)).toBeNull();
    });

    it("returns correctly scaled render props for equal aspect ratio", () => {
      expect(ui.computeRenderProps(1280, 720)).toEqual({
        width: 1280,
        height: 720,
        dWidth: 1280,
        dHeight: 720,
        dx: 0,
        dy: 0,
      });
    });

    it("letterboxes vertically when viewport is taller", () => {
      const result = ui.computeRenderProps(1280, 1000);

      expect(result.dWidth).toBeCloseTo(1280);
      expect(result.dHeight).toBeCloseTo(720);
      expect(result.dx).toBe(0);
      expect(result.dy).toBe(140);
    });

    it("pillarboxes horizontally when viewport is wider", () => {
      const result = ui.computeRenderProps(2000, 720);

      expect(result.dWidth).toBeCloseTo(1280);
      expect(result.dHeight).toBeCloseTo(720);
      expect(result.dx).toBe(360);
      expect(result.dy).toBe(0);
    });

    it("handles arbitrary scaling factors", () => {
      const result = ui.computeRenderProps(777, 555);

      expect(result.width).toBe(777);
      expect(result.height).toBe(555);

      expect(result.dWidth).toBeGreaterThan(0);
      expect(result.dHeight).toBeGreaterThan(0);

      expect(Number.isInteger(result.dx)).toBe(true);
      expect(Number.isInteger(result.dy)).toBe(true);
    });
  });
});
