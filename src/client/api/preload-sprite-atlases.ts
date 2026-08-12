import type { SpriteMap } from "../../shared/domain.js";

export type SpriteImageFactory = () => HTMLImageElement;

function preloadOne(url: string, signal: AbortSignal | undefined, createImage: SpriteImageFactory): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const image = createImage();
    let settled = false;

    const cleanup = (): void => {
      image.removeEventListener("load", onLoad);
      image.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };

    const settle = (error?: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };

    const onLoad = (): void => {
      if (typeof image.decode !== "function") {
        settle();
        return;
      }
      Promise.resolve().then(() => image.decode!()).then(
        () => settle(),
        () => settle(new Error("Unable to prepare card artwork")),
      );
    };
    const onError = (): void => settle(new Error("Unable to prepare card artwork"));
    const onAbort = (): void => {
      image.src = "";
      settle(new DOMException("Sprite preload aborted", "AbortError"));
    };

    image.addEventListener("load", onLoad);
    image.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    image.src = url;
  });
}

export async function preloadSpriteAtlases(
  spriteMap: SpriteMap,
  signal?: AbortSignal,
  createImage: SpriteImageFactory = () => new Image(),
): Promise<void> {
  const urls = [...new Set([spriteMap.candidate.url, spriteMap.guess.url])];
  await Promise.all(urls.map((url) => preloadOne(url, signal, createImage)));
}
