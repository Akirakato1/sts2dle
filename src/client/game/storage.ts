import { z } from "zod";

import { compareGuess, type FeatureResult } from "../../shared/comparison.js";
import { FEATURE_ORDER, type CardIdentity, type PairGroup } from "../../shared/domain.js";
import { baseKey, pairKey } from "../../shared/feature-keys.js";
import type { SelectedAnswer } from "../../shared/selection.js";
import type { AssistanceState, ConstraintOrbTarget } from "./assistance.js";
import type { PlayMode, RoundState, SubmittedGuess } from "./game-reducer.js";

export const CURRENT_ROUND_VERSION = 5;
export const CURRENT_ROUND_KEYS: Readonly<Record<PlayMode, string>> = Object.freeze({
  daily: "stsdle:round:daily:v1",
  "hardcore-daily": "stsdle:round:hardcore-daily:v1",
  practice: "stsdle:round:practice:v1",
});
export const DAILY_RULESET_VERSION = "v5";
export const HARDCORE_DAILY_RULESET_VERSION = "hardcore-v2";
export const PRACTICE_RULESET_VERSION = "practice-v4";
export const DAILY_STATS_KEY = "stsdle:stats:v1";
export const HARDCORE_DAILY_STATS_KEY = "stsdle:stats:hardcore:v1";

export interface RoundStorageIdentity {
  mode: PlayMode;
  sourceRevision: string;
  ruleset: string;
  utcDate: string | null;
}

export interface DailyStats {
  lastCompletedUtcDate: string | null;
  currentStreak: number;
  maxStreak: number;
}

const featureSchema = z.enum(FEATURE_ORDER);
const resultSchema = z.object({
  feature: featureSchema,
  color: z.enum(["green", "yellow", "red"]),
  displayValue: z.string(),
}).strict();
const guessSchema = z.object({ cardId: z.string(), results: z.array(resultSchema) }).strict();
const answerSchema = z.object({
  baseGroupKey: z.string(),
  selectedCardId: z.string(),
  pairKey: z.string(),
  acceptedCardIds: z.array(z.string()).min(1),
}).strict();
const revealTargetSchema = z.object({ feature: featureSchema }).strict();
const constraintTargetSchema = z.object({
  guessIndex: z.number().int().nonnegative(),
  cardId: z.string(),
  feature: featureSchema,
}).strict();
const visibilitySchema = z.object({ neutral: z.boolean(), green: z.boolean(), red: z.boolean() }).strict();
const assistanceSchema = z.object({
  reveal: revealTargetSchema.nullable(),
  filter: constraintTargetSchema.nullable(),
  negation: constraintTargetSchema.nullable(),
  visibility: visibilitySchema,
}).strict();
const roundSchema = z.object({
  mode: z.enum(["daily", "hardcore-daily", "practice"]),
  hardcore: z.boolean(),
  roundId: z.string(),
  hintSeed: z.string(),
  answer: answerSchema,
  guesses: z.array(guessSchema),
  status: z.enum(["playing", "won", "forfeited"]),
  terminalGuessCount: z.number().int().nonnegative().nullable(),
  assistance: assistanceSchema.nullable(),
  practiceFilter: z.null().optional(),
}).strict();
const envelopeSchema = z.object({
  version: z.literal(CURRENT_ROUND_VERSION),
  mode: z.enum(["daily", "hardcore-daily", "practice"]),
  sourceRevision: z.string(),
  ruleset: z.string(),
  utcDate: z.string().nullable(),
  practiceHardcoreChoice: z.boolean().nullable().optional(),
  round: roundSchema,
}).strict();

export interface LoadedCurrentRound {
  round: RoundState;
}

const EMPTY_STATS: DailyStats = { lastCompletedUtcDate: null, currentStreak: 0, maxStreak: 0 };

function removeItem(storage: Storage, key: string): void {
  try { storage.removeItem(key); } catch { /* Storage may be unavailable. */ }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameAnswer(left: SelectedAnswer, right: SelectedAnswer): boolean {
  return left.baseGroupKey === right.baseGroupKey
    && left.selectedCardId === right.selectedCardId
    && left.pairKey === right.pairKey
    && sameStrings(left.acceptedCardIds, right.acceptedCardIds);
}

function sameResults(left: readonly FeatureResult[], right: readonly FeatureResult[]): boolean {
  return left.length === FEATURE_ORDER.length
    && right.length === FEATURE_ORDER.length
    && left.every((result, index) => {
      const expected = right[index];
      return expected !== undefined
        && result.feature === FEATURE_ORDER[index]
        && result.feature === expected.feature
        && result.color === expected.color
        && result.displayValue === expected.displayValue;
    });
}

function validUtcDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).toISOString().slice(0, 10) === value;
}

