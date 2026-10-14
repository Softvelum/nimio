import { describe, it, expect, vi } from "vitest";
import { runCleanupSteps } from "@/shared/helpers";

describe("runCleanupSteps", () => {
  it("runs every step, logs failures and returns the errors in order", () => {
    const logger = { error: vi.fn() };
    const calls = [];
    const first = new Error("first");
    const second = new Error("second");

    const errors = runCleanupSteps(logger, "destroy", [
      ["a", () => calls.push("a")],
      [
        "b",
        () => {
          throw first;
        },
      ],
      ["c", () => calls.push("c")],
      [
        "d",
        () => {
          throw second;
        },
      ],
    ]);

    expect(calls).toEqual(["a", "c"]);
    expect(errors).toEqual([first, second]);
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(logger.error.mock.calls[0][0]).toBe("destroy: b failed");
    expect(logger.error.mock.calls[0][1]).toBe(first);
  });

  it("returns an empty list when nothing fails", () => {
    const logger = { error: vi.fn() };

    expect(runCleanupSteps(logger, "x", [["a", () => {}]])).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
