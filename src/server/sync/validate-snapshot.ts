import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import sharp from "sharp";
import { baseKey, pairKey } from "../../shared/feature-keys.js";
import { buildGroups } from "../../shared/groups.js";
import type {
  BaseGroup,
  CardIdentity,
  FeatureVector,
  PairGroup,
  SnapshotManifest,
  SpriteAtlasMeta,
  SpriteMap,
  SpriteRect,
} from "../../shared/domain.js";
import {
  CARD_KEYWORDS,
  CARD_RARITIES,
  CARD_TARGETS,
  CARD_TYPES,
  FEATURE_ORDER,
  UNIQUE_POWER,
} from "../../shared/domain.js";
import { isCanonicalIsoTimestamp, SOURCE_REVISION_PATTERN } from "../../shared/snapshot-schema.js";
import type { ActivatedSnapshot } from "./build-snapshot.js";
import { assertAllowedImageUrl, parseAllowedImageOrigins } from "../images/url-policy.js";
import { fallbackUrl } from "../images/fallback-path.js";

const REQUIRED_HASHED_FILES = [
  "base-groups.json",
  "candidate.webp",
  "cards.json",
  "guess.webp",
  "pair-groups.json",
  "sprite-map.json",
] as const;
const CARD_CLASSES = new Set(["Ironclad", "Silent", "Defect", "Necrobinder", "Regent", "Neutral", "Event"]);
const CARD_TYPE_VALUES = new Set(CARD_TYPES);
const CARD_RARITY_VALUES = new Set(CARD_RARITIES);
const CARD_TARGET_VALUES = new Set(CARD_TARGETS);
const CARD_KEYWORD_VALUES = new Set(CARD_KEYWORDS);
const MAX_ATLAS_DIMENSION = 8192;
const FALLBACK_WIDTH = 400;
const FALLBACK_HEIGHT = 520;

export interface SnapshotAcceptanceReport {
  cardCount: number;
  upgradeCount: number;
  baseGroupCount: number;
  pairGroupCount: number;
  baseGroupHistogram: Record<string, number>;
  pairGroupHistogram: Record<string, number>;
  missingRawArtCardIds: string[];
  fallbackCardIds: string[];
  candidateSprite: { width: number; height: number; bytes: number };
  guessSprite: { width: number; height: number; bytes: number };
}

export class SnapshotValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Snapshot validation failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "SnapshotValidationError";
  }
}

export interface SnapshotValidationOptions {
  allowedArtworkOrigins: readonly string[];
  allowedFullCardOrigins: readonly string[];
  imageDecodeObserver?: (request: SnapshotImageDecodeRequest) => void;
}

export interface SnapshotImageDecodeRequest {
  label: string;
  limitInputPixels: number;
}

