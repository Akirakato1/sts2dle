import { describe, expect, test, vi } from "vitest";

import { preloadCardPreview } from "../../src/client/game/preload-card-preview.js";
import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";

const vector: FeatureVector = { cardClass: "Silent", cardType: "Skill", mana: 1, rarity: "Common", target: "Self", powers: [], keywords: [] };

function makeCard(baseCardUrl: string | null, upgradedCardUrl: string | null): CardIdentity {
  return { id: "card", name: "Blur", hasUpgrade: upgradedCardUrl !== null, artUrl: "", baseCardUrl, upgradedCardUrl, base: vector, upgraded: vector };
}

describe("preloadCardPreview", () => {
  test("preloads unique available snapshot faces concurrently", async () => {
    const upgradedCard = makeCard("/snapshots/blur.png", "/snapshots/blur-plus.png");
    const pending = new Map<string, () => void>();
    const load = vi.fn((url: string) => new Promise<void>((resolve) => pending.set(url, resolve)));

    const promise = preloadCardPreview(upgradedCard, load);

    expect(load.mock.calls.map(([url]) => url)).toEqual([upgradedCard.baseCardUrl, upgradedCard.upgradedCardUrl]);
    for (const resolve of pending.values()) resolve();
    await expect(promise).resolves.toBeUndefined();
  });

  test("preloads only the base face when no upgrade is available", async () => {
    const card = makeCard("/snapshots/blur.png", null);
    const load = vi.fn().mockResolvedValue(undefined);

    await expect(preloadCardPreview(card, load)).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledWith("/snapshots/blur.png");
    expect(load).toHaveBeenCalledTimes(1);
  });

  test("deduplicates matching face URLs and skips absent URLs", async () => {
    const load = vi.fn().mockResolvedValue(undefined);

    await preloadCardPreview(makeCard("/snapshots/blur.png", "/snapshots/blur.png"), load);
    await preloadCardPreview(makeCard("", null), load);

    expect(load.mock.calls.map(([url]) => url)).toEqual(["/snapshots/blur.png"]);
  });

  test("settles successfully when one face fails to warm", async () => {
    const load = vi.fn((url: string) => url.endsWith("plus.png") ? Promise.reject(new Error("network")) : Promise.resolve());

    await expect(preloadCardPreview(makeCard("/snapshots/blur.png", "/snapshots/blur-plus.png"), load)).resolves.toBeUndefined();
  });
});