function validIdentity(identity: RoundStorageIdentity): boolean {
  if (identity.sourceRevision.length === 0 || identity.ruleset.length === 0) return false;
  if (identity.mode === "practice") return identity.utcDate === null && identity.ruleset === PRACTICE_RULESET_VERSION;
  if (identity.utcDate === null || !validUtcDate(identity.utcDate)) return false;
  return identity.ruleset === (identity.mode === "daily" ? DAILY_RULESET_VERSION : HARDCORE_DAILY_RULESET_VERSION);
}

function validRoundIdentity(round: RoundState, identity: RoundStorageIdentity): boolean {
  if (round.mode !== identity.mode) return false;
  if (round.mode === "daily" && round.hardcore !== false) return false;
  if (round.mode === "hardcore-daily" && round.hardcore !== true) return false;
  if (round.mode !== "practice") {
    const expectedId = `${round.mode}:${identity.utcDate}:${identity.sourceRevision}`;
    return round.roundId === expectedId && round.hintSeed === expectedId;
  }
  const match = /^practice:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(round.roundId);
  return match !== null && round.hintSeed === match[1];
}

function canonicalAnswer(
  answer: SelectedAnswer,
  cardsById: ReadonlyMap<string, CardIdentity>,
  pairGroupsByKey: ReadonlyMap<string, PairGroup>,
): boolean {
  const selected = cardsById.get(answer.selectedCardId);
  const group = pairGroupsByKey.get(answer.pairKey);
  return selected !== undefined
    && answer.baseGroupKey === baseKey(selected.base)
    && pairKey(selected) === answer.pairKey
    && group !== undefined
    && group.key === answer.pairKey
    && sameStrings(group.cardIds, answer.acceptedCardIds)
    && answer.acceptedCardIds.includes(answer.selectedCardId)
    && answer.acceptedCardIds.every((id) => cardsById.has(id));
}

function canonicalGuesses(
  stored: readonly SubmittedGuess[],
  answer: SelectedAnswer,
  cardsById: ReadonlyMap<string, CardIdentity>,
): SubmittedGuess[] | null {
  const answerCard = cardsById.get(answer.selectedCardId);
  if (!answerCard) return null;
  const seen = new Set<string>();
  const guesses: SubmittedGuess[] = [];
  let won = false;
  for (const guess of stored) {
    if (won || seen.has(guess.cardId)) return null;
    const card = cardsById.get(guess.cardId);
    if (!card) return null;
    const results = compareGuess(card, answerCard);
    if (!sameResults(guess.results, results)) return null;
    seen.add(guess.cardId);
    guesses.push({ cardId: card.id, results });
    won = answer.acceptedCardIds.includes(card.id);
  }
  return guesses;
}

function targetHasColor(target: ConstraintOrbTarget, guesses: readonly SubmittedGuess[], color: "green" | "red"): boolean {
  const guess = guesses[target.guessIndex];
  if (!guess || guess.cardId !== target.cardId) return false;
  return guess.results.find((result) => result.feature === target.feature)?.color === color;
}

function validAssistance(
  assistance: AssistanceState | null,
  hardcore: boolean,
  guesses: readonly SubmittedGuess[],
  status: RoundState["status"],
): boolean {
  if (hardcore) return assistance === null;
  if (assistance === null) return false;
  const terminalWinningIndex = status === "won" ? guesses.length - 1 : -1;
  return (assistance.filter === null
    || (assistance.filter.guessIndex !== terminalWinningIndex && targetHasColor(assistance.filter, guesses, "green")))
    && (assistance.negation === null
      || (assistance.negation.guessIndex !== terminalWinningIndex && targetHasColor(assistance.negation, guesses, "red")));
}

function validStatus(round: RoundState): boolean {
  const winningIndex = round.guesses.findIndex((guess) => round.answer.acceptedCardIds.includes(guess.cardId));
  if (round.status === "playing") return winningIndex === -1 && round.terminalGuessCount === null;
  if (round.terminalGuessCount !== round.guesses.length) return false;
  if (round.status === "won") return winningIndex === round.guesses.length - 1;
  return round.mode === "practice" && winningIndex === -1;
}

export function saveCurrentRound(
  storage: Storage,
  identity: RoundStorageIdentity,
  round: RoundState,
): void {
  if (identity.mode !== round.mode) return;
  const value = {
    version: CURRENT_ROUND_VERSION,
    mode: identity.mode,
    sourceRevision: identity.sourceRevision,
    ruleset: identity.ruleset,
    utcDate: identity.utcDate,
    round: {
      mode: round.mode,
      hardcore: round.hardcore,
      roundId: round.roundId,
      hintSeed: round.hintSeed,
      answer: round.answer,
      guesses: round.guesses,
      status: round.status,
      terminalGuessCount: round.terminalGuessCount,
      assistance: round.assistance,
    },
  };
  try { storage.setItem(CURRENT_ROUND_KEYS[identity.mode], JSON.stringify(value)); } catch { /* Best effort. */ }
}

