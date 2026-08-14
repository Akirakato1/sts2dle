import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { LoadedSnapshot } from "../api/load-snapshot.js";
import { createDailyRandom, createPracticeRandom } from "../../shared/random.js";
import { selectAnswer, selectDistinctAnswer, type SelectedAnswer } from "../../shared/selection.js";
import type { CandidateCategory, ConstraintOrbTarget, RevealOrbTarget } from "./assistance.js";
import { createRoundState, gameReducer, type GameAction, type PlayMode, type RoundState } from "./game-reducer.js";
import type { PracticeFilterGroupName, PracticeFilterValue } from "./practice-filter.js";
import { preloadAnswerImages } from "./preload-images.js";
import {
  DAILY_RULESET_VERSION,
  DAILY_STATS_KEY,
  HARDCORE_DAILY_RULESET_VERSION,
  HARDCORE_DAILY_STATS_KEY,
  PRACTICE_RULESET_VERSION,
  loadCurrentRound,
  msUntilNextUtcDay,
  recordDailyCompletion,
  removeLegacyCurrentRoundKeys,
  saveCurrentRound,
  type RoundStorageIdentity,
} from "./storage.js";

export interface UseGameResult {
  activeMode: PlayMode;
  round: RoundState;
  roundToken: number;
  dailyUtcDate: string;
  error: string | null;
  submit(cardId: string): void;
  setMode(mode: PlayMode): void;
  consumeReveal(target: RevealOrbTarget): void;
  consumeFilter(target: ConstraintOrbTarget): void;
  consumeNegation(target: ConstraintOrbTarget): void;
  setCandidateVisibility(category: CandidateCategory, visible: boolean): void;
  setPracticeFilterEnabled(enabled: boolean): void;
  setPracticeFilterGroupDisabled(group: PracticeFilterGroupName, disabled: boolean): void;
  setPracticeFilterValue(group: PracticeFilterGroupName, value: PracticeFilterValue, selected: boolean): void;
  forfeitPractice(): void;
  nextPracticeRound(): void;
  retryActiveMode(): void;
}

interface LegacyNextRound {
  nextRound(): void;
}

export type UseGameState =
  | (UseGameResult & LegacyNextRound & { status: "ready" })
  | (Omit<UseGameResult, "round"> & LegacyNextRound & { status: "loading"; round: null });

interface HookState {
  activeMode: PlayMode;
  rounds: ReadonlyMap<PlayMode, RoundState>;
  errors: Readonly<Record<PlayMode, string | null>>;
  roundToken: number;
}

type HookAction =
  | { type: "switch-mode"; mode: PlayMode }
  | { type: "round-ready"; mode: PlayMode; round: RoundState }
  | { type: "round-failed"; mode: PlayMode; error: string }
  | { type: "invalidate-dailies" }
  | { type: "transition"; mode: PlayMode; previous: RoundState; round: RoundState };

const INITIAL_ERRORS: Readonly<Record<PlayMode, string | null>> = {
  daily: null,
  "hardcore-daily": null,
  practice: null,
};

function hookReducer(state: HookState, action: HookAction): HookState {
  switch (action.type) {
    case "switch-mode":
      if (action.mode === state.activeMode) return state;
      return { ...state, activeMode: action.mode, roundToken: state.roundToken + 1 };
    case "round-ready": {
      const previous = state.rounds.get(action.mode);
      if (previous === action.round && state.errors[action.mode] === null) return state;
      const rounds = new Map(state.rounds).set(action.mode, action.round);
      const errors = { ...state.errors, [action.mode]: null };
      const replacesActiveRound = action.mode === state.activeMode
        && previous !== undefined
        && previous.roundId !== action.round.roundId;
      const completesInitialLoad = action.mode === state.activeMode
        && previous === undefined
        && state.roundToken === 0;
      return {
        ...state,
        rounds,
        errors,
        roundToken: state.roundToken + (replacesActiveRound || completesInitialLoad ? 1 : 0),
      };
    }
    case "round-failed":
      if (state.errors[action.mode] === action.error) return state;
      return { ...state, errors: { ...state.errors, [action.mode]: action.error } };
    case "invalidate-dailies": {
      const rounds = new Map(state.rounds);
      const hadActiveDaily = state.activeMode !== "practice" && rounds.has(state.activeMode);
      rounds.delete("daily");
      rounds.delete("hardcore-daily");
      return {
        ...state,
        rounds,
        errors: { ...state.errors, daily: null, "hardcore-daily": null },
        roundToken: state.roundToken + (hadActiveDaily ? 1 : 0),
      };
    }
    case "transition":
      if (state.rounds.get(action.mode) !== action.previous || action.previous === action.round) return state;
      return { ...state, rounds: new Map(state.rounds).set(action.mode, action.round) };
  }
}