export async function validateSnapshot(
  snapshotPath: string,
  options: SnapshotValidationOptions,
): Promise<SnapshotAcceptanceReport> {
  const issues: string[] = [];
  const allowedArtworkOrigins = parseAllowedImageOrigins(options.allowedArtworkOrigins, "Artwork");
  const allowedFullCardOrigins = parseAllowedImageOrigins(options.allowedFullCardOrigins, "Full-card");
  const manifestValue = await readJson(snapshotPath, "manifest.json", issues);
  if (!isRecord(manifestValue)) {
    issues.push("Invalid manifest.json: expected an object");
    throw new SnapshotValidationError(uniqueIssues(issues));
  }
  const manifest = manifestValue as unknown as SnapshotManifest;
  validateManifestShape(manifestValue, issues);

  const [cardsValue, baseGroupsValue, pairGroupsValue, spriteMapValue] = await Promise.all([
    readJson(snapshotPath, "cards.json", issues),
    readJson(snapshotPath, "base-groups.json", issues),
    readJson(snapshotPath, "pair-groups.json", issues),
    readJson(snapshotPath, "sprite-map.json", issues),
  ]);
  await validateFileSetAndHashes(snapshotPath, manifestValue, issues);
  if (
    !Array.isArray(cardsValue) ||
    !Array.isArray(baseGroupsValue) ||
    !Array.isArray(pairGroupsValue) ||
    !isRecord(spriteMapValue)
  ) {
    if (cardsValue !== undefined && !Array.isArray(cardsValue)) issues.push("Invalid cards.json: expected an array");
    if (baseGroupsValue !== undefined && !Array.isArray(baseGroupsValue)) issues.push("Invalid base-groups.json: expected an array");
    if (pairGroupsValue !== undefined && !Array.isArray(pairGroupsValue)) issues.push("Invalid pair-groups.json: expected an array");
    if (spriteMapValue !== undefined && !isRecord(spriteMapValue)) issues.push("Invalid sprite-map.json: expected an object");
    throw new SnapshotValidationError(uniqueIssues(issues));
  }

  const cards = cardsValue as unknown as CardIdentity[];
  const baseGroups = baseGroupsValue as unknown as BaseGroup[];
  const pairGroups = pairGroupsValue as unknown as PairGroup[];
  const spriteMap = spriteMapValue as unknown as SpriteMap;
  validateCounts(manifest, cards, baseGroups, pairGroups, issues);
  const cardsById = validateCards(
    cards,
    manifestValue,
    allowedArtworkOrigins,
    allowedFullCardOrigins,
    issues,
  );
  validateGroups("base", baseGroupsValue, cardsById, issues);
  validateGroups("pair", pairGroupsValue, cardsById, issues);
  validateExactGroups(cardsById, baseGroupsValue, pairGroupsValue, issues);
  validateSpriteMap(spriteMapValue, cardsById, issues);
  const atlasContracts = createAtlasContracts(cardsById.size);

  const [candidateSprite, guessSprite] = await Promise.all([
    inspectSprite(snapshotPath, "candidate.webp", atlasContracts.candidate, options.imageDecodeObserver, issues),
    inspectSprite(snapshotPath, "guess.webp", atlasContracts.guess, options.imageDecodeObserver, issues),
    inspectFallbackImages(snapshotPath, cards, options.imageDecodeObserver, issues),
  ]);
  if (issues.length > 0) throw new SnapshotValidationError(uniqueIssues(issues));

  return {
    cardCount: cards.length,
    upgradeCount: cards.filter((card) => card.hasUpgrade).length,
    baseGroupCount: baseGroups.length,
    pairGroupCount: pairGroups.length,
    baseGroupHistogram: histogram(baseGroups),
    pairGroupHistogram: histogram(pairGroups),
    missingRawArtCardIds: cards.filter((card) => card.artUrl.trim() === "").map((card) => card.id),
    fallbackCardIds: cards
      .filter((card) => isFallbackUrl(card.baseCardUrl) || isFallbackUrl(card.upgradedCardUrl))
      .map((card) => card.id),
    candidateSprite: candidateSprite!,
    guessSprite: guessSprite!,
  };
}

export async function loadActivatedSnapshot(
  snapshotPath: string,
  options: SnapshotValidationOptions,
): Promise<ActivatedSnapshot> {
  const report = await validateSnapshot(snapshotPath, options);
  const manifestValue = await readJson(snapshotPath, "manifest.json", []);
  if (!isRecord(manifestValue)) throw new SnapshotValidationError(["Invalid manifest.json: expected an object"]);
  return {
    buildId: basename(snapshotPath),
    path: snapshotPath,
    manifest: manifestValue as unknown as SnapshotManifest,
    report,
  };
}

function validateManifestShape(manifest: Record<string, unknown>, issues: string[]): void {
  if (manifest.schemaVersion !== 2) issues.push("Unsupported snapshot schema version");
  if (typeof manifest.sourceRevision !== "string" || !SOURCE_REVISION_PATTERN.test(manifest.sourceRevision)) {
    issues.push("Invalid manifest field: sourceRevision");
  }
  for (const field of ["fetchedAt", "generatedAt"] as const) {
    if (typeof manifest[field] !== "string" || !isCanonicalIsoTimestamp(manifest[field])) {
      issues.push(`Invalid manifest field: ${field}`);
    }
  }
  if (manifest.sourceLastModified !== null && typeof manifest.sourceLastModified !== "string") {
    issues.push("Invalid manifest field: sourceLastModified");
  }
  for (const field of ["cardCount", "upgradeCount", "baseGroupCount", "pairGroupCount"] as const) {
    if (!isNonNegativeInteger(manifest[field])) issues.push(`Invalid manifest count: ${field}`);
  }
  if (!isRecord(manifest.files)) issues.push("Invalid manifest files table");
}

