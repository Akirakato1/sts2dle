import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import sharp from "sharp";
import { baseKey, pairKey } from "../../shared/feature-keys.js";
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
import type { ActivatedSnapshot } from "./build-snapshot.js";

const REQUIRED_HASHED_FILES = [
  "base-groups.json",
  "candidate.webp",
  "cards.json",
  "guess.webp",
  "pair-groups.json",
  "sprite-map.json",
] as const;
const CARD_CLASSES = new Set(["Ironclad", "Silent", "Defect", "Necrobinder", "Regent", "Neutral", "Event"]);
const CARD_TYPES = new Set(["Attack", "Skill", "Power", "Quest", "Status", "Curse"]);
const CARD_RARITIES = new Set(["Common", "Uncommon", "Rare", "None"]);
const KEYWORDS = ["eternal", "ethereal", "exhaust", "innate", "retain", "sly", "unplayable"] as const;

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

export async function validateSnapshot(snapshotPath: string): Promise<SnapshotAcceptanceReport> {
  const issues: string[] = [];
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
  const cardsById = validateCards(cards, manifestValue, issues);
  validateGroups("base", baseGroupsValue, cardsById, issues);
  validateGroups("pair", pairGroupsValue, cardsById, issues);
  validateSpriteMap(spriteMapValue, cardsById, issues);

  const [candidateSprite, guessSprite] = await Promise.all([
    inspectSprite(snapshotPath, "candidate.webp", spriteMapValue.candidate, issues),
    inspectSprite(snapshotPath, "guess.webp", spriteMapValue.guess, issues),
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

export async function loadActivatedSnapshot(snapshotPath: string): Promise<ActivatedSnapshot> {
  const report = await validateSnapshot(snapshotPath);
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
  if (manifest.schemaVersion !== 1) issues.push("Unsupported snapshot schema version");
  for (const field of ["sourceRevision", "fetchedAt", "generatedAt"] as const) {
    if (typeof manifest[field] !== "string" || manifest[field].length === 0) {
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
  issues: string[],
): Map<string, CardIdentity> {
  const cardsById = new Map<string, CardIdentity>();
  for (const [index, value] of cards.entries()) {
    if (!isRecord(value)) {
      issues.push(`Invalid card at index ${index}: expected an object`);
      continue;
    }
    const id = typeof value.id === "string" && value.id.length > 0 ? value.id : `[index ${index}]`;
    if (id.startsWith("[index ")) issues.push(`Invalid card ID at index ${index}`);
    else if (cardsById.has(id)) issues.push(`Duplicate card ID: ${id}`);
    else cardsById.set(id, value as unknown as CardIdentity);
    if (typeof value.name !== "string" || value.name.length === 0) issues.push(`Missing card name for ${id}`);
    if (value.duplicateName !== undefined && typeof value.duplicateName !== "boolean") {
      issues.push(`Invalid duplicate-name marker for ${id}`);
    }
    if (typeof value.hasUpgrade !== "boolean") issues.push(`Invalid upgrade flag for ${id}`);
    if (typeof value.artUrl !== "string" || value.artUrl.trim() === "") issues.push(`Missing raw artwork URL for ${id}`);
    validateRevealUrl(value.baseCardUrl, "base", id, manifest, issues);
    if (value.hasUpgrade === true) validateRevealUrl(value.upgradedCardUrl, "upgraded", id, manifest, issues);
    validateFeatureVector(value.base, "base", id, issues);
    validateFeatureVector(value.upgraded, "upgraded", id, issues);
    if (value.hasUpgrade === false && isRecord(value.base) && isRecord(value.upgraded)) {
      if (JSON.stringify(value.base) !== JSON.stringify(value.upgraded)) {
        issues.push(`Non-upgradable card has different effective upgraded features: ${id}`);
      }
    }
  }
  return cardsById;
}

function validateRevealUrl(
  value: unknown,
  variant: "base" | "upgraded",
  cardId: string,
  manifest: Record<string, unknown>,
  issues: string[],
): void {
  if (typeof value !== "string" || value.trim() === "") {
    issues.push(`Missing ${variant} full-card URL for ${cardId}`);
    return;
  }
  if (value.startsWith("/runtime/fallback/")) {
    const filename = value.slice("/runtime/".length);
    if (!isSafeRelativeFilename(filename) || !isRecord(manifest.files) || !Object.hasOwn(manifest.files, filename)) {
      issues.push(`Missing fallback file for ${variant} card ${cardId}: ${value}`);
    }
    return;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error();
  } catch {
    issues.push(`Invalid ${variant} full-card URL for ${cardId}`);
  }
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
  if (!CARD_CLASSES.has(String(value.cardClass))) issues.push(`Unknown card class in ${variant} features for ${cardId}`);
  if (!CARD_TYPES.has(String(value.cardType))) issues.push(`Unknown card type in ${variant} features for ${cardId}`);
  if (!CARD_RARITIES.has(String(value.rarity))) issues.push(`Unknown card rarity in ${variant} features for ${cardId}`);
  if (!isMana(value.mana)) issues.push(`Unknown mana value in ${variant} features for ${cardId}`);
  for (const keyword of KEYWORDS) {
    if (typeof value[keyword] !== "boolean") {
      issues.push(`Unknown keyword value ${keyword} in ${variant} features for ${cardId}`);
    }
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
  for (const cardId of Object.keys(value.cards)) {
    if (!cardsById.has(cardId)) issues.push(`Unknown card ID in sprite map: ${cardId}`);
  }
  for (const cardId of cardsById.keys()) {
    const coordinates = value.cards[cardId];
    if (!isRecord(coordinates)) {
      issues.push(`Missing sprite coordinates for ${cardId}`);
      continue;
    }
    validateRect(coordinates.candidate, value.candidate, "candidate", cardId, issues);
    validateRect(coordinates.guess, value.guess, "guess", cardId, issues);
  }
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
  expectedValue: unknown,
  issues: string[],
): Promise<{ width: number; height: number; bytes: number } | null> {
  try {
    const bytes = await readFile(join(snapshotPath, filename));
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height) throw new Error("image dimensions are missing");
    if (isRecord(expectedValue)) {
      if (metadata.width !== expectedValue.width || metadata.height !== expectedValue.height) {
        issues.push(`${filename} dimensions do not match sprite map`);
      }
    }
    return { width: metadata.width, height: metadata.height, bytes: bytes.length };
  } catch (error: unknown) {
    if (isNotFound(error)) issues.push(`Missing snapshot file: ${filename}`);
    else issues.push(`Invalid sprite file ${filename}: ${safeErrorMessage(error)}`);
    return null;
  }
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
  return CARD_CLASSES.has(String(value.cardClass)) && CARD_TYPES.has(String(value.cardType)) &&
    CARD_RARITIES.has(String(value.rarity)) && isMana(value.mana) &&
    KEYWORDS.every((keyword) => typeof value[keyword] === "boolean");
}

function isMana(value: unknown): boolean {
  return (Number.isInteger(value) && typeof value === "number" && value >= 0) || value === "X" || value === "\u2013";
}

function isFallbackUrl(value: string | null | undefined): boolean {
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