function utcDate(now = new Date()): string { return now.toISOString().slice(0, 10); }

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

function identityFor(mode: PlayMode, sourceRevision: string, date: string): RoundStorageIdentity {
  if (mode === "practice") {
    return { mode, sourceRevision, ruleset: PRACTICE_RULESET_VERSION, utcDate: null };
  }
  return {
    mode,
    sourceRevision,
    ruleset: mode === "daily" ? DAILY_RULESET_VERSION : HARDCORE_DAILY_RULESET_VERSION,
    utcDate: date,
  };
}

const MODE_PREPARATION_ERROR = "Unable to prepare this game mode.";

export function useGame(snapshot: LoadedSnapshot): UseGameState {
  const [state, reactDispatch] = useReducer(hookReducer, {
    activeMode: "daily",
    rounds: new Map<PlayMode, RoundState>(),
    errors: INITIAL_ERRORS,
    roundToken: 0,
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const dispatch = useCallback((action: HookAction) => {
    stateRef.current = hookReducer(stateRef.current, action);
    reactDispatch(action);
  }, []);
  const [activeUtcDate, setActiveUtcDate] = useState(() => utcDate());
  const activeUtcDateRef = useRef(activeUtcDate);
  const generations = useRef<Record<PlayMode, number>>({ daily: 0, "hardcore-daily": 0, practice: 0 });
  const pending = useRef<Record<PlayMode, boolean>>({ daily: false, "hardcore-daily": false, practice: false });
  const persistedRounds = useRef(new Map<PlayMode, RoundState>());
  const recordedCompletions = useRef(new Set<string>());
  const dailyAnswerPromises = useRef(new Map<string, Promise<SelectedAnswer>>());
  const groups = useMemo(() => ({
    baseGroups: snapshot.baseGroups,
    pairGroups: snapshot.pairGroups,
    baseGroupsByKey: new Map(snapshot.baseGroups.map((group) => [group.key, group])),
    pairGroupsByKey: snapshot.pairGroupsByKey,
  }), [snapshot]);
  const storage = browserStorage();
  const revision = snapshot.manifest.sourceRevision;

  const getDailyAnswer = useCallback((date: string): Promise<SelectedAnswer> => {
    const key = `${date}:${revision}`;
    const existing = dailyAnswerPromises.current.get(key);
    if (existing) return existing;
    const pendingAnswer = createDailyRandom(date, revision, "daily")
      .then((source) => selectAnswer(groups, snapshot.cardsById, source));
    dailyAnswerPromises.current.set(key, pendingAnswer);
    void pendingAnswer.catch(() => {
      if (dailyAnswerPromises.current.get(key) === pendingAnswer) dailyAnswerPromises.current.delete(key);
    });
    return pendingAnswer;
  }, [groups, revision, snapshot.cardsById]);

  const startDaily = useCallback(async (mode: "daily" | "hardcore-daily", date: string) => {
    const generation = ++generations.current[mode];
    pending.current[mode] = true;
    try {
      const dailyAnswer = await getDailyAnswer(date);
      const answer = mode === "daily"
        ? dailyAnswer
        : selectDistinctAnswer(
          groups,
          snapshot.cardsById,
          await createDailyRandom(date, revision, "hardcore-daily"),
          dailyAnswer.selectedCardId,
        );
      if (generation !== generations.current[mode]) return;
      const identity = identityFor(mode, revision, date);
      const restored = storage
        ? loadCurrentRound(storage, identity, snapshot.cardsById, snapshot.pairGroupsByKey, answer)
        : null;
      const roundId = `${mode}:${date}:${revision}`;
      dispatch({
        type: "round-ready",
        mode,
        round: restored?.round ?? createRoundState({
          mode,
          hardcore: mode === "hardcore-daily",
          roundId,
          hintSeed: roundId,
          answer,
        }),
      });
    } catch {
      if (generation === generations.current[mode]) dispatch({ type: "round-failed", mode, error: MODE_PREPARATION_ERROR });
    } finally {
      if (generation === generations.current[mode]) pending.current[mode] = false;
    }
  }, [dispatch, getDailyAnswer, groups, revision, snapshot.cardsById, snapshot.pairGroupsByKey, storage]);

  const startPractice = useCallback(async (
    forceNew: boolean,
    expectedTerminal?: Readonly<{ roundId: string; status: "won" | "forfeited" }>,
  ) => {
    const mode = "practice" as const;
    const matchesExpectedTerminal = () => {
      if (!expectedTerminal) return true;
      const current = stateRef.current.rounds.get(mode);
      return current?.roundId === expectedTerminal.roundId && current.status === expectedTerminal.status;
    };
    if (!matchesExpectedTerminal()) return;
    const generation = ++generations.current.practice;
    pending.current.practice = true;
    try {
      if (!forceNew && storage) {
        const restored = loadCurrentRound(
          storage,
          identityFor(mode, revision, ""),
          snapshot.cardsById,
          snapshot.pairGroupsByKey,
        );
        if (restored) {
          if (generation === generations.current.practice) dispatch({
            type: "round-ready",
            mode,
            round: restored.round,
          });
          return;
        }
      }
      const source = await Promise.resolve(createPracticeRandom());
      const answer = selectAnswer(groups, snapshot.cardsById, source);
      if (generation !== generations.current.practice || !matchesExpectedTerminal()) return;
      const uuid = crypto.randomUUID();
      dispatch({
        type: "round-ready",
        mode,
        round: createRoundState({
          mode,
          hardcore: false,
          roundId: `practice:${uuid}`,
          hintSeed: uuid,
          answer,
        }),
      });
    } catch {
      if (generation === generations.current.practice) dispatch({ type: "round-failed", mode, error: MODE_PREPARATION_ERROR });
    } finally {
      if (generation === generations.current.practice) pending.current.practice = false;
    }
  }, [dispatch, groups, revision, snapshot.cardsById, snapshot.pairGroupsByKey, storage]);

  useEffect(() => {
    if (storage) removeLegacyCurrentRoundKeys(storage);
    void startPractice(false);
    return () => {
      generations.current.practice += 1;
      pending.current.practice = false;
    };
  }, [startPractice, storage]);

  useEffect(() => {
    void startDaily("daily", activeUtcDate);
    void startDaily("hardcore-daily", activeUtcDate);
    return () => {
      generations.current.daily += 1;
      generations.current["hardcore-daily"] += 1;
      pending.current.daily = false;
      pending.current["hardcore-daily"] = false;
    };
  }, [activeUtcDate, startDaily]);

  useEffect(() => {
    if (!storage) return;
    for (const mode of ["daily", "hardcore-daily", "practice"] as const) {
      const round = state.rounds.get(mode);
      if (!round) continue;
      const persisted = persistedRounds.current.get(mode);
      if (persisted === round) continue;
      saveCurrentRound(storage, identityFor(mode, revision, activeUtcDate), round);
      persistedRounds.current.set(mode, round);
      if (mode === "practice" || round.status !== "won") continue;
      const completionKey = `${mode}:${round.roundId}`;
      if (recordedCompletions.current.has(completionKey)) continue;
      recordDailyCompletion(
        storage,
        round.roundId.split(":")[1] ?? activeUtcDate,
        mode === "daily" ? DAILY_STATS_KEY : HARDCORE_DAILY_STATS_KEY,
      );
      recordedCompletions.current.add(completionKey);
    }
  }, [activeUtcDate, revision, state.rounds, storage]);

  const activeRound = state.rounds.get(state.activeMode) ?? null;
  useEffect(() => {
    if (activeRound) void preloadAnswerImages(activeRound.answer, snapshot.cardsById);
  }, [activeRound, snapshot.cardsById]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timerGeneration = 0;
    const checkUtcDate = () => {
      const next = utcDate();
      if (activeUtcDateRef.current === next) return;
      activeUtcDateRef.current = next;
      generations.current.daily += 1;
      generations.current["hardcore-daily"] += 1;
      pending.current.daily = false;
      pending.current["hardcore-daily"] = false;
      dispatch({ type: "invalidate-dailies" });
      setActiveUtcDate(next);
    };
    const armTimer = () => {
      if (disposed) return;
      if (timer !== null) clearTimeout(timer);
      const generation = ++timerGeneration;
      timer = setTimeout(() => {
        if (disposed || generation !== timerGeneration) return;
        timer = null;
        checkUtcDate();
        armTimer();
      }, Math.max(1, msUntilNextUtcDay()));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      checkUtcDate();
      armTimer();
    };
    armTimer();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      timerGeneration += 1;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [dispatch]);

  const applyToActive = useCallback((action: GameAction) => {
    const current = stateRef.current;
    const previous = current.rounds.get(current.activeMode);
    if (!previous) return;
    const round = gameReducer(previous, action);
    if (round !== previous) dispatch({ type: "transition", mode: current.activeMode, previous, round });
  }, [dispatch]);

  const submit = useCallback((cardId: string) => {
    applyToActive({ type: "submit", cardId, cardsById: snapshot.cardsById });
  }, [applyToActive, snapshot.cardsById]);

  const setPracticeFilterEnabled = useCallback((enabled: boolean) => {
    applyToActive({ type: "set-practice-filter-enabled", enabled });
  }, [applyToActive]);

  const setPracticeFilterGroupDisabled = useCallback((group: PracticeFilterGroupName, disabled: boolean) => {
    applyToActive({ type: "set-practice-filter-group-disabled", group, disabled });
  }, [applyToActive]);

  const setPracticeFilterValue = useCallback((
    group: PracticeFilterGroupName,
    value: PracticeFilterValue,
    selected: boolean,
  ) => {
    applyToActive({ type: "set-practice-filter-value", group, value, selected });
  }, [applyToActive]);

  const setMode = useCallback((mode: PlayMode) => {
    const before = stateRef.current;
    dispatch({ type: "switch-mode", mode });
    if (before.rounds.has(mode) && before.errors[mode] === null) return;
    if (pending.current[mode] && before.errors[mode] === null) return;
    if (mode === "practice") void startPractice(false);
    else void startDaily(mode, activeUtcDate);
  }, [activeUtcDate, dispatch, startDaily, startPractice]);

  const nextPracticeRound = useCallback(() => {
    const current = stateRef.current;
    if (current.activeMode !== "practice") return;
    const terminal = current.rounds.get("practice");
    if (!terminal || terminal.status === "playing") return;
    return startPractice(true, {
      roundId: terminal.roundId,
      status: terminal.status,
    });
  }, [startPractice]);

  const retryActiveMode = useCallback(() => {
    const current = stateRef.current;
    const mode = current.activeMode;
    if (pending.current[mode]) return;
    if (mode !== "practice") {
      void startDaily(mode, activeUtcDate);
      return;
    }
    const practice = current.rounds.get("practice");
    if (!practice) {
      void startPractice(false);
      return;
    }
    if (practice.status !== "playing") {
      void startPractice(true, {
        roundId: practice.roundId,
        status: practice.status,
      });
    }
  }, [activeUtcDate, startDaily, startPractice]);

  const controls = {
    activeMode: state.activeMode,
    roundToken: state.roundToken,
    dailyUtcDate: activeUtcDate,
    error: state.errors[state.activeMode],
    submit,
    setMode,
    consumeReveal: (target: RevealOrbTarget) => applyToActive({ type: "consume-reveal", target }),
    consumeFilter: (target: ConstraintOrbTarget) => applyToActive({ type: "consume-filter", target }),
    consumeNegation: (target: ConstraintOrbTarget) => applyToActive({ type: "consume-negation", target }),
    setCandidateVisibility: (category: CandidateCategory, visible: boolean) => applyToActive({ type: "set-candidate-visibility", category, visible }),
    setPracticeFilterEnabled,
    setPracticeFilterGroupDisabled,
    setPracticeFilterValue,
    forfeitPractice: () => applyToActive({ type: "forfeit-practice" }),
    nextPracticeRound,
    retryActiveMode,
    nextRound: nextPracticeRound,
  };
  return activeRound
    ? { ...controls, status: "ready", round: activeRound }
    : { ...controls, status: "loading", round: null };
}
