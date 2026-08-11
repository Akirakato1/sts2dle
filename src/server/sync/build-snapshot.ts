import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CardIdentity, SnapshotManifest } from "../../shared/domain.js";
import { buildGroups } from "../../shared/groups.js";
import { buildSprites } from "../images/build-sprites.js";
import { assertAllowedImageUrl, parseAllowedImageOrigins } from "../images/url-policy.js";
import { fallbackFilename, fallbackUrl } from "../images/fallback-path.js";
import type { RawSpireCard } from "../spire-codex/schema.js";
import type { SpireCodexClient } from "../spire-codex/client.js";
import { normalizeCard } from "./normalize-card.js";
import type { SnapshotStore } from "./snapshot-store.js";
import {
  validateSnapshot,
  type SnapshotAcceptanceReport,
} from "./validate-snapshot.js";

const DEFAULT_BASE_URL = "https://spire-codex.com";

export interface FallbackRendererLike {
  render(raw: RawSpireCard, upgraded: boolean, destination: string): Promise<void>;
}

export interface BuildSnapshotDependencies {
  client: Pick<SpireCodexClient, "fetchCards">;
  store: SnapshotStore;
  fetchImpl: typeof fetch;
  fallbackRenderer: FallbackRendererLike;
  baseUrl?: string;
  artworkConcurrency?: number;
  allowedArtworkOrigins: readonly string[];
  allowedFullCardOrigins: readonly string[];
  writeStableJsonImpl?: typeof writeStableJson;
  hashFileImpl?: (path: string) => Promise<string>;
  now?: () => Date;
}

export interface ActivatedSnapshot {
  buildId: string;
  path: string;
  manifest: SnapshotManifest;
  report: SnapshotAcceptanceReport;
}

export async function buildSnapshot(
  dependencies: BuildSnapshotDependencies,
): Promise<ActivatedSnapshot> {
  const fetched = await dependencies.client.fetchCards();
  const allowedArtworkOrigins = parseAllowedImageOrigins(
    dependencies.allowedArtworkOrigins,
    "Artwork",
  );
  const allowedFullCardOrigins = parseAllowedImageOrigins(
    dependencies.allowedFullCardOrigins,
    "Full-card",
  );
  const rawCards = [...fetched.cards].sort(compareRawCardIds);
  rejectDuplicateIds(rawCards);
  const cards = markDuplicateNames(rawCards.map((raw) => normalizeCard(
    raw,
    dependencies.baseUrl ?? DEFAULT_BASE_URL,
  )));
  validateRemoteImageUrls(cards, allowedArtworkOrigins, allowedFullCardOrigins);
  const groups = buildGroups(cards);
  const staging = await dependencies.store.createStaging(fetched.sourceRevision);
  let settled = false;
  try {
    const spriteMap = await buildSprites({
      cards,
      outputDir: staging.path,
      fetchImpl: dependencies.fetchImpl,
      concurrency: dependencies.artworkConcurrency ?? 4,
      allowedArtworkOrigins,
    });
    await renderMissingFullCards(rawCards, cards, staging.path, dependencies.fallbackRenderer);
    const writeJson = dependencies.writeStableJsonImpl ?? writeStableJson;
    await settleAllOrThrow([
      writeJson(join(staging.path, "cards.json"), cards),
      writeJson(join(staging.path, "base-groups.json"), groups.baseGroups),
      writeJson(join(staging.path, "pair-groups.json"), groups.pairGroups),
      writeJson(join(staging.path, "sprite-map.json"), spriteMap),
    ]);
    const files = await hashEmittedFiles(staging.path, dependencies.hashFileImpl ?? hashFile);
    const manifest: SnapshotManifest = {
      schemaVersion: 1,
      sourceRevision: fetched.sourceRevision,
      sourceLastModified: fetched.lastModified,
      fetchedAt: fetched.fetchedAt,
      generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
      cardCount: cards.length,
      upgradeCount: cards.filter((card) => card.hasUpgrade).length,
      baseGroupCount: groups.baseGroups.length,
      pairGroupCount: groups.pairGroups.length,
      files,
    };
    await writeJson(join(staging.path, "manifest.json"), manifest);
    const report = await validateSnapshot(staging.path, {
      allowedArtworkOrigins,
      allowedFullCardOrigins,
    });
    const activatedPath = await staging.activate();
    settled = true;
    return { buildId: staging.buildId, path: activatedPath, manifest, report };
  } catch (error: unknown) {
    if (!settled) {
      try {
        await staging.abort();
      } catch (cleanupError: unknown) {
        throw new AggregateError(
          [error, cleanupError],
          "Snapshot build failed and staging cleanup also failed",
          { cause: error },
        );
      }
    }
    throw error;
  }
}

