import { describe, it, expect, vi } from "vitest";
import {
  multiInstanceService,
  releaseInstances,
  allocateInstanceKey,
} from "@/shared/service";

describe("multiInstanceService", () => {
  it("returns the same instance for the same id", () => {
    const Svc = multiInstanceService(class {});

    expect(Svc.getInstance("a") === Svc.getInstance("a")).toBe(true);
    expect(Svc.getInstance("a") === Svc.getInstance("b")).toBe(false);
  });

  it("drops the instance and calls its destroy() on release", () => {
    const destroy = vi.fn();
    const Svc = multiInstanceService(
      class {
        destroy() {
          destroy();
        }
      },
    );
    const first = Svc.getInstance("a");

    Svc.release("a");

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(Svc.getInstance("a") === first).toBe(false);
  });

  it("ignores release of an unknown id", () => {
    const Svc = multiInstanceService(class {});

    expect(() => Svc.release("missing")).not.toThrow();
  });
});

describe("releaseInstances", () => {
  it("releases the id in every service and leaves other ids intact", () => {
    const SvcA = multiInstanceService(class {});
    const SvcB = multiInstanceService(class {});
    const a = SvcA.getInstance("x");
    const b = SvcB.getInstance("x");
    const keep = SvcA.getInstance("y");

    releaseInstances("x");

    expect(SvcA.getInstance("x") === a).toBe(false);
    expect(SvcB.getInstance("x") === b).toBe(false);
    expect(SvcA.getInstance("y") === keep).toBe(true);
  });

  it("a throwing destroy() does not stop the other releases and is rethrown", () => {
    const SvcA = multiInstanceService(
      class {
        destroy() {
          throw new Error("vu container gone");
        }
      },
    );
    const SvcB = multiInstanceService(class {});
    const a = SvcA.getInstance("z");
    const b = SvcB.getInstance("z");

    expect(() => releaseInstances("z")).toThrow("vu container gone");

    expect(SvcA.getInstance("z") === a).toBe(false);
    expect(SvcB.getInstance("z") === b).toBe(false);
  });
});

describe("allocateInstanceKey", () => {
  it("keeps the name for its first use and makes later keys unique", () => {
    const name = "alloc-test";

    const first = allocateInstanceKey(name);
    const second = allocateInstanceKey(name);
    const third = allocateInstanceKey(name);

    expect(first).toBe(name);
    expect(new Set([first, second, third]).size).toBe(3);
    expect(second.startsWith(name)).toBe(true);
  });

  it("doesn't collide with a name that looks like a generated key", () => {
    const generated = allocateInstanceKey("collide");
    const second = allocateInstanceKey("collide");
    const explicit = allocateInstanceKey(second);

    expect(new Set([generated, second, explicit]).size).toBe(3);
  });
});