async function validateFileSetAndHashes(
  snapshotPath: string,
  manifest: Record<string, unknown>,
  issues: string[],
): Promise<void> {
  const files = isRecord(manifest.files) ? manifest.files : {};
  for (const filename of REQUIRED_HASHED_FILES) {
    if (!Object.hasOwn(files, filename)) issues.push(`Manifest is missing file hash: ${filename}`);
  }
  let actualFiles: string[] = [];
  try {
    actualFiles = (await listFiles(snapshotPath)).filter((filename) => filename !== "manifest.json").sort();
  } catch (error: unknown) {
    issues.push(`Could not enumerate snapshot files: ${safeErrorMessage(error)}`);
  }
  for (const filename of actualFiles) {
    if (!Object.hasOwn(files, filename)) issues.push(`Snapshot file is not hashed: ${filename}`);
  }
  for (const [filename, expectedHash] of Object.entries(files)) {
    if (!isSafeRelativeFilename(filename)) {
      issues.push(`Unsafe manifest file path: ${filename}`);
      continue;
    }
    if (typeof expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(expectedHash)) {
      issues.push(`Invalid file hash for ${filename}`);
      continue;
    }
    try {
      const bytes = await readFile(join(snapshotPath, ...filename.split("/")));
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (actualHash !== expectedHash) issues.push(`File hash mismatch: ${filename}`);
    } catch (error: unknown) {
      if (isNotFound(error)) issues.push(`Missing snapshot file: ${filename}`);
      else issues.push(`Could not read snapshot file ${filename}: ${safeErrorMessage(error)}`);
    }
  }
}

function validateCounts(
  manifest: SnapshotManifest,
  cards: readonly CardIdentity[],
  baseGroups: readonly BaseGroup[],
  pairGroups: readonly PairGroup[],
  issues: string[],
): void {
  if (manifest.cardCount !== cards.length) {
    issues.push(`Card count mismatch: manifest=${manifest.cardCount}, cards=${cards.length}`);
  }
  const upgrades = cards.filter((card) => isRecord(card) && card.hasUpgrade === true).length;
  if (manifest.upgradeCount !== upgrades) {
    issues.push(`Upgrade count mismatch: manifest=${manifest.upgradeCount}, cards=${upgrades}`);
  }
  if (manifest.baseGroupCount !== baseGroups.length) {
    issues.push(`Base group count mismatch: manifest=${manifest.baseGroupCount}, groups=${baseGroups.length}`);
  }
  if (manifest.pairGroupCount !== pairGroups.length) {
    issues.push(`Pair group count mismatch: manifest=${manifest.pairGroupCount}, groups=${pairGroups.length}`);
  }
}

function validateCards(
  cards: unknown[],
  manifest: Record<string, unknown>,
  allowedArtworkOrigins: readonly string[],
  allowedFullCardOrigins: readonly string[],
  issues: string[],
): Map<string, CardIdentity> {
  const cardsById = new Map<string, CardIdentity>();
  let previousId: string | undefined;
  for (const [index, value] of cards.entries()) {
    if (!isRecord(value)) {
      issues.push(`Invalid card at index ${index}: expected an object`);
      continue;
    }
    const id = typeof value.id === "string" && value.id.length > 0 ? value.id : `[index ${index}]`;
    if (id.startsWith("[index ")) issues.push(`Invalid card ID at index ${index}`);
    else if (cardsById.has(id)) issues.push(`Duplicate card ID: ${id}`);
    else cardsById.set(id, value as unknown as CardIdentity);
    if (!id.startsWith("[index ") && previousId !== undefined && previousId >= id) {
      issues.push(`Unstable card ordering at ${id}`);
    }
    if (!id.startsWith("[index ")) previousId = id;
    if (typeof value.name !== "string" || value.name.length === 0) issues.push(`Missing card name for ${id}`);
    if (value.duplicateName !== undefined && typeof value.duplicateName !== "boolean") {
      issues.push(`Invalid duplicate-name marker for ${id}`);
    }
    if (typeof value.hasUpgrade !== "boolean") issues.push(`Invalid upgrade flag for ${id}`);
    if (typeof value.artUrl !== "string" || value.artUrl.trim() === "") {
      issues.push(`Missing raw artwork URL for ${id}`);
    } else {
      try {
        assertAllowedImageUrl(value.artUrl, allowedArtworkOrigins, `Artwork for card ${id}`);
      } catch (error: unknown) {
        issues.push(safeErrorMessage(error));
      }
    }
    validateRevealUrl(value.baseCardUrl, "base", id, manifest, allowedFullCardOrigins, issues);
    if (value.hasUpgrade === true) {
      validateRevealUrl(value.upgradedCardUrl, "upgraded", id, manifest, allowedFullCardOrigins, issues);
    } else if (value.upgradedCardUrl !== null && value.upgradedCardUrl !== undefined) {
      validateRevealUrl(value.upgradedCardUrl, "upgraded", id, manifest, allowedFullCardOrigins, issues);
    }
    validateFeatureVector(value.base, "base", id, issues);
    validateFeatureVector(value.upgraded, "upgraded", id, issues);
    if (value.hasUpgrade === false && isRecord(value.base) && isRecord(value.upgraded)) {
      if (!featureVectorsEqual(value.base, value.upgraded)) {
        issues.push(`Non-upgradable card has different effective upgraded features: ${id}`);
      }
    }
  }
  validateDuplicateNameMarkers(cards, issues);
  return cardsById;
}

function featureVectorsEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  return FEATURE_ORDER.every((feature) => {
    const leftValue = left[feature];
    const rightValue = right[feature];
    if (Array.isArray(leftValue) || Array.isArray(rightValue)) {
      return Array.isArray(leftValue) && Array.isArray(rightValue) &&
        leftValue.length === rightValue.length && leftValue.every((value, index) => value === rightValue[index]);
    }
    return leftValue === rightValue;
  });
}

function validateRevealUrl(
  value: unknown,
  variant: "base" | "upgraded",
  cardId: string,
  manifest: Record<string, unknown>,
  allowedFullCardOrigins: readonly string[],
  issues: string[],
): void {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`Missing ${variant} full-card URL for ${cardId}`);
    return;
  }
  if (value.startsWith("/runtime/fallback/")) {
    const filename = value.slice("/runtime/".length);
    const expectedUrl = fallbackUrl(cardId, variant === "upgraded");
    if (value !== expectedUrl) {
      issues.push(`Fallback URL mapping for ${cardId} ${variant} must be ${expectedUrl}`);
    }
    if (!isSafeRelativeFilename(filename) || !isRecord(manifest.files) || !Object.hasOwn(manifest.files, filename)) {
      issues.push(`Missing fallback file for ${variant} card ${cardId}: ${value}`);
    }
    return;
  }
  try {
    assertAllowedImageUrl(value, allowedFullCardOrigins, `Full-card ${variant} for card ${cardId}`);
  } catch (error: unknown) {
    issues.push(safeErrorMessage(error));
  }
}

function validateDuplicateNameMarkers(cards: readonly unknown[], issues: string[]): void {
  const counts = new Map<string, number>();
  for (const value of cards) {
    if (!isRecord(value) || typeof value.name !== "string") continue;
    const key = normalizedDisplayName(value.name);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const value of cards) {
    if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") continue;
    const expected = (counts.get(normalizedDisplayName(value.name)) ?? 0) > 1;
    if (expected && value.duplicateName !== true) {
      issues.push(`Duplicate-name marker for ${value.id} expected true`);
    }
    if (!expected && value.duplicateName !== undefined) {
      issues.push(`Duplicate-name marker for ${value.id} expected absent`);
    }
  }
}

function normalizedDisplayName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function validateFeatureVector(
  value: unknown,
  variant: "base" | "upgraded",
  cardId: string,
  issues: string[],
): void {
  if (!isRecord(value)) {
    issues.push(`Invalid ${variant} feature vector for ${cardId}`);
    return;
  }
  const actualKeys = Object.keys(value);
  const missingKeys = FEATURE_ORDER.filter((feature) => !Object.hasOwn(value, feature));
  const extraKeys = actualKeys.filter((feature) => !(FEATURE_ORDER as readonly string[]).includes(feature));
  if (missingKeys.length > 0 || extraKeys.length > 0 || actualKeys.length !== FEATURE_ORDER.length) {
    const details = [
      missingKeys.length > 0 ? `missing=${missingKeys.join(",")}` : "",
      extraKeys.length > 0 ? `extra=${extraKeys.join(",")}` : "",
    ].filter(Boolean).join("; ");
    issues.push(`Invalid ${variant} feature keys for ${cardId}: ${details}`);
  }
  if (!CARD_CLASSES.has(String(value.cardClass))) issues.push(`Unknown card class in ${variant} features for ${cardId}`);
  if (!CARD_TYPE_VALUES.has(String(value.cardType) as (typeof CARD_TYPES)[number])) issues.push(`Unknown card type in ${variant} features for ${cardId}`);
  if (!CARD_RARITY_VALUES.has(String(value.rarity) as (typeof CARD_RARITIES)[number])) issues.push(`Unknown card rarity in ${variant} features for ${cardId}`);
  if (!isMana(value.mana)) issues.push(`Unknown mana value in ${variant} features for ${cardId}`);
  if (!CARD_TARGET_VALUES.has(String(value.target) as (typeof CARD_TARGETS)[number])) {
    issues.push(`Unknown card target in ${variant} features for ${cardId}`);
  }
  validateCanonicalPowers(value.powers, variant, cardId, issues);
  validateCanonicalKeywords(value.keywords, variant, cardId, issues);
}

