import { compareGuess, type FeatureResult, type TileColor } from "../../shared/comparison.js";
import { FEATURE_ORDER, type CardIdentity, type FeatureName } from "../../shared/domain.js";
import type { SelectedAnswer } from "../../shared/selection.js";
import type { RoundState, RoundStatus, SubmittedGuess } from "./game-reducer.js";

export const DAILY_RULESET_VERSION = "v3";
export const DAILY_STATS_KEY = "stsdle:stats:v1";

export interface DailyStorageIdentity {
  sourceRevision: string;
  utcDate: string;
  ruleset: string;
}

export interface DailyStats {
  lastCompletedUtcDate: string | null;
  currentStreak: number;
  maxStreak: number;
}

interface StoredDailyRound {
  version: 3;
  answer: SelectedAnswer;
  guesses: SubmittedGuess[];
  status: RoundStatus;
}

const EMPTY_STATS: DailyStats = {
  lastCompletedUtcDate: null,
  currentStreak: 0,
  maxStreak: 0,
};

const COLORS: readonly TileColor[] = ["green", "yellow", "red"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isUtcDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.toISOString().slice(0, 10) === value;
}

function isSelectedAnswer(value: unknown): value is SelectedAnswer {
  return isRecord(value)
    && typeof value.baseGroupKey === "string"
    && typeof value.selectedCardId === "string"
    && typeof value.pairKey === "string"
    && isStringArray(value.acceptedCardIds)
    && value.acceptedCardIds.length > 0;
}

function isFeatureResult(value: unknown, expectedFeature: FeatureName): value is FeatureResult {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 3
    && keys[0] === "color"
    && keys[1] === "displayValue"
    && keys[2] === "feature"
    && value.feature === expectedFeature
    && COLORS.includes(value.color as TileColor)
    && typeof value.displayValue === "string";
}

function isSubmittedGuess(value: unknown): value is SubmittedGuess {
  return isRecord(value)
    && typeof value.cardId === "string"
    && Array.isArray(value.results)
    && value.results.length === FEATURE_ORDER.length
    && value.results.every((result, index) => isFeatureResult(result, FEATURE_ORDER[index]!));
}

function isStoredDailyRound(value: unknown): value is StoredDailyRound {
  return isRecord(value)
    && value.version === 3
    && isSelectedAnswer(value.answer)
    && Array.isArray(value.guesses)
    && value.guesses.every(isSubmittedGuess)
    && (value.status === "playing" || value.status === "won");
}

function sameAnswer(left: SelectedAnswer, right: SelectedAnswer): boolean {
  return left.baseGroupKey === right.baseGroupKey
    && left.selectedCardId === right.selectedCardId
    && left.pairKey === right.pairKey
    && left.acceptedCardIds.length === right.acceptedCardIds.length
    && left.acceptedCardIds.every((id, index) => id === right.acceptedCardIds[index]);
}

function sameResults(stored: readonly FeatureResult[], canonical: readonly FeatureResult[]): boolean {
  return stored.length === canonical.length && stored.every((result, index) => {
    const expected = canonical[index];
    return expected !== undefined
      && result.feature === expected.feature
      && result.color === expected.color
      && result.displayValue === expected.displayValue;
  });
}

function canonicalStoredGuesses(
  stored: StoredDailyRound,
  cardsById: ReadonlyMap<string, CardIdentity>,
): SubmittedGuess[] | null {
  const answerCard = cardsById.get(stored.answer.selectedCardId);
  if (!answerCard || !stored.answer.acceptedCardIds.every((id) => cardsById.has(id))) return null;
  const acceptedIds = new Set(stored.answer.acceptedCardIds);
  const seenIds = new Set<string>();
  const guesses: SubmittedGuess[] = [];
  let winningIndex = -1;

  for (const [index, guess] of stored.guesses.entries()) {
    if (winningIndex !== -1) return null;
    if (seenIds.has(guess.cardId)) return null;
    seenIds.add(guess.cardId);
    const card = cardsById.get(guess.cardId);
    if (!card) return null;
    const results = compareGuess(card, answerCard);
    if (!sameResults(guess.results, results)) return null;
    if (acceptedIds.has(guess.cardId)) winningIndex = index;
    guesses.push({ cardId: card.id, results });
  }

  const derivedStatus: RoundStatus = winningIndex === -1 ? "playing" : "won";
  if (derivedStatus !== stored.status || (winningIndex !== -1 && winningIndex !== guesses.length - 1)) return null;
  return guesses;
}

