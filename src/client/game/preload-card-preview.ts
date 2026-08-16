import type { CardIdentity } from "../../shared/domain.js";

function loadSnapshotFace(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (typeof image.decode === "function") {
        void image.decode().then(resolve, reject);
      } else {
        resolve();
      }
    };
    image.onerror = () => reject(new Error(`Unable to load card snapshot: ${url}`));
    image.src = url;
  });
}

export async function preloadCardPreview(card: CardIdentity, load: (url: string) => Promise<void> = loadSnapshotFace): Promise<void> {
  const urls = [...new Set([card.baseCardUrl, card.upgradedCardUrl].filter((url): url is string => Boolean(url)))];
  await Promise.allSettled(urls.map((url) => load(url)));
}