function validateCanonicalPowers(
  value: unknown,
  variant: "base" | "upgraded",
  cardId: string,
  issues: string[],
): void {
  if (!Array.isArray(value) || !value.every((power) => typeof power === "string" && power.length > 0)) {
    issues.push(`Invalid powers in ${variant} features for ${cardId}`);
    return;
  }
  if (new Set(value).size !== value.length) issues.push(`Duplicate powers in ${variant} features for ${cardId}`);
  const recurring = value.filter((power) => power !== UNIQUE_POWER);
  const expected = [...recurring].sort((left, right) => left.localeCompare(right, "en-US"));
  if (value.includes(UNIQUE_POWER)) expected.push(UNIQUE_POWER);
  if (value.length !== expected.length || value.some((power, index) => power !== expected[index])) {
    issues.push(`Non-canonical powers in ${variant} features for ${cardId}`);
  }
}

function validateCanonicalKeywords(
  value: unknown,
  variant: "base" | "upgraded",
  cardId: string,
  issues: string[],
): void {
  if (!Array.isArray(value)) {
    issues.push(`Invalid keywords in ${variant} features for ${cardId}`);
    return;
  }
  for (const keyword of value) {
    if (!CARD_KEYWORD_VALUES.has(String(keyword) as (typeof CARD_KEYWORDS)[number])) {
      issues.push(`Unknown keyword ${String(keyword).toLowerCase()} in ${variant} features for ${cardId}`);
    }
  }
  if (new Set(value).size !== value.length) issues.push(`Duplicate keywords in ${variant} features for ${cardId}`);
  const expected = CARD_KEYWORDS.filter((keyword) => value.includes(keyword));
  if (value.length !== expected.length || value.some((keyword, index) => keyword !== expected[index])) {
    issues.push(`Non-canonical keywords in ${variant} features for ${cardId}`);
  }
}

function validateGroups(
  kind: "base" | "pair",
  groups: unknown[],
  cardsById: ReadonlyMap<string, CardIdentity>,
  issues: string[],
): void {
  const groupLabel = `${kind} group`;
  const groupsByKey = new Map<string, { cardIds: string[] }>();
  const seenCardIds = new Set<string>();
  let previousKey: string | undefined;
  for (const [index, value] of groups.entries()) {
    if (!isRecord(value) || typeof value.key !== "string" || !Array.isArray(value.cardIds)) {
      issues.push(`Invalid ${groupLabel} at index ${index}`);
      continue;
    }
    const cardIds = value.cardIds.filter((id): id is string => typeof id === "string");
    if (cardIds.length !== value.cardIds.length) issues.push(`Invalid card ID in ${groupLabel} ${value.key}`);
    if (groupsByKey.has(value.key)) issues.push(`Duplicate ${groupLabel} key: ${value.key}`);
    else groupsByKey.set(value.key, { cardIds });
    if (previousKey !== undefined && previousKey >= value.key) issues.push(`Unstable ${kind} group ordering at ${value.key}`);
    previousKey = value.key;
    let previousCardId: string | undefined;
    const withinGroup = new Set<string>();
    for (const cardId of cardIds) {
      if (!cardsById.has(cardId)) issues.push(`Unknown card ID ${cardId} in ${groupLabel} ${value.key}`);
      if (withinGroup.has(cardId) || seenCardIds.has(cardId)) issues.push(`Duplicate group card ID ${cardId} in ${kind} groups`);
      withinGroup.add(cardId);
      seenCardIds.add(cardId);
      if (previousCardId !== undefined && previousCardId >= cardId) issues.push(`Unstable card ordering in ${groupLabel} ${value.key}`);
      previousCardId = cardId;
    }
  }
  for (const card of cardsById.values()) {
    if (!isFeatureVector(card.base) || !isFeatureVector(card.upgraded)) continue;
    const expectedKey = kind === "base" ? baseKey(card.base) : pairKey(card);
    if (!groupsByKey.get(expectedKey)?.cardIds.includes(card.id)) {
      issues.push(`Card missing from expected ${kind} group: ${card.id} (${expectedKey})`);
    }
  }
}

