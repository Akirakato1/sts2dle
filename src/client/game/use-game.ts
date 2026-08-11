import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LoadedSnapshot } from "../api/load-snapshot.js";
import { createDailyRandom, createPracticeRandom } from "../../shared/random.js";
import { selectAnswer, type SelectedAnswer } from "../../shared/selection.js";
import { gameReducer, type PlayMode, type RoundState } from "./game-reducer.js";
import { preloadAnswerImages } from "./preload-images.js";
import {
  DAILY_RULESET_VERSION,
  loadDailyRound,
  msUntilNextUtcDay,
  recordDailyCompletion,
  saveDailyRound,
} from "./storage.js";

function utcDate(now = new Date()): string { return now.toISOString().slice(0, 10); }

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

export function useGame(snapshot: LoadedSnapshot) {
  const [round, setRound] = useState<RoundState | null>(null);
  const [roundToken, setRoundToken] = useState(0);
  const [activeUtcDate, setActiveUtcDate] = useState(() => utcDate());
  const [roundUtcDate, setRoundUtcDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const groups = useMemo(() => ({
    baseGroups: snapshot.baseGroups,
    pairGroups: snapshot.pairGroups,
    baseGroupsByKey: new Map(snapshot.baseGroups.map((group) => [group.key, group])),
    pairGroupsByKey: snapshot.pairGroupsByKey,
  }), [snapshot]);
  const choose = useCallback(async (mode: PlayMode, dailyDate: string): Promise<SelectedAnswer> => {
    const source = mode === "daily"
      ? await createDailyRandom(dailyDate, snapshot.manifest.sourceRevision)
      : await Promise.resolve(createPracticeRandom());
    return selectAnswer(groups, snapshot.cardsById, source);
  }, [groups, snapshot]);
  const start = useCallback(async (mode: PlayMode, dailyDate = activeUtcDate) => {
    const generation = ++requestGeneration.current;
    try {
      setError(null);
      const answer = await choose(mode, dailyDate);
      if (generation !== requestGeneration.current) return;
      const storage = mode === "daily" ? browserStorage() : null;
      const restored = storage ? loadDailyRound(storage, {
        sourceRevision: snapshot.manifest.sourceRevision,
        utcDate: dailyDate,
        ruleset: DAILY_RULESET_VERSION,
      }, snapshot.cardsById, answer) : null;
      setRound(restored ?? { mode, answer, guesses: [], status: "playing", error: null });
      setRoundUtcDate(mode === "daily" ? dailyDate : null);
      setRoundToken((current) => current + 1);
      void preloadAnswerImages(answer, snapshot.cardsById);
    } catch (caught) {
      if (generation === requestGeneration.current) setError(caught instanceof Error ? caught.message : "Unable to start a round.");
    }
  }, [activeUtcDate, choose, snapshot.cardsById, snapshot.manifest.sourceRevision]);
  useEffect(() => {
    void start("daily", activeUtcDate);
    return () => { requestGeneration.current += 1; };
  }, [activeUtcDate, start]);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timerGeneration = 0;
    const checkUtcDate = () => {
      const nextDate = utcDate();
      setActiveUtcDate((current) => current === nextDate ? current : nextDate);
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
  }, []);
  useEffect(() => {
    if (!round || round.mode !== "daily" || roundUtcDate === null) return;
    const storage = browserStorage();
    if (!storage) return;
    saveDailyRound(storage, {
      sourceRevision: snapshot.manifest.sourceRevision,
      utcDate: roundUtcDate,
      ruleset: DAILY_RULESET_VERSION,
    }, round);
    if (round.status === "won") recordDailyCompletion(storage, roundUtcDate);
  }, [round, roundUtcDate, snapshot.manifest.sourceRevision]);
  const submit = useCallback((cardId: string) => setRound((current) => {
    if (!current) return current;
    const card = snapshot.cardsById.get(cardId);
    const answerCard = snapshot.cardsById.get(current.answer.selectedCardId);
    if (!card || !answerCard) return { ...current, error: "That card is unavailable." };
    return gameReducer(current, { type: "submit", card, answerCard });
  }), [snapshot.cardsById]);
  const setMode = useCallback((mode: PlayMode) => start(mode, activeUtcDate), [activeUtcDate, start]);
  const nextRound = useCallback(() => { if (round?.mode === "practice") void start("practice", activeUtcDate); }, [activeUtcDate, round?.mode, start]);
  return { round, roundToken, dailyUtcDate: roundUtcDate ?? activeUtcDate, error, submit, setMode, nextRound };
}