function validateRemoteImageUrls(
  cards: readonly CardIdentity[],
  allowedArtworkOrigins: readonly string[],
  allowedFullCardOrigins: readonly string[],
): void {
  for (const card of cards) {
    assertAllowedImageUrl(card.artUrl, allowedArtworkOrigins, `Artwork for card ${card.id}`);
    if (card.baseCardUrl) {
      assertAllowedImageUrl(card.baseCardUrl, allowedFullCardOrigins, `Full-card base for card ${card.id}`);
    }
    if (card.upgradedCardUrl) {
      assertAllowedImageUrl(card.upgradedCardUrl, allowedFullCardOrigins, `Full-card upgraded for card ${card.id}`);
    }
  }
}

export async function writeStableJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${stableStringify(value)}\n`, "utf8");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [
    key,
    sortJsonValue((value as Record<string, unknown>)[key]),
  ]));
}

function compareRawCardIds(left: RawSpireCard, right: RawSpireCard): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function rejectDuplicateIds(cards: readonly RawSpireCard[]): void {
  for (let index = 1; index < cards.length; index += 1) {
    if (cards[index - 1]?.id === cards[index]?.id) {
      throw new Error(`Duplicate card ID: ${cards[index]?.id}`);
    }
  }
}

function markDuplicateNames(cards: CardIdentity[]): CardIdentity[] {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const key = normalizedDisplayName(card.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return cards.map((card) => counts.get(normalizedDisplayName(card.name)) === 1
    ? card
    : { ...card, duplicateName: true });
}

function normalizedDisplayName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

async function renderMissingFullCards(
  rawCards: readonly RawSpireCard[],
  cards: CardIdentity[],
  stagingPath: string,
  renderer: FallbackRendererLike,
): Promise<void> {
  const rawById = new Map(rawCards.map((raw) => [raw.id, raw]));
  const fallbackPath = join(stagingPath, "fallback");
  let createdFallbackDirectory = false;
  for (const card of cards) {
    const raw = rawById.get(card.id)!;
    if (!card.baseCardUrl) {
      if (!createdFallbackDirectory) {
        await mkdir(fallbackPath, { recursive: true });
        createdFallbackDirectory = true;
      }
      const filename = fallbackFilename(card.id, false);
      await renderer.render(raw, false, join(fallbackPath, filename));
      card.baseCardUrl = fallbackUrl(card.id, false);
    }
    if (card.hasUpgrade && !card.upgradedCardUrl) {
      if (!createdFallbackDirectory) {
        await mkdir(fallbackPath, { recursive: true });
        createdFallbackDirectory = true;
      }
      const filename = fallbackFilename(card.id, true);
      await renderer.render(raw, true, join(fallbackPath, filename));
      card.upgradedCardUrl = fallbackUrl(card.id, true);
    }
  }
}

async function hashEmittedFiles(
  root: string,
  hashFileImpl: (path: string) => Promise<string>,
): Promise<Record<string, string>> {
  const filenames = (await listFiles(root)).filter((filename) => filename !== "manifest.json").sort();
  const entries = await settleAllOrThrow(filenames.map(async (filename) => [
    filename,
    await hashFileImpl(join(root, ...filename.split("/"))),
  ] as const));
  return Object.fromEntries(entries);
}

async function hashFile(path: string): Promise<string> {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function settleAllOrThrow<T>(operations: readonly Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(operations);
  const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length === 1) throw failures[0]!.reason;
  if (failures.length > 1) {
    throw new AggregateError(failures.map((failure) => failure.reason), "Multiple snapshot I/O operations failed");
  }
  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
}

async function listFiles(root: string, relativePath = ""): Promise<string[]> {
  const directory = join(root, ...relativePath.split("/").filter(Boolean));
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}
