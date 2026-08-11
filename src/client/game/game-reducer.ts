import { compareGuess, type FeatureResult } from "../../shared/comparison.js";
import type { CardIdentity } from "../../shared/domain.js";
import { pairKey } from "../../shared/feature-keys.js";
import type { SelectedAnswer } from "../../shared/selection.js";

export type PlayMode = "daily" | "practice";
export type RoundStatus = "playing" | "won";

export interface SubmittedGuess { cardId: string; results: FeatureResult[] }
export interface RoundState {
  mode: PlayMode;
  answer: SelectedAnswer;
  guesses: SubmittedGuess[];
  status: RoundStatus;
  error: string | null;
}

export type GameAction =
  | { type: "submit"; card: CardIdentity; answerCard: CardIdentity }
  | { type: "new-practice-round"; answer: SelectedAnswer }
  | { type: "set-mode"; mode: PlayMode; answer: SelectedAnswer };

export function gameReducer(state: RoundState, action: GameAction): RoundState {
  if (action.type === "new-practice-round") return { mode: "practice", answer: action.answer, guesses: [], status: "playing", error: null };
  if (action.type === "set-mode") return { mode: action.mode, answer: action.answer, guesses: [], status: "playing", error: null };
  if (state.status === "won") return state;
  if (state.guesses.some((guess) => guess.cardId === action.card.id)) return { ...state, error: `${action.card.name} was already guessed.` };
  const guess = { cardId: action.card.id, results: compareGuess(action.card, action.answerCard) };
  return {
    ...state,
    guesses: [...state.guesses, guess],
    status: pairKey(action.card) === state.answer.pairKey ? "won" : "playing",
    error: null,
  };
}
