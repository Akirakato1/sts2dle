import { describe, expect, test } from "vitest";

import { loadSnapshot } from "../../src/client/api/load-snapshot.js";

const card = {
  id: "ALCHEMIZE", name: "Alchemize", hasUpgrade: true, artUrl: "https://art.example/a.png",
  baseCardUrl: "https://cards.example/a.png", upgradedCardUrl: "https://cards.example/a-plus.png",
  base: { cardClass: "Silent", cardType: "Skill", mana: 1, rarity: "Rare", eternal: false, ethereal: false, exhaust: true, innate: false, retain: false, sly: false, unplayable: false },
  upgraded: { cardClass: "Silent", cardType: "Skill", mana: 0, rarity: "Rare", eternal: false, ethereal: false, exhaust: true, innate: false, retain: false, sly: false, unplayable: false },
};

const manifest = { schemaVersion: 1, sourceRevision: "revision", sourceLastModified: null, fetchedAt: "2026-08-12T00:00:00Z", generatedAt: "2026-08-12T00:00:00Z", cardCount: 1, upgradeCount: 1, baseGroupCount: 1, pairGroupCount: 1, files: {} };
const baseGroups = [{ key: "base", cardIds: ["ALCHEMIZE"] }];
const pairGroups = [{ key: "pair", cardIds: ["ALCHEMIZE"] }];
const spriteMap = { candidate: { url: "/candidate.png", width: 1, height: 1, displayScale: 1 }, guess: { url: "/guess.png", width: 1, height: 1, displayScale: 1 }, cards: { ALCHEMIZE: { candidate: { x: 0, y: 0, width: 1, height: 1 }, guess: { x: 0, y: 0, width: 1, height: 1 } } } };

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

    expect(snapshot.manifest.sourceRevision).toBe("revision");
    expect(snapshot.cardsById.get("ALCHEMIZE")?.name).toBe("Alchemize");
    expect(snapshot.pairGroupsByKey.get("pair")?.cardIds).toContain("ALCHEMIZE");
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
});
