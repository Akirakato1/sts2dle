import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LoadedSnapshot } from "../api/load-snapshot.js";
import { createDailyRandom, createPracticeRandom } from "../../shared/random.js";
import { selectAnswer, type SelectedAnswer } from "../../shared/selection.js";
import { gameReducer, type PlayMode, type RoundState } from "./game-reducer.js";
import { preloadAnswerImages } from "./preload-images.js";

function utcDate(now = new Date()): string { return now.toISOString().slice(0, 10); }

export function useGame(snapshot: LoadedSnapshot) {
  const [round, setRound] = useState<RoundState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const groups = useMemo(() => ({
    baseGroups: snapshot.baseGroups,
    pairGroups: snapshot.pairGroups,
    baseGroupsByKey: new Map(snapshot.baseGroups.map((group) => [group.key, group])),
    pairGroupsByKey: snapshot.pairGroupsByKey,
  }), [snapshot]);
  const choose = useCallback(async (mode: PlayMode): Promise<SelectedAnswer> => {
    const source = mode === "daily"
      ? await createDailyRandom(utcDate(), snapshot.manifest.sourceRevision)
      : await Promise.resolve(createPracticeRandom());
    return selectAnswer(groups, snapshot.cardsById, source);
  }, [groups, snapshot]);
  const start = useCallback(async (mode: PlayMode) => {
    const generation = ++requestGeneration.current;
    try {
      setError(null);
      const answer = await choose(mode);
      if (generation !== requestGeneration.current) return;
      setRound((current) => current
        ? gameReducer(current, { type: "set-mode", mode, answer })
        : { mode, answer, guesses: [], status: "playing", error: null });
      void preloadAnswerImages(answer, snapshot.cardsById);
    } catch (caught) {
      if (generation === requestGeneration.current) setError(caught instanceof Error ? caught.message : "Unable to start a round.");
    }
  }, [choose, snapshot.cardsById]);
  useEffect(() => {
    void start("daily");
    return () => { requestGeneration.current += 1; };
  }, [start]);
  const submit = useCallback((cardId: string) => setRound((current) => {
    if (!current) return current;
    const card = snapshot.cardsById.get(cardId);
    const answerCard = snapshot.cardsById.get(current.answer.selectedCardId);
    if (!card || !answerCard) return { ...current, error: "That card is unavailable." };
    return gameReducer(current, { type: "submit", card, answerCard });
  }), [snapshot.cardsById]);
  const nextRound = useCallback(() => { if (round?.mode === "practice") void start("practice"); }, [round?.mode, start]);
  return { round, error, submit, setMode: start, nextRound };
}