function validateExactGroups(
  cardsById: ReadonlyMap<string, CardIdentity>,
  baseGroups: unknown[],
  pairGroups: unknown[],
  issues: string[],
): void {
  const cards = [...cardsById.values()];
  if (!cards.every((card) => isFeatureVector(card.base) && isFeatureVector(card.upgraded))) {
    return;
  }
  const rebuilt = buildGroups(cards);
  if (!groupsExactlyMatch(baseGroups, rebuilt.baseGroups)) {
    issues.push("Base groups do not exactly match groups rebuilt from cards");
  }
  if (!groupsExactlyMatch(pairGroups, rebuilt.pairGroups)) {
    issues.push("Pair groups do not exactly match groups rebuilt from cards");
  }
}

function groupsExactlyMatch(
  actual: readonly unknown[],
  expected: readonly { key: string; cardIds: readonly string[] }[],
): boolean {
  return actual.length === expected.length && actual.every((value, index) => {
    const expectedGroup = expected[index];
    if (!isRecord(value) || !expectedGroup || value.key !== expectedGroup.key || !Array.isArray(value.cardIds)) {
      return false;
    }
    return value.cardIds.length === expectedGroup.cardIds.length &&
      value.cardIds.every((cardId, cardIndex) => cardId === expectedGroup.cardIds[cardIndex]);
  });
}

function validateSpriteMap(
  value: Record<string, unknown>,
  cardsById: ReadonlyMap<string, CardIdentity>,
  issues: string[],
): void {
  validateAtlasMeta(value.candidate, "candidate", issues);
  validateAtlasMeta(value.guess, "guess", issues);
  if (!isRecord(value.cards)) {
    issues.push("Invalid sprite card map");
    return;
  }
  const cardIds = [...cardsById.keys()].sort();
  const columns = Math.ceil(Math.sqrt(cardIds.length));
  const atlasContracts = createAtlasContracts(cardIds.length);
  for (const name of ["candidate", "guess"] as const) {
    const meta = value[name];
    const contract = atlasContracts[name];
    if (isRecord(meta)) {
      if (meta.width !== contract.width || meta.height !== contract.height) {
        issues.push(`${name} atlas geometry must be ${contract.width}x${contract.height}`);
      }
      if (contract.width > MAX_ATLAS_DIMENSION || contract.height > MAX_ATLAS_DIMENSION) {
        issues.push(`${name} atlas exceeds ${MAX_ATLAS_DIMENSION}px dimension limit`);
      }
      const expectedDisplayScale = name === "candidate" ? 0.5 : 0.45;
      if (meta.displayScale !== expectedDisplayScale) {
        issues.push(`${name} display scale must be ${expectedDisplayScale}`);
      }
    }
  }
  for (const cardId of Object.keys(value.cards)) {
    if (!cardsById.has(cardId)) issues.push(`Unknown card ID in sprite map: ${cardId}`);
  }
  for (const [index, cardId] of cardIds.entries()) {
    const coordinates = value.cards[cardId];
    if (!isRecord(coordinates)) {
      issues.push(`Missing sprite coordinates for ${cardId}`);
      continue;
    }
    validateRect(coordinates.candidate, value.candidate, "candidate", cardId, issues);
    validateRect(coordinates.guess, value.guess, "guess", cardId, issues);
    for (const name of ["candidate", "guess"] as const) {
      const contract = atlasContracts[name];
      const expected = {
        x: (index % columns) * contract.cellSize,
        y: Math.floor(index / columns) * contract.cellSize,
        width: contract.cellSize,
        height: contract.cellSize,
      };
      if (!rectExactlyMatches(coordinates[name], expected)) {
        issues.push(`${name} sprite rectangle for ${cardId} does not match expected cell`);
      }
    }
  }
}

function createAtlasContracts(cardCount: number) {
  const columns = Math.ceil(Math.sqrt(cardCount));
  const rows = columns === 0 ? 0 : Math.ceil(cardCount / columns);
  return {
    candidate: { cellSize: 64, width: columns * 64, height: rows * 64 },
    guess: { cellSize: 160, width: columns * 160, height: rows * 160 },
  } as const;
}

