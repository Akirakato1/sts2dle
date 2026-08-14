import { describe, expect, test } from "vitest";

import { loadSnapshot as sourceLoadSnapshot, type SpriteAtlasPreloader } from "../../src/client/api/load-snapshot.js";

const card = {
  id: "ALCHEMIZE", name: "Alchemize", hasUpgrade: true, artUrl: "https://art.example/a.png",
  baseCardUrl: "https://cards.example/a.png", upgradedCardUrl: "https://cards.example/a-plus.png",
  base: { cardClass: "Silent", cardType: "Skill", mana: 1, rarity: "Rare", target: "Self", powers: [], keywords: ["Exhaust"] },
  upgraded: { cardClass: "Silent", cardType: "Skill", mana: 0, rarity: "Rare", target: "Self", powers: [], keywords: ["Exhaust"] },
};

const REVISION = "ab".repeat(32);
const manifest = { schemaVersion: 2, sourceRevision: REVISION, sourceLastModified: null, fetchedAt: "2026-08-12T00:00:00.000Z", generatedAt: "2026-08-12T00:00:00.000Z", cardCount: 1, upgradeCount: 1, baseGroupCount: 1, pairGroupCount: 1, files: {} };
const baseGroups = [{ key: "base", cardIds: ["ALCHEMIZE"] }];
const pairGroups = [{ key: "pair", cardIds: ["ALCHEMIZE"] }];
const spriteMap = { candidate: { url: "/candidate.png", width: 1, height: 1, displayScale: 1 }, guess: { url: "/guess.png", width: 1, height: 1, displayScale: 1 }, cards: { ALCHEMIZE: { candidate: { x: 0, y: 0, width: 1, height: 1 }, guess: { x: 0, y: 0, width: 1, height: 1 } } } };
const noPreload: SpriteAtlasPreloader = async (): Promise<void> => undefined;

function loadSnapshot(fetchImpl: typeof fetch, signal?: AbortSignal) {
  return sourceLoadSnapshot(fetchImpl, signal, noPreload);
}

function loadSnapshotWithPreloader(fetchImpl: typeof fetch, signal: AbortSignal | undefined, preloader: SpriteAtlasPreloader) {
  return sourceLoadSnapshot(fetchImpl, signal, preloader);
}

