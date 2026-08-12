import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LoadedSnapshot } from "../api/load-snapshot.js";
import { createDailyRandom, createPracticeRandom } from "../../shared/random.js";
import { selectAnswer } from "../../shared/selection.js";
import type { CandidateCategory, ConstraintOrbTarget, RevealOrbTarget } from "./assistance.js";
import { createRoundState, gameReducer, type GameAction, type PlayMode, type RoundState } from "./game-reducer.js";
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
  round: RoundState;
  roundToken: number;
  dailyUtcDate: string;
  error: string | null;
  practiceHardcoreChoice: boolean;
  submit(cardId: string): void;
  setMode(mode: PlayMode): void;
  consumeReveal(target: RevealOrbTarget): void;
  consumeFilter(target: ConstraintOrbTarget): void;
  consumeNegation(target: ConstraintOrbTarget): void;
  setCandidateVisibility(category: CandidateCategory, visible: boolean): void;
  setPracticeHardcoreChoice(hardcore: boolean): void;
  forfeitPractice(): void;
  nextPracticeRound(): void;
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

export function useGame(snapshot: LoadedSnapshot) {
  const [rounds, setRounds] = useState(() => new Map<PlayMode, RoundState>());
  const [activeMode, setActiveMode] = useState<PlayMode>("daily");
  const [roundToken, setRoundToken] = useState(0);
  const [activeUtcDate, setActiveUtcDate] = useState(() => utcDate());
  const [error, setError] = useState<string | null>(null);
  const [practiceHardcoreChoice, setPracticeHardcoreChoiceState] = useState(false);
  const activeModeRef = useRef<PlayMode>("daily");
  const generations = useRef<Record<PlayMode, number>>({ daily: 0, "hardcore-daily": 0, practice: 0 });
  const groups = useMemo(() => ({
    baseGroups: snapshot.baseGroups,
    pairGroups: snapshot.pairGroups,
    baseGroupsByKey: new Map(snapshot.baseGroups.map((group) => [group.key, group])),
    pairGroupsByKey: snapshot.pairGroupsByKey,
  }), [snapshot]);
  const storage = browserStorage();
  const revision = snapshot.manifest.sourceRevision;

  const storeRound = useCallback((round: RoundState, date: string) => {
    if (!storage) return;
    saveCurrentRound(storage, identityFor(round.mode, revision, date), round);
  }, [revision, storage]);

  const startDaily = useCallback(async (mode: "daily" | "hardcore-daily", date: string) => {
    const generation = ++generations.current[mode];
    try {
      const answer = selectAnswer(groups, snapshot.cardsById, await createDailyRandom(date, revision, mode));
      if (generation !== generations.current[mode]) return;
      const identity = identityFor(mode, revision, date);
      const restored = storage
        ? loadCurrentRound(storage, identity, snapshot.cardsById, snapshot.pairGroupsByKey, answer)
        : null;
      const roundId = `${mode}:${date}:${revision}`;
      const next = restored ?? createRoundState({
        mode,
        hardcore: mode === "hardcore-daily",
        roundId,
        hintSeed: roundId,
        answer,
      });
      setRounds((current) => {
        const previous = current.get(mode);
        if (previous?.roundId === next.roundId && previous === next) return current;
        const updated = new Map(current);
        updated.set(mode, next);
        if (activeModeRef.current === mode && previous?.roundId !== next.roundId) setRoundToken((value) => value + 1);
        return updated;
      });
      storeRound(next, date);
      if (storage && next.status === "won") {
        recordDailyCompletion(storage, date, mode === "daily" ? DAILY_STATS_KEY : HARDCORE_DAILY_STATS_KEY);
      }
      if (activeModeRef.current === mode) void preloadAnswerImages(next.answer, snapshot.cardsById);
      setError(null);
    } catch (caught) {
      if (generation === generations.current[mode] && activeModeRef.current === mode) {
        setError(caught instanceof Error ? caught.message : "Unable to start a round.");
      }
    }
  }, [groups, revision, snapshot.cardsById, snapshot.pairGroupsByKey, storage, storeRound]);

  const startInitialPractice = useCallback(async () => {
    const mode = "practice" as const;
    const generation = ++generations.current.practice;
    const identity = identityFor(mode, revision, "");
    try {
      const restored = storage
        ? loadCurrentRound(storage, identity, snapshot.cardsById, snapshot.pairGroupsByKey)
        : null;
      let next = restored;
      if (!next) {
        const uuid = crypto.randomUUID();
        const answer = selectAnswer(groups, snapshot.cardsById, await Promise.resolve(createPracticeRandom()));
        next = createRoundState({
          mode,
          hardcore: false,
          roundId: `practice:${uuid}`,
          hintSeed: uuid,
          answer,
        });
      }
      if (generation !== generations.current.practice) return;
      setRounds((current) => new Map(current).set(mode, next));
      setPracticeHardcoreChoiceState(next.hardcore === true);
      storeRound(next, "");
      if (activeModeRef.current === mode) void preloadAnswerImages(next.answer, snapshot.cardsById);
    } catch (caught) {
      if (generation === generations.current.practice && activeModeRef.current === mode) {
        setError(caught instanceof Error ? caught.message : "Unable to start a round.");
      }
    }
  }, [groups, revision, snapshot.cardsById, snapshot.pairGroupsByKey, storage, storeRound]);

  useEffect(() => {
    if (storage) removeLegacyCurrentRoundKeys(storage);
    void startInitialPractice();
    return () => { generations.current.practice += 1; };
  }, [startInitialPractice, storage]);

  useEffect(() => {
    void startDaily("daily", activeUtcDate);
    void startDaily("hardcore-daily", activeUtcDate);
    return () => {
      generations.current.daily += 1;
      generations.current["hardcore-daily"] += 1;
    };
  }, [activeUtcDate, startDaily]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timerGeneration = 0;
    const checkUtcDate = () => setActiveUtcDate((current) => {
      const next = utcDate();
      return current === next ? current : next;
    });
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
  }, []);

  const applyToActive = useCallback((action: GameAction) => {
    const mode = activeModeRef.current;
    setRounds((current) => {
      const previous = current.get(mode);
      if (!previous) return current;
      const next = gameReducer(previous, action);
      if (next === previous) return current;
      const updated = new Map(current).set(mode, next);
      storeRound(next, activeUtcDate);
      if (previous.status === "playing" && next.status === "won" && storage && mode !== "practice") {
        recordDailyCompletion(storage, activeUtcDate, mode === "daily" ? DAILY_STATS_KEY : HARDCORE_DAILY_STATS_KEY);
      }
      return updated;
    });
  }, [activeUtcDate, storage, storeRound]);

  const submit = useCallback((cardId: string) => {
    applyToActive({ type: "submit", cardId, cardsById: snapshot.cardsById });
  }, [applyToActive, snapshot.cardsById]);

  const setMode = useCallback((mode: PlayMode) => {
    if (mode === activeModeRef.current) return;
    activeModeRef.current = mode;
    setActiveMode(mode);
    setRoundToken((value) => value + 1);
    const selected = rounds.get(mode);
    if (selected) void preloadAnswerImages(selected.answer, snapshot.cardsById);
  }, [rounds, snapshot.cardsById]);

  const setPracticeHardcoreChoice = useCallback((hardcore: boolean) => {
    setPracticeHardcoreChoiceState(hardcore);
    setRounds((current) => {
      const previous = current.get("practice");
      if (!previous) return current;
      const next = gameReducer(previous, { type: "set-practice-hardcore", hardcore });
      if (next === previous) return current;
      storeRound(next, activeUtcDate);
      return new Map(current).set("practice", next);
    });
  }, [activeUtcDate, storeRound]);

  const nextPracticeRound = useCallback(async () => {
    if (activeModeRef.current !== "practice") return;
    const generation = ++generations.current.practice;
    try {
      const uuid = crypto.randomUUID();
      const answer = selectAnswer(groups, snapshot.cardsById, await Promise.resolve(createPracticeRandom()));
      if (generation !== generations.current.practice) return;
      const next = createRoundState({
        mode: "practice",
        hardcore: practiceHardcoreChoice,
        roundId: `practice:${uuid}`,
        hintSeed: uuid,
        answer,
      });
      setRounds((current) => new Map(current).set("practice", next));
      storeRound(next, activeUtcDate);
      setRoundToken((value) => value + 1);
      setError(null);
      void preloadAnswerImages(next.answer, snapshot.cardsById);
    } catch (caught) {
      if (generation === generations.current.practice) setError(caught instanceof Error ? caught.message : "Unable to start a round.");
    }
  }, [activeUtcDate, groups, practiceHardcoreChoice, snapshot.cardsById, storeRound]);

  const round = rounds.get(activeMode) ?? null;
  return {
    round,
    roundToken,
    dailyUtcDate: activeUtcDate,
    error,
    practiceHardcoreChoice,
    submit,
    setMode,
    consumeReveal: (target: RevealOrbTarget) => applyToActive({ type: "consume-reveal", target }),
    consumeFilter: (target: ConstraintOrbTarget) => applyToActive({ type: "consume-filter", target }),
    consumeNegation: (target: ConstraintOrbTarget) => applyToActive({ type: "consume-negation", target }),
    setCandidateVisibility: (category: CandidateCategory, visible: boolean) => applyToActive({ type: "set-candidate-visibility", category, visible }),
    setPracticeHardcoreChoice,
    forfeitPractice: () => applyToActive({ type: "forfeit-practice" }),
    nextPracticeRound,
    nextRound: nextPracticeRound,
  };
}
