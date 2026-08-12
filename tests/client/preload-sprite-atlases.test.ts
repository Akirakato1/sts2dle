import type { SpriteMap } from "../../src/shared/domain.js";
import { describe, expect, test } from "vitest";

import { preloadSpriteAtlases } from "../../src/client/api/preload-sprite-atlases.js";

const spriteMap: SpriteMap = {
  candidate: { url: "/candidate.webp", width: 1, height: 1, displayScale: 1 },
  guess: { url: "/guess.webp", width: 1, height: 1, displayScale: 1 },
  cards: {},
};

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (reason?: unknown) => void } {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeImage {
  private currentSrc = "";
  decode: (() => Promise<void>) | undefined;
  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly decoding = deferred();

  constructor(
    canDecode = true,
    private readonly throwOnClear = false,
    private readonly throwOnRemove = false,
  ) {
    if (canDecode) this.decode = () => this.decoding.promise;
  }

  get src(): string { return this.currentSrc; }
  set src(value: string) {
    if (value === "" && this.throwOnClear) throw new Error("source clear failed");
    this.currentSrc = value;
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (this.throwOnRemove) throw new Error("listener cleanup failed");
    this.listeners.get(type)?.delete(listener);
  }

  resolveLoad(): void { this.dispatch("load"); }
  resolveError(): void { this.dispatch("error"); }
  resolveDecode(): void { this.decoding.resolve(); }
  rejectDecode(): void { this.decoding.reject(new Error("decode failed")); }
  listenerCount(): number { return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0); }

  private dispatch(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }
}

async function expectSettled(promise: Promise<unknown>, settled: boolean): Promise<void> {
  let didSettle = false;
  void promise.then(() => { didSettle = true; }, () => { didSettle = true; });
  await Promise.resolve();
  await Promise.resolve();
  expect(didSettle).toBe(settled);
}

async function rejectedError(promise: Promise<void>): Promise<Error> {
  try {
    await promise;
  } catch (caught) {
    if (caught instanceof Error) return caught;
    throw caught;
  }
  throw new Error("expected preload failure");
}

async function expectAbortError(promise: Promise<void>): Promise<void> {
  let outcome: "pending" | "resolved" | "rejected" = "pending";
  let rejection: unknown;
  void promise.then(
    () => { outcome = "resolved"; },
    (caught: unknown) => { outcome = "rejected"; rejection = caught; },
  );
  for (let count = 0; count < 6; count += 1) await Promise.resolve();
  expect(outcome).toBe("rejected");
  expect(rejection).toEqual(new DOMException("Sprite preload aborted", "AbortError"));
}