function removeItem(storage: Storage, key: string): void {
  try { storage.removeItem(key); } catch { /* Storage may be unavailable. */ }
}

export function dailyStorageKey({ sourceRevision, utcDate, ruleset }: DailyStorageIdentity): string {
  return `stsdle:daily:${ruleset}:${sourceRevision}:${utcDate}`;
}

export function saveDailyRound(
  storage: Storage,
  identity: DailyStorageIdentity,
  round: RoundState,
): void {
  if (round.mode !== "daily") return;
  const stored: StoredDailyRound = {
    version: 3,
    answer: round.answer,
    guesses: round.guesses,
    status: round.status,
  };
  try { storage.setItem(dailyStorageKey(identity), JSON.stringify(stored)); } catch { /* Persistence is best-effort. */ }
}

export function loadDailyRound(
  storage: Storage,
  identity: DailyStorageIdentity,
  cardsById: ReadonlyMap<string, CardIdentity>,
  expectedAnswer?: SelectedAnswer,
): RoundState | null {
  const key = dailyStorageKey(identity);
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return null; }
  if (raw === null) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (!isStoredDailyRound(value)
      || (expectedAnswer !== undefined && !sameAnswer(value.answer, expectedAnswer))) {
      removeItem(storage, key);
      return null;
    }
    const guesses = canonicalStoredGuesses(value, cardsById);
    if (guesses === null) {
      removeItem(storage, key);
      return null;
    }
    return {
      mode: "daily",
      answer: value.answer,
      guesses,
      status: value.status,
      error: null,
    };
  } catch {
    removeItem(storage, key);
    return null;
  }
}

function isDailyStats(value: unknown): value is DailyStats {
  return isRecord(value)
    && (value.lastCompletedUtcDate === null || isUtcDate(value.lastCompletedUtcDate))
    && Number.isSafeInteger(value.currentStreak)
    && (value.currentStreak as number) >= 0
    && Number.isSafeInteger(value.maxStreak)
    && (value.maxStreak as number) >= (value.currentStreak as number)
    && ((value.lastCompletedUtcDate === null && value.currentStreak === 0 && value.maxStreak === 0)
      || (value.lastCompletedUtcDate !== null && (value.currentStreak as number) > 0));
}

export function loadDailyStats(storage: Storage): DailyStats {
  let raw: string | null;
  try { raw = storage.getItem(DAILY_STATS_KEY); } catch { return { ...EMPTY_STATS }; }
  if (raw === null) return { ...EMPTY_STATS };
  try {
    const value: unknown = JSON.parse(raw);
    if (!isDailyStats(value)) throw new Error("Invalid Daily stats");
    return value;
  } catch {
    removeItem(storage, DAILY_STATS_KEY);
    return { ...EMPTY_STATS };
  }
}

function utcDayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year!, month! - 1, day!) / 86_400_000);
}

export function recordDailyCompletion(storage: Storage, utcDate: string): DailyStats {
  if (!isUtcDate(utcDate)) return loadDailyStats(storage);
  const previous = loadDailyStats(storage);
  if (previous.lastCompletedUtcDate !== null && utcDate <= previous.lastCompletedUtcDate) return previous;

  const currentStreak = previous.lastCompletedUtcDate !== null
    && utcDayNumber(utcDate) - utcDayNumber(previous.lastCompletedUtcDate) === 1
    ? Math.min(Number.MAX_SAFE_INTEGER, previous.currentStreak + 1)
    : 1;
  const next: DailyStats = {
    lastCompletedUtcDate: utcDate,
    currentStreak,
    maxStreak: Math.max(previous.maxStreak, currentStreak),
  };
  try { storage.setItem(DAILY_STATS_KEY, JSON.stringify(next)); } catch { /* Persistence is best-effort. */ }
  return next;
}

export function msUntilNextUtcDay(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
}