function rectExactlyMatches(actual: unknown, expected: SpriteRect): boolean {
  return isRecord(actual) && actual.x === expected.x && actual.y === expected.y &&
    actual.width === expected.width && actual.height === expected.height;
}

function validateAtlasMeta(value: unknown, name: "candidate" | "guess", issues: string[]): void {
  if (!isRecord(value)) {
    issues.push(`Invalid ${name} sprite metadata`);
    return;
  }
  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) issues.push(`Invalid ${name} atlas dimensions`);
  if (typeof value.url !== "string" || value.url !== `/runtime/${name}.webp`) issues.push(`Invalid ${name} atlas URL`);
  if (typeof value.displayScale !== "number" || !Number.isFinite(value.displayScale) || value.displayScale <= 0) {
    issues.push(`Invalid ${name} display scale`);
  }
}

function validateRect(
  rectValue: unknown,
  atlasValue: unknown,
  name: "candidate" | "guess",
  cardId: string,
  issues: string[],
): void {
  if (!isRecord(rectValue) || !isRecord(atlasValue)) {
    issues.push(`Missing ${name} sprite rectangle for ${cardId}`);
    return;
  }
  const rect = rectValue as unknown as SpriteRect;
  const atlas = atlasValue as unknown as SpriteAtlasMeta;
  if (
    !isNonNegativeInteger(rect.x) || !isNonNegativeInteger(rect.y) ||
    !isPositiveInteger(rect.width) || !isPositiveInteger(rect.height)
  ) {
    issues.push(`Invalid ${name} sprite rectangle for ${cardId}`);
    return;
  }
  if (
    !isPositiveInteger(atlas.width) || !isPositiveInteger(atlas.height) ||
    rect.x + rect.width > atlas.width || rect.y + rect.height > atlas.height
  ) {
    issues.push(`Sprite rectangle outside ${name} atlas for ${cardId}`);
  }
}

async function inspectSprite(
  snapshotPath: string,
  filename: "candidate.webp" | "guess.webp",
  expected: { width: number; height: number },
  imageDecodeObserver: ((request: SnapshotImageDecodeRequest) => void) | undefined,
  issues: string[],
): Promise<{ width: number; height: number; bytes: number } | null> {
  try {
    const bytes = await readFile(join(snapshotPath, filename));
    const limitInputPixels = boundedPixelLimit(expected.width, expected.height);
    const metadata = await sharp(bytes, { limitInputPixels }).metadata();
    if (!metadata.width || !metadata.height) throw new Error("image dimensions are missing");
    if (metadata.format !== "webp") {
      issues.push(`${filename} must be WebP`);
      return { width: metadata.width, height: metadata.height, bytes: bytes.length };
    }
    if (metadata.width !== expected.width || metadata.height !== expected.height) {
      issues.push(`${filename} dimensions do not match sprite map`);
      return { width: metadata.width, height: metadata.height, bytes: bytes.length };
    }
    await decodeImagePixels(bytes, { label: filename, limitInputPixels }, imageDecodeObserver);
    return { width: metadata.width, height: metadata.height, bytes: bytes.length };
  } catch (error: unknown) {
    if (isNotFound(error)) issues.push(`Missing snapshot file: ${filename}`);
    else issues.push(`Invalid sprite file ${filename}: ${safeErrorMessage(error)}`);
    return null;
  }
}