describe("preloadSpriteAtlases", () => {
  test("waits for both distinct atlas loads and decodes", async () => {
    const created: FakeImage[] = [];
    const images = [new FakeImage(), new FakeImage()];
    const controller = new AbortController();
    const loading = preloadSpriteAtlases(spriteMap, controller.signal, () => {
      const image = images.shift()!;
      created.push(image);
      return image as unknown as HTMLImageElement;
    });

    expect(created.map((image) => image.src)).toEqual(["/candidate.webp", "/guess.webp"]);
    await expectSettled(loading, false);
    created[0]!.resolveLoad();
    created[0]!.resolveDecode();
    await expectSettled(loading, false);
    created[1]!.resolveLoad();
    created[1]!.resolveDecode();
    await expect(loading).resolves.toBeUndefined();
  });

  test("loads a shared atlas URL once", async () => {
    const image = new FakeImage();
    const loading = preloadSpriteAtlases({ ...spriteMap, guess: { ...spriteMap.guess, url: "/candidate.webp" } }, undefined, () => image as unknown as HTMLImageElement);

    expect(image.src).toBe("/candidate.webp");
    image.resolveLoad();
    image.resolveDecode();
    await expect(loading).resolves.toBeUndefined();
  });

  test("replaces a load failure with a fixed URL-free error", async () => {
    const image = new FakeImage();
    const loading = preloadSpriteAtlases(spriteMap, undefined, () => image as unknown as HTMLImageElement);

    image.resolveError();
    const error = await rejectedError(loading);
    expect(error).toEqual(new Error("Unable to prepare card artwork"));
    expect(error.message).not.toContain("candidate.webp");
    expect(error.message).not.toContain("guess.webp");
  });

  test("replaces a decode failure with a fixed URL-free error", async () => {
    const image = new FakeImage();
    const loading = preloadSpriteAtlases({ ...spriteMap, guess: { ...spriteMap.guess, url: "/candidate.webp" } }, undefined, () => image as unknown as HTMLImageElement);

    image.resolveLoad();
    image.rejectDecode();
    const error = await rejectedError(loading);
    expect(error).toEqual(new Error("Unable to prepare card artwork"));
    expect(error.message).not.toContain("candidate.webp");
  });

  test("succeeds after load when decode is unavailable", async () => {
    const image = new FakeImage(false);
    const loading = preloadSpriteAtlases({ ...spriteMap, guess: { ...spriteMap.guess, url: "/candidate.webp" } }, undefined, () => image as unknown as HTMLImageElement);

    image.resolveLoad();
    await expect(loading).resolves.toBeUndefined();
  });

  test("rejects an already-aborted signal without assigning an atlas URL", async () => {
    const controller = new AbortController();
    controller.abort();
    const image = new FakeImage();

    await expect(preloadSpriteAtlases({ ...spriteMap, guess: { ...spriteMap.guess, url: "/candidate.webp" } }, controller.signal, () => image as unknown as HTMLImageElement)).rejects.toEqual(new DOMException("Sprite preload aborted", "AbortError"));
    expect(image.src).toBe("");
  });

  test("clears the source and removes listeners when aborted mid-load", async () => {
    const controller = new AbortController();
    const image = new FakeImage();
    const loading = preloadSpriteAtlases({ ...spriteMap, guess: { ...spriteMap.guess, url: "/candidate.webp" } }, controller.signal, () => image as unknown as HTMLImageElement);

    expect(image.listenerCount()).toBe(2);
    controller.abort();
    await expect(loading).rejects.toEqual(new DOMException("Sprite preload aborted", "AbortError"));
    expect(image.src).toBe("");
    expect(image.listenerCount()).toBe(0);
  });

  test("rejects AbortError when source clearing throws and ignores late image events", async () => {
    const controller = new AbortController();
    const image = new FakeImage(true, true);
    const loading = preloadSpriteAtlases({ ...spriteMap, guess: { ...spriteMap.guess, url: "/candidate.webp" } }, controller.signal, () => image as unknown as HTMLImageElement);

    expect(() => controller.abort()).not.toThrow();
    image.resolveLoad();
    image.resolveError();
    image.resolveDecode();
    await expectAbortError(loading);
  });

  test("rejects AbortError when listener cleanup throws and ignores late image events", async () => {
    const controller = new AbortController();
    const image = new FakeImage(true, false, true);
    const loading = preloadSpriteAtlases({ ...spriteMap, guess: { ...spriteMap.guess, url: "/candidate.webp" } }, controller.signal, () => image as unknown as HTMLImageElement);

    expect(() => controller.abort()).not.toThrow();
    image.resolveLoad();
    image.resolveError();
    image.resolveDecode();
    await expectAbortError(loading);
  });

  test("removes every listener after readiness", async () => {
    const image = new FakeImage();
    const loading = preloadSpriteAtlases({ ...spriteMap, guess: { ...spriteMap.guess, url: "/candidate.webp" } }, undefined, () => image as unknown as HTMLImageElement);

    image.resolveLoad();
    image.resolveDecode();
    await expect(loading).resolves.toBeUndefined();
    expect(image.listenerCount()).toBe(0);
  });
});
