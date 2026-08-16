import { compareGuess, type FeatureResult, type TileColor } from "../../shared/comparison.js";
import { FEATURE_ORDER, type CardIdentity } from "../../shared/domain.js";
import type { SelectedAnswer } from "../../shared/selection.js";
import {
  createDefaultAssistance,
  type AssistanceState,
  type CandidateCategory,
  type ConstraintOrbTarget,
  type RevealOrbTarget,
} from "./assistance.js";

export type PlayMode = "daily" | "hardcore-daily" | "practice";
export type RoundStatus = "playing" | "won" | "forfeited";

export interface SubmittedGuess {
  cardId: string;
  results: FeatureResult[];
}

export interface RoundState {
  mode: PlayMode;
  hardcore: boolean;
  roundId: string;
  hintSeed: string;
  answer: SelectedAnswer;
  guesses: SubmittedGuess[];
  status: RoundStatus;
  terminalGuessCount: number | null;
  error: string | null;
  assistance: AssistanceState | null;
}

export type GameAction =
  | { type: "submit"; cardId: string; cardsById: ReadonlyMap<string, CardIdentity> }
  | { type: "consume-reveal"; target: RevealOrbTarget }
  | { type: "consume-filter"; target: ConstraintOrbTarget }
  | { type: "consume-negation"; target: ConstraintOrbTarget }
  | { type: "set-candidate-visibility"; category: CandidateCategory; visible: boolean }
  | { type: "set-practice-hardcore"; hardcore: boolean }
  | { type: "forfeit-practice" }
  | { type: "replace-round"; round: RoundState };

export function createRoundState(options: {
  mode: PlayMode;
  hardcore: boolean;
  roundId: string;
  hintSeed: string;
  answer: SelectedAnswer;
  guesses?: SubmittedGuess[];
  status?: RoundStatus;
  terminalGuessCount?: number | null;
  assistance?: AssistanceState | null;
}): RoundState {
  if ((options.mode === "daily" && options.hardcore)
    || (options.mode === "hardcore-daily" && !options.hardcore)) {
    throw new RangeError(`Hardcore setting is inconsistent with ${options.mode} mode.`);
  }
  const guesses = options.guesses ?? [];
  const status = options.status ?? "playing";
  return {
    mode: options.mode,
    hardcore: options.hardcore,
    roundId: options.roundId,
    hintSeed: options.hintSeed,
    answer: options.answer,
    guesses,
    status,
    terminalGuessCount: options.terminalGuessCount ?? (status === "playing" ? null : guesses.length),
    error: null,
    assistance: options.hardcore ? null : (options.assistance ?? createDefaultAssistance()),
  };
}

export function canSetPracticeHardcore(round: RoundState): boolean {
  if (round.mode !== "practice" || round.status !== "playing" || round.guesses.length !== 0) return false;
  if (round.hardcore) return round.assistance === null;
  return round.assistance !== null
    && round.assistance.reveal === null
    && round.assistance.filter === null
    && round.assistance.negation === null;
}

function validFeature(feature: unknown): feature is RevealOrbTarget["feature"] {
  return typeof feature === "string" && FEATURE_ORDER.includes(feature as RevealOrbTarget["feature"]);
}

function validConstraintTarget(
  state: RoundState,
  target: ConstraintOrbTarget,
  requiredColor: TileColor,
): boolean {
  if (!Number.isInteger(target.guessIndex) || target.guessIndex < 0 || !validFeature(target.feature)) return false;
  const guess = state.guesses[target.guessIndex];
  if (!guess || guess.cardId !== target.cardId) return false;
  const result = guess.results.find((candidate) => candidate.feature === target.feature);
  return result?.color === requiredColor;
}

export function gameReducer(state: RoundState, action: GameAction): RoundState {
  switch (action.type) {
    case "replace-round":
      return action.round;
    case "submit": {
      if (state.status !== "playing" || state.guesses.some((guess) => guess.cardId === action.cardId)) return state;
      const card = action.cardsById.get(action.cardId);
      const answerCard = action.cardsById.get(state.answer.selectedCardId);
      if (!card || !answerCard) return state;
      const guesses = [...state.guesses, { cardId: card.id, results: compareGuess(card, answerCard) }];
      const won = state.answer.acceptedCardIds.includes(card.id);
      return {
        ...state,
        guesses,
        status: won ? "won" : "playing",
        terminalGuessCount: won ? guesses.length : null,
        error: null,
      };
    }
    case "consume-reveal":
      if (state.status !== "playing" || state.assistance === null || state.assistance.reveal !== null
        || !validFeature(action.target.feature)) return state;
      return { ...state, assistance: { ...state.assistance, reveal: action.target } };
    case "consume-filter":
      if (state.status !== "playing" || state.assistance === null || state.assistance.filter !== null
        || !validConstraintTarget(state, action.target, "green")) return state;
      return { ...state, assistance: { ...state.assistance, filter: action.target } };
    case "consume-negation":
      if (state.status !== "playing" || state.assistance === null || state.assistance.negation !== null
        || !validConstraintTarget(state, action.target, "red")) return state;
      return { ...state, assistance: { ...state.assistance, negation: action.target } };
    case "set-candidate-visibility":
      if (state.status !== "playing" || state.assistance === null
        || state.assistance.visibility[action.category] === action.visible) return state;
      return {
        ...state,
        assistance: {
          ...state.assistance,
          visibility: { ...state.assistance.visibility, [action.category]: action.visible },
        },
      };
    case "set-practice-hardcore":
      if (!canSetPracticeHardcore(state) || state.hardcore === action.hardcore) return state;
      return { ...state, hardcore: action.hardcore, assistance: action.hardcore ? null : createDefaultAssistance() };
    case "forfeit-practice":
      if (state.mode !== "practice" || state.status !== "playing") return state;
      return { ...state, status: "forfeited", terminalGuessCount: state.guesses.length, error: null };
  }
}