async function inspectFallbackImages(
  snapshotPath: string,
  cards: readonly unknown[],
  imageDecodeObserver: ((request: SnapshotImageDecodeRequest) => void) | undefined,
  issues: string[],
): Promise<null> {
  const filenames = new Set<string>();
  for (const card of cards) {
    if (!isRecord(card)) continue;
    if (isFallbackUrl(card.baseCardUrl)) filenames.add(card.baseCardUrl.slice("/runtime/".length));
    if (isFallbackUrl(card.upgradedCardUrl)) filenames.add(card.upgradedCardUrl.slice("/runtime/".length));
  }
  try {
    for (const filename of (await listFiles(snapshotPath)).filter((name) => name.startsWith("fallback/"))) {
      if (!filenames.has(filename)) issues.push(`Unreferenced fallback file: ${filename}`);
      filenames.add(filename);
    }
  } catch (error: unknown) {
    issues.push(`Could not enumerate fallback files: ${safeErrorMessage(error)}`);
  }
  for (const filename of filenames) {
    try {
      const bytes = await readFile(join(snapshotPath, ...filename.split("/")));
      const limitInputPixels = FALLBACK_WIDTH * FALLBACK_HEIGHT;
      const metadata = await sharp(bytes, { limitInputPixels }).metadata();
      if (metadata.format !== "webp") {
        issues.push(`Invalid fallback WebP: ${filename}`);
        continue;
      }
      if (metadata.width !== FALLBACK_WIDTH || metadata.height !== FALLBACK_HEIGHT) {
        issues.push(`Fallback ${filename} must be ${FALLBACK_WIDTH}x${FALLBACK_HEIGHT} WebP`);
        continue;
      }
      await decodeImagePixels(bytes, { label: filename, limitInputPixels }, imageDecodeObserver);
    } catch {
      issues.push(`Invalid fallback WebP: ${filename}`);
    }
  }
  return null;
}

function boundedPixelLimit(width: number, height: number): number {
  const exactPixels = width * height;
  return Math.max(1, Math.min(exactPixels, MAX_ATLAS_DIMENSION * MAX_ATLAS_DIMENSION));
}

async function decodeImagePixels(
  bytes: Buffer,
  request: SnapshotImageDecodeRequest,
  observer: ((request: SnapshotImageDecodeRequest) => void) | undefined,
): Promise<void> {
  observer?.(request);
  await sharp(bytes, { limitInputPixels: request.limitInputPixels }).raw().toBuffer();
}

async function readJson(root: string, filename: string, issues: string[]): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(root, filename), "utf8")) as unknown;
  } catch (error: unknown) {
    if (isNotFound(error)) issues.push(`Missing snapshot file: ${filename}`);
    else issues.push(`Invalid JSON file ${filename}: ${safeErrorMessage(error)}`);
    return undefined;
  }
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

function histogram(groups: readonly { cardIds: readonly string[] }[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const group of groups) {
    const key = String(group.cardIds.length);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function isFeatureVector(value: unknown): value is FeatureVector {
  if (!isRecord(value)) return false;
  return Object.keys(value).length === FEATURE_ORDER.length &&
    FEATURE_ORDER.every((feature) => Object.hasOwn(value, feature)) &&
    CARD_CLASSES.has(String(value.cardClass)) && CARD_TYPE_VALUES.has(String(value.cardType) as (typeof CARD_TYPES)[number]) &&
    CARD_RARITY_VALUES.has(String(value.rarity) as (typeof CARD_RARITIES)[number]) && isMana(value.mana) &&
    CARD_TARGET_VALUES.has(String(value.target) as (typeof CARD_TARGETS)[number]) &&
    isCanonicalPowerArray(value.powers) && isCanonicalKeywordArray(value.keywords);
}

function isCanonicalPowerArray(value: unknown): value is string[] {
  if (!Array.isArray(value) || !value.every((power) => typeof power === "string" && power.length > 0)) return false;
  if (new Set(value).size !== value.length) return false;
  const recurring = value.filter((power) => power !== UNIQUE_POWER);
  const expected = [...recurring].sort((left, right) => left.localeCompare(right, "en-US"));
  if (value.includes(UNIQUE_POWER)) expected.push(UNIQUE_POWER);
  return value.length === expected.length && value.every((power, index) => power === expected[index]);
}

function isCanonicalKeywordArray(value: unknown): value is (typeof CARD_KEYWORDS)[number][] {
  if (!Array.isArray(value) || !value.every((keyword) => CARD_KEYWORD_VALUES.has(String(keyword) as (typeof CARD_KEYWORDS)[number]))) return false;
  if (new Set(value).size !== value.length) return false;
  const expected = CARD_KEYWORDS.filter((keyword) => value.includes(keyword));
  return value.length === expected.length && value.every((keyword, index) => keyword === expected[index]);
}

function isMana(value: unknown): boolean {
  return (Number.isInteger(value) && typeof value === "number" && value >= 0) || value === "X" || value === "None";
}

function isFallbackUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/runtime/fallback/");
}

function isSafeRelativeFilename(value: string): boolean {
  return value.length > 0 && !isAbsolute(value) && !value.includes("\\") && !value.includes(":") &&
    value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function uniqueIssues(issues: readonly string[]): string[] {
  return [...new Set(issues)];
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