export function loadCurrentRound(
  storage: Storage,
  identity: RoundStorageIdentity,
  cardsById: ReadonlyMap<string, CardIdentity>,
  pairGroupsByKey: ReadonlyMap<string, PairGroup>,
  expectedAnswer?: SelectedAnswer,
): LoadedCurrentRound | null {
  const key = CURRENT_ROUND_KEYS[identity.mode];
  let raw: string | null;
  try { raw = storage.getItem(key); } catch { return null; }
  if (raw === null) return null;
  try {
    const envelope = envelopeSchema.parse(JSON.parse(raw));
    const parsedRound = envelope.round;
    if (!validIdentity(identity)
      || envelope.mode !== identity.mode
      || envelope.sourceRevision !== identity.sourceRevision
      || envelope.ruleset !== identity.ruleset
      || envelope.utcDate !== identity.utcDate
      || (identity.mode === "practice"
        ? envelope.practiceHardcoreChoice !== undefined
        : envelope.practiceHardcoreChoice !== undefined && envelope.practiceHardcoreChoice !== null)
      || !validRoundIdentity(parsedRound as RoundState, identity)
      || (expectedAnswer !== undefined && !sameAnswer(parsedRound.answer, expectedAnswer))
      || !canonicalAnswer(parsedRound.answer, cardsById, pairGroupsByKey)) throw new Error("Invalid stored round identity");
    const guesses = canonicalGuesses(parsedRound.guesses, parsedRound.answer, cardsById);
    if (guesses === null) throw new Error("Invalid stored guesses");
    const { practiceFilter: _legacyFilter, ...storedRound } = parsedRound;
    const round: RoundState = { ...storedRound, guesses, error: null };
    if (!validStatus(round) || !validAssistance(round.assistance, round.hardcore, guesses, round.status)) throw new Error("Invalid stored round state");
    return { round };
  } catch {
    removeItem(storage, key);
    return null;
  }
}

export function removeLegacyCurrentRoundKeys(storage: Storage): void {
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => key !== null && /^stsdle:daily:v[23]:/.test(key));
    for (const key of keys) removeItem(storage, key);
  } catch { /* Storage may be unavailable. */ }
}

function isDailyStats(value: unknown): value is DailyStats {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const stats = value as Record<string, unknown>;
  return Object.keys(stats).length === 3
    && (stats.lastCompletedUtcDate === null || (typeof stats.lastCompletedUtcDate === "string" && validUtcDate(stats.lastCompletedUtcDate)))
    && Number.isSafeInteger(stats.currentStreak) && (stats.currentStreak as number) >= 0
    && Number.isSafeInteger(stats.maxStreak) && (stats.maxStreak as number) >= (stats.currentStreak as number)
    && ((stats.lastCompletedUtcDate === null && stats.currentStreak === 0 && stats.maxStreak === 0)
      || (stats.lastCompletedUtcDate !== null && (stats.currentStreak as number) > 0));
}

export function loadDailyStats(storage: Storage, statsKey = DAILY_STATS_KEY): DailyStats {
  let raw: string | null;
  try { raw = storage.getItem(statsKey); } catch { return { ...EMPTY_STATS }; }
  if (raw === null) return { ...EMPTY_STATS };
  try {
    const value: unknown = JSON.parse(raw);
    if (!isDailyStats(value)) throw new Error("Invalid Daily stats");
    return value;
  } catch {
    removeItem(storage, statsKey);
    return { ...EMPTY_STATS };
  }
}

function utcDayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year!, month! - 1, day!) / 86_400_000);
}

export function recordDailyCompletion(storage: Storage, utcDate: string, statsKey = DAILY_STATS_KEY): DailyStats {
  if (!validUtcDate(utcDate)) return loadDailyStats(storage, statsKey);
  const previous = loadDailyStats(storage, statsKey);
  if (previous.lastCompletedUtcDate !== null && utcDate <= previous.lastCompletedUtcDate) return previous;
  const currentStreak = previous.lastCompletedUtcDate !== null
    && utcDayNumber(utcDate) - utcDayNumber(previous.lastCompletedUtcDate) === 1
    ? Math.min(Number.MAX_SAFE_INTEGER, previous.currentStreak + 1)
    : 1;
  const next = { lastCompletedUtcDate: utcDate, currentStreak, maxStreak: Math.max(previous.maxStreak, currentStreak) };
  try { storage.setItem(statsKey, JSON.stringify(next)); } catch { /* Best effort. */ }
  return next;
}

export function msUntilNextUtcDay(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime();
}