function jsonFetch(values: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    return new Response(JSON.stringify(values[url]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("loadSnapshot", () => {
  test("assembles runtime files and cross-reference lookups", async () => {
    const snapshot = await loadSnapshot(jsonFetch({
      "/runtime/manifest.json": manifest, "/runtime/cards.json": [card], "/runtime/base-groups.json": baseGroups,
      "/runtime/pair-groups.json": pairGroups, "/runtime/sprite-map.json": spriteMap,
    }));

    expect(snapshot.manifest.sourceRevision).toBe(REVISION);
    expect(snapshot.cardsById.get("ALCHEMIZE")?.name).toBe("Alchemize");
    expect(snapshot.pairGroupsByKey.get("pair")?.cardIds).toContain("ALCHEMIZE");
  });

  test("accepts None as the unavailable mana value", async () => {
    const noCostCard = {
      ...card,
      base: { ...card.base, mana: "None" },
      upgraded: { ...card.upgraded, mana: "None" },
    };
    const snapshot = await loadSnapshot(jsonFetch({
      "/runtime/manifest.json": manifest,
      "/runtime/cards.json": [noCostCard],
      "/runtime/base-groups.json": baseGroups,
      "/runtime/pair-groups.json": pairGroups,
      "/runtime/sprite-map.json": spriteMap,
    }));

    expect(snapshot.cards[0]?.base.mana).toBe("None");
  });

  test("accepts canonical Codex rarities and rejects the legacy None rarity", async () => {
    const basicCard = {
      ...card,
      base: { ...card.base, rarity: "Basic" },
      upgraded: { ...card.upgraded, rarity: "Basic" },
    };
    await expect(loadSnapshot(jsonFetch({
      "/runtime/manifest.json": manifest,
      "/runtime/cards.json": [basicCard],
      "/runtime/base-groups.json": baseGroups,
      "/runtime/pair-groups.json": pairGroups,
      "/runtime/sprite-map.json": spriteMap,
    }))).resolves.toMatchObject({ cards: [expect.objectContaining({ base: expect.objectContaining({ rarity: "Basic" }) })] });

    const legacyCard = {
      ...card,
      base: { ...card.base, rarity: "None" },
      upgraded: { ...card.upgraded, rarity: "None" },
    };
    await expect(loadSnapshot(jsonFetch({
      "/runtime/manifest.json": manifest,
      "/runtime/cards.json": [legacyCard],
      "/runtime/base-groups.json": baseGroups,
      "/runtime/pair-groups.json": pairGroups,
      "/runtime/sprite-map.json": spriteMap,
    }))).rejects.toThrow("/runtime/cards.json");
  });

  test.each([
    ["unplayable feature", { ...card.base, unplayable: true }],
    ["en dash mana", { ...card.base, mana: "\u2013" }],
    ["duplicate powers", { ...card.base, powers: ["Weak", "Weak"] }],
    ["unsorted powers", { ...card.base, powers: ["Weak", "Vulnerable"] }],
    ["duplicate keywords", { ...card.base, keywords: ["Exhaust", "Exhaust"] }],
    ["out-of-order keywords", { ...card.base, keywords: ["Exhaust", "Ethereal"] }],
  ])("rejects a feature vector with %s", async (_label, base) => {
    const invalidCard = { ...card, base, upgraded: base };
    await expect(loadSnapshot(jsonFetch({
      "/runtime/manifest.json": manifest,
      "/runtime/cards.json": [invalidCard],
      "/runtime/base-groups.json": baseGroups,
      "/runtime/pair-groups.json": pairGroups,
      "/runtime/sprite-map.json": spriteMap,
    }))).rejects.toThrow("/runtime/cards.json");
  });

  test("includes a failed runtime URL in a non-success response error", async () => {
    const fetchImpl = (async (input: string | URL | Request) => new Response("missing", { status: String(input).includes("cards") ? 404 : 200 })) as typeof fetch;
    await expect(loadSnapshot(fetchImpl)).rejects.toThrow("/runtime/cards.json");
  });

  test("rejects a manifest count mismatch", async () => {
    await expect(loadSnapshot(jsonFetch({
      "/runtime/manifest.json": { ...manifest, cardCount: 2 }, "/runtime/cards.json": [card], "/runtime/base-groups.json": baseGroups,
      "/runtime/pair-groups.json": pairGroups, "/runtime/sprite-map.json": spriteMap,
    }))).rejects.toThrow("cardCount");
  });

  test.each([
    ["short revision", { sourceRevision: "abc" }],
    ["uppercase revision", { sourceRevision: "AB".repeat(32) }],
    ["non-canonical fetchedAt", { fetchedAt: "2026-08-12T00:00:00Z" }],
    ["offset generatedAt", { generatedAt: "2026-08-12T09:00:00.000+09:00" }],
    ["invalid timestamp", { generatedAt: "not-a-date" }],
  ])("rejects %s manifest metadata", async (_label, metadata) => {
    await expect(loadSnapshot(jsonFetch({
      "/runtime/manifest.json": { ...manifest, ...metadata },
      "/runtime/cards.json": [card],
      "/runtime/base-groups.json": baseGroups,
      "/runtime/pair-groups.json": pairGroups,
      "/runtime/sprite-map.json": spriteMap,
    }))).rejects.toThrow("/runtime/manifest.json");
  });

  test("rejects a group that references an unknown card", async () => {
    await expect(loadSnapshot(jsonFetch({
      "/runtime/manifest.json": manifest, "/runtime/cards.json": [card], "/runtime/base-groups.json": [{ key: "base", cardIds: ["MISSING"] }],
      "/runtime/pair-groups.json": pairGroups, "/runtime/sprite-map.json": spriteMap,
    }))).rejects.toThrow("MISSING");
  });

  test("identifies the URL for network, JSON, and schema failures", async () => {
    const network = (async (input: string | URL | Request) => { if (String(input).endsWith("manifest.json")) throw new Error("offline"); return new Response("{}", { status: 200 }); }) as typeof fetch;
    await expect(loadSnapshot(network)).rejects.toThrow("/runtime/manifest.json");
    const invalidJson = (async (input: string | URL | Request) => new Response(String(input).endsWith("cards.json") ? "{" : JSON.stringify(String(input).endsWith("manifest.json") ? manifest : String(input).endsWith("base-groups.json") ? baseGroups : String(input).endsWith("pair-groups.json") ? pairGroups : spriteMap), { status: 200 })) as typeof fetch;
    await expect(loadSnapshot(invalidJson)).rejects.toThrow("/runtime/cards.json");
    await expect(loadSnapshot(jsonFetch({ "/runtime/manifest.json": manifest, "/runtime/cards.json": [{}], "/runtime/base-groups.json": baseGroups, "/runtime/pair-groups.json": pairGroups, "/runtime/sprite-map.json": spriteMap }))).rejects.toThrow("/runtime/cards.json");
  });

  test("does not expose a network error message while identifying its URL", async () => {
    const fetchImpl = (async (input: string | URL | Request) => { if (String(input).endsWith("manifest.json")) throw new Error("SECRET_TOKEN=do-not-show"); return new Response("{}", { status: 200 }); }) as typeof fetch;
    await expect(loadSnapshot(fetchImpl)).rejects.toThrow("Failed to load /runtime/manifest.json");
    await expect(loadSnapshot(fetchImpl)).rejects.not.toThrow("SECRET_TOKEN");
    const error = await loadSnapshot(fetchImpl).catch((caught: unknown) => caught as Error) as Error;
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("SECRET_TOKEN");
  });

  test("forwards an abort signal and validates upgrade counts", async () => {
    const seen: Array<{ url: string; signal: AbortSignal | undefined }> = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(input), signal: init?.signal ?? undefined }); return new Response(JSON.stringify(manifest), { status: 200 }); }) as typeof fetch;
    const controller = new AbortController();
    await expect(loadSnapshot(fetchImpl, controller.signal)).rejects.toThrow("/runtime/cards.json");
    expect(seen).toEqual([
      "/runtime/manifest.json", "/runtime/cards.json", "/runtime/base-groups.json", "/runtime/pair-groups.json", "/runtime/sprite-map.json",
    ].map((url) => ({ url, signal: controller.signal })));
    await expect(loadSnapshot(jsonFetch({ "/runtime/manifest.json": { ...manifest, upgradeCount: 0 }, "/runtime/cards.json": [card], "/runtime/base-groups.json": baseGroups, "/runtime/pair-groups.json": pairGroups, "/runtime/sprite-map.json": spriteMap }))).rejects.toThrow("upgradeCount");
  });

  test("propagates an actual abort without exposing its message", async () => {
    const controller = new AbortController();
    const fetchImpl = ((_: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("secret abort detail", "AbortError")), { once: true });
    })) as typeof fetch;
    const loading = loadSnapshot(fetchImpl, controller.signal);
    controller.abort();
    await expect(loading).rejects.toThrow("/runtime/manifest.json");
    await expect(loading).rejects.not.toThrow("secret abort detail");
  });

  test("awaits validated sprite readiness with the original signal", async () => {
    let release!: () => void;
    const readiness = new Promise<void>((resolve) => { release = resolve; });
    const calls: Array<{ map: Parameters<SpriteAtlasPreloader>[0]; signal: AbortSignal | undefined }> = [];
    const controller = new AbortController();
    const preloader: SpriteAtlasPreloader = (map, signal): Promise<void> => {
      calls.push({ map, signal });
      return readiness;
    };
    const loading = loadSnapshotWithPreloader(jsonFetch({
      "/runtime/manifest.json": manifest,
      "/runtime/cards.json": [card],
      "/runtime/base-groups.json": baseGroups,
      "/runtime/pair-groups.json": pairGroups,
      "/runtime/sprite-map.json": spriteMap,
    }), controller.signal, preloader);

    await expect.poll(() => calls.length).toBe(1);
    expect(calls).toEqual([{ map: spriteMap, signal: controller.signal }]);
    let settled = false;
    void loading.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await expect(loading).resolves.toMatchObject({ spriteMap });
  });

  test("does not preload when JSON, schema, or references are invalid", async () => {
    const preloader = async (): Promise<void> => { throw new Error("preload must not run"); };
    const invalidJson = (async (input: string | URL | Request) => new Response(
      String(input).endsWith("cards.json") ? "{" : JSON.stringify(String(input).endsWith("manifest.json") ? manifest : String(input).endsWith("base-groups.json") ? baseGroups : String(input).endsWith("pair-groups.json") ? pairGroups : spriteMap),
      { status: 200 },
    )) as typeof fetch;
    await expect(loadSnapshotWithPreloader(invalidJson, undefined, preloader)).rejects.toThrow("/runtime/cards.json");
    await expect(loadSnapshotWithPreloader(jsonFetch({
      "/runtime/manifest.json": manifest,
      "/runtime/cards.json": [card],
      "/runtime/base-groups.json": [{ key: "base", cardIds: ["MISSING"] }],
      "/runtime/pair-groups.json": pairGroups,
      "/runtime/sprite-map.json": spriteMap,
    }), undefined, preloader)).rejects.toThrow("MISSING");
  });
});
