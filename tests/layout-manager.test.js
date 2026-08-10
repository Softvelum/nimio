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

    describe("VOD mode with an auto container dimension", () => {
      // An auto container HEIGHT derives from the output element itself
      // (the container is a block element), so sizing the output from the
      // measured rect feeds back into the container size: the branch
      // comparison flips between measurements and the layout oscillates
      // (visible flicker). An auto WIDTH resolves to the parent's width -
      // definite and feedback-free - so the rect stays trustworthy there.

      it("keeps width as the constraint when the height is auto", () => {
        const ui = new UILayoutManager("100%", "auto", "16:9");

        // A rect matching the aspect ratio used to flip to height-fit.
        const wide = ui.fullLayout(1000, 563, MODE.VOD, false);
        expect(wide.output.width).toBe("100%");
        expect(wide.output.height).toBe("auto");

        // The intrinsic-size rect the flip produces must map to the very
        // same styles - a single fixed point instead of an oscillation.
        const tall = ui.fullLayout(1000, 720, MODE.VOD, false);
        expect(tall.output.width).toBe("100%");
        expect(tall.output.height).toBe("auto");
      });

      it("keeps the rect-based fit when only the width is auto", () => {
        // Width auto is parent-derived on a block container: the measured
        // rect is stable, and forcing height-fit here would overflow a
        // parent narrower than the aspect-sized video.
        const ui = new UILayoutManager("auto", 400, "16:9");

        const wide = ui.fullLayout(1000, 400, MODE.VOD, false);
        expect(wide.output.width).toBe("auto");
        expect(wide.output.height).toBe("100%");

        // A narrow parent letterboxes inside the fixed-height container.
        const tall = ui.fullLayout(500, 400, MODE.VOD, false);
        expect(tall.output.width).toBe("100%");
        expect(tall.output.height).toBe("auto");
      });

      it("sizes intrinsically when both dimensions are auto", () => {
        const ui = new UILayoutManager("auto", "auto", "16:9");

        // Rect-independent: the same styles for any measured rect.
        const wide = ui.fullLayout(1000, 563, MODE.VOD, false);
        expect(wide.output.width).toBe("auto");
        expect(wide.output.height).toBe("auto");

        const tall = ui.fullLayout(500, 720, MODE.VOD, false);
        expect(tall.output.width).toBe("auto");
        expect(tall.output.height).toBe("auto");
      });

      it("applies the same constraint in media-element mode", () => {
        const ui = new UILayoutManager("100%", "auto", "16:9");

        const wide = ui.fullLayout(1000, 563, MODE.LIVE, false, true);
        expect(wide.output.width).toBe("100%");
        expect(wide.output.height).toBe("auto");
      });
    });

    describe("VOD mode with an indefinite container height", () => {
      // The flicker guard must key on definiteness, not on the literal
      // "auto": a percentage height inside a parent with no definite
      // height behaves as auto, so the rect-based fit feeds back and
      // oscillates the same way. Context-dependent heights (%, var(),
      // inherit) are resolved by the caller (a DOM probe in ui.js) and
      // passed in as the heightIndependent flag - the last fullLayout
      // argument below.

      it("uses width as the constraint for a percentage height when the parent height is indefinite", () => {
        const ui = new UILayoutManager("100%", "100%", "16:9");

        const wide = ui.fullLayout(1000, 563, MODE.VOD, false, false, false);
        expect(wide.output.width).toBe("100%");
        expect(wide.output.height).toBe("auto");

        // The intrinsic-size rect those styles produce must map back to
        // the very same styles - a single fixed point, no oscillation.
        const tall = ui.fullLayout(1000, 720, MODE.VOD, false, false, false);
        expect(tall.output.width).toBe("100%");
        expect(tall.output.height).toBe("auto");
      });

      it("keeps the rect-based fit for a percentage height when the parent height is definite", () => {
        // Here the rect is trustworthy and dropping the fit would lose
        // letterboxing (and overflow a shorter-than-aspect box).
        const ui = new UILayoutManager("100%", "100%", "16:9");

        const wide = ui.fullLayout(2000, 1000, MODE.VOD, false, false, true);
        expect(wide.output.width).toBe("auto");
        expect(wide.output.height).toBe("100%");

        const narrow = ui.fullLayout(500, 400, MODE.VOD, false, false, true);
        expect(narrow.output.width).toBe("100%");
        expect(narrow.output.height).toBe("auto");
      });

      it("treats content-based height keywords as indefinite regardless of the flag", () => {
        for (const height of ["fit-content", "min-content", "max-content"]) {
          const ui = new UILayoutManager("100%", height, "16:9");

          const result = ui.fullLayout(1000, 563, MODE.VOD, false, false, true);
          expect(result.output.width).toBe("100%");
          expect(result.output.height).toBe("auto");
        }
      });

      it("classifies functions containing a percentage by the parent's definiteness", () => {
        for (const height of ["calc(100% - 40px)", "min(100%, 480px)"]) {
          const ui = new UILayoutManager("100%", height, "16:9");

          const indefinite = ui.fullLayout(
            1000,
            563,
            MODE.VOD,
            false,
            false,
            false,
          );
          expect(indefinite.output.width).toBe("100%");
          expect(indefinite.output.height).toBe("auto");

          const definite = ui.fullLayout(
            2000,
            1000,
            MODE.VOD,
            false,
            false,
            true,
          );
          expect(definite.output.width).toBe("auto");
          expect(definite.output.height).toBe("100%");
        }
      });

      it("keeps the rect-based fit for absolute heights regardless of the flag", () => {
        for (const height of ["480px", "50vh", "20em"]) {
          const ui = new UILayoutManager("100%", height, "16:9");

          const result = ui.fullLayout(
            2000,
            1000,
            MODE.VOD,
            false,
            false,
            false,
          );
          expect(result.output.width).toBe("auto");
          expect(result.output.height).toBe("100%");
        }
      });

      it("keeps the rect-based fit in fullscreen where the container is viewport-sized", () => {
        const ui = new UILayoutManager("100%", "100%", "16:9");

        const result = ui.fullLayout(2000, 1000, MODE.VOD, true, false, false);
        expect(result.output.width).toBe("auto");
        expect(result.output.height).toBe("100%");
      });

      it("combines an auto width with an indefinite percentage height", () => {
        const ui = new UILayoutManager("auto", "100%", "16:9");

        const result = ui.fullLayout(1000, 563, MODE.VOD, false, false, false);
        expect(result.output.width).toBe("auto");
        expect(result.output.height).toBe("auto");
      });

      it("applies the same constraint in media-element mode", () => {
        const ui = new UILayoutManager("100%", "100%", "16:9");

        const result = ui.fullLayout(1000, 563, MODE.LIVE, false, true, false);
        expect(result.output.width).toBe("100%");
        expect(result.output.height).toBe("auto");
      });

      it("uses pixel sizes in media-element mode when the parent height is definite", () => {
        const ui = new UILayoutManager("100%", "100%", "16:9");

        const result = ui.fullLayout(2000, 1000, MODE.LIVE, false, true, true);
        expect(result.output.width).toBe("2000px");
        expect(result.output.height).toBe("100%");
      });

      it("uses the rect-based fit for frame-sized players once the frame size is known", () => {
        // Empty width/height settings resolve to pixel dimensions on the
        // first frame - definite from then on, whatever the flag says.
        const ui = new UILayoutManager(undefined, undefined, "16:9");
        ui.setFrameSize(1920, 1080);

        const result = ui.fullLayout(2000, 1000, MODE.VOD, false, false, false);
        expect(result.output.width).toBe("auto");
        expect(result.output.height).toBe("100%");
      });

      it("resolves revert and revert-layer through the probe flag", () => {
        // revert-layer from inline style can land on a definite
        // stylesheet height, so the measured verdict decides.
        for (const height of ["revert", "revert-layer"]) {
          const ui = new UILayoutManager("100%", height, "16:9");

          const dependent = ui.fullLayout(
            1000,
            563,
            MODE.VOD,
            false,
            false,
            false,
          );
          expect(dependent.output.width).toBe("100%");
          expect(dependent.output.height).toBe("auto");

          const independent = ui.fullLayout(
            2000,
            1000,
            MODE.VOD,
            false,
            false,
            true,
          );
          expect(independent.output.width).toBe("auto");
          expect(independent.output.height).toBe("100%");
        }
      });

      it("treats css-wide keywords and keyword case variants as indefinite", () => {
        for (const height of ["AUTO", " auto ", "initial", "unset"]) {
          const ui = new UILayoutManager("100%", height, "16:9");

          // These compute to auto, so the flag must not matter.
          const result = ui.fullLayout(
            2000,
            1000,
            MODE.VOD,
            false,
            false,
            true,
          );
          expect(result.output.width).toBe("100%");
          expect(result.output.height).toBe("auto");
        }
      });

      it("resolves inherit through the parent flag", () => {
        const ui = new UILayoutManager("100%", "inherit", "16:9");

        const indefinite = ui.fullLayout(
          1000,
          563,
          MODE.VOD,
          false,
          false,
          false,
        );
        expect(indefinite.output.width).toBe("100%");
        expect(indefinite.output.height).toBe("auto");

        const definite = ui.fullLayout(
          2000,
          1000,
          MODE.VOD,
          false,
          false,
          true,
        );
        expect(definite.output.width).toBe("auto");
        expect(definite.output.height).toBe("100%");
      });

      it("resolves var() heights through the parent flag", () => {
        const ui = new UILayoutManager("100%", "var(--player-height)", "16:9");

        const indefinite = ui.fullLayout(
          1000,
          563,
          MODE.VOD,
          false,
          false,
          false,
        );
        expect(indefinite.output.width).toBe("100%");
        expect(indefinite.output.height).toBe("auto");

        const definite = ui.fullLayout(
          2000,
          1000,
          MODE.VOD,
          false,
          false,
          true,
        );
        expect(definite.output.width).toBe("auto");
        expect(definite.output.height).toBe("100%");
      });

      it("resolves env() and calc-size() heights through the probe flag", () => {
        for (const height of [
          "env(safe-area-inset-bottom, auto)",
          "calc-size(auto, size)",
        ]) {
          const ui = new UILayoutManager("100%", height, "16:9");

          const dependent = ui.fullLayout(
            1000,
            563,
            MODE.VOD,
            false,
            false,
            false,
          );
          expect(dependent.output.width).toBe("100%");
          expect(dependent.output.height).toBe("auto");

          const independent = ui.fullLayout(
            2000,
            1000,
            MODE.VOD,
            false,
            false,
            true,
          );
          expect(independent.output.width).toBe("auto");
          expect(independent.output.height).toBe("100%");
        }
      });

      it("keeps an intrinsic width for content-based width keywords", () => {
        // A fit-content width is sized by the output too; forcing
        // width:100% against it would be cyclic.
        const ui = new UILayoutManager("fit-content", "auto", "16:9");

        const result = ui.fullLayout(1000, 563, MODE.VOD, false, false, false);
        expect(result.output.width).toBe("auto");
        expect(result.output.height).toBe("auto");
      });

      it("sizes intrinsically for frame-sized players before the first frame", () => {
        const ui = new UILayoutManager(undefined, undefined, "16:9");

        const result = ui.fullLayout(1000, 563, MODE.VOD, false, false, false);
        expect(result.output.width).toBe("auto");
        expect(result.output.height).toBe("auto");
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

  describe("canLayout", () => {
    // ui.js consults this before running the DOM probe: when fullLayout
    // would bail anyway (no aspect ratio yet, or paused), the probe's
    // forced layouts are wasted work.

    it("is false without an aspect ratio", () => {
      expect(new UILayoutManager(640, 480).canLayout()).toBe(false);
    });

    it("is false while paused", () => {
      const ui = new UILayoutManager(640, 480, "16:9");
      ui.pause();

      expect(ui.canLayout()).toBe(false);
    });

    it("is true with an aspect ratio while not paused", () => {
      const ui = new UILayoutManager(640, 480, "16:9");

      expect(ui.canLayout()).toBe(true);

      ui.pause();
      ui.resume();
      expect(ui.canLayout()).toBe(true);
    });
  });

  describe("heightNeedsProbe", () => {
    // ui.js runs a DOM probe (does the container height follow the
    // output?) only for context-dependent heights - %, var(), inherit -
    // which the layout manager can't classify on its own.

    it("is false for intrinsic heights", () => {
      expect(
        new UILayoutManager("100%", "auto", "16:9").heightNeedsProbe(),
      ).toBe(false);
      expect(
        new UILayoutManager("100%", "fit-content", "16:9").heightNeedsProbe(),
      ).toBe(false);
      expect(
        new UILayoutManager("100%", undefined, "16:9").heightNeedsProbe(),
      ).toBe(false);
    });

    it("is false for definite heights", () => {
      for (const height of [
        480,
        "50vh",
        "480px",
        ".5em",
        "1.5rem",
        "+1px",
        "1e2px",
        "1E-2em",
        "+.5rem",
        "0",
        "10svi",
        "5dvb",
        "3svmin",
        "4lvmax",
        "2rex",
        "1.5rch",
        "2ric",
      ]) {
        expect(
          new UILayoutManager("100%", height, "16:9").heightNeedsProbe(),
        ).toBe(false);
      }
    });

    it("is true for malformed or negative numeric lengths", () => {
      // Browsers reject these declarations (negative heights are
      // invalid), leaving the height effectively auto - they must be
      // measured, not trusted.
      for (const height of ["1.2.3px", ".px", "....vh", "1..5em", "-1px"]) {
        expect(
          new UILayoutManager("100%", height, "16:9").heightNeedsProbe(),
        ).toBe(true);
      }
    });

    it("is false for css-wide keywords and keyword case variants", () => {
      for (const height of ["AUTO", " auto ", "initial", "unset"]) {
        expect(
          new UILayoutManager("100%", height, "16:9").heightNeedsProbe(),
        ).toBe(false);
      }
    });

    it("is true for revert and revert-layer", () => {
      // revert-layer from the style attribute falls back into author
      // stylesheet rules, which may define a definite height; revert
      // can expose user-origin styles. Both must be measured.
      for (const height of ["revert", "revert-layer"]) {
        expect(
          new UILayoutManager("100%", height, "16:9").heightNeedsProbe(),
        ).toBe(true);
      }
    });

    it("is true for percentage heights", () => {
      expect(
        new UILayoutManager("100%", "100%", "16:9").heightNeedsProbe(),
      ).toBe(true);
      expect(
        new UILayoutManager("100%", " 100% ", "16:9").heightNeedsProbe(),
      ).toBe(true);
    });

    it("is true for inherit", () => {
      // inherit copies the parent's computed height, so its definiteness
      // is exactly what the parent probe measures.
      expect(
        new UILayoutManager("100%", "inherit", "16:9").heightNeedsProbe(),
      ).toBe(true);
    });

    it("is true for var() heights", () => {
      // A custom property can hide any value; the probe keeps the layout
      // stable either way, so it decides.
      expect(
        new UILayoutManager(
          "100%",
          "var(--player-height)",
          "16:9",
        ).heightNeedsProbe(),
      ).toBe(true);
    });

    it("is true for any syntax that is not a plain absolute length", () => {
      // Only positively recognized absolute lengths skip the probe -
      // env() can resolve to its fallback (possibly auto), calc-size()
      // keeps intrinsic sizing behavior, and future syntax is unknown.
      for (const height of [
        "env(safe-area-inset-bottom, auto)",
        "calc-size(auto, size)",
        "calc(50vh - 10px)",
        "min(10vh, 200px)",
        "foo(12px)",
      ]) {
        expect(
          new UILayoutManager("100%", height, "16:9").heightNeedsProbe(),
        ).toBe(true);
      }
    });

    it("is true for functions containing a percentage", () => {
      expect(
        new UILayoutManager(
          "100%",
          "calc(100% - 40px)",
          "16:9",
        ).heightNeedsProbe(),
      ).toBe(true);
      expect(
        new UILayoutManager(
          "100%",
          "min(100%, 480px)",
          "16:9",
        ).heightNeedsProbe(),
      ).toBe(true);
    });

    it("is false once frame sizing resolves empty dimensions to pixels", () => {
      const ui = new UILayoutManager();
      ui.setFrameSize(1920, 1080);

      expect(ui.heightNeedsProbe()).toBe(false);
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
