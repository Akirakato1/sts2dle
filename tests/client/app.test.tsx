// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React, { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const loads = vi.hoisted(() => vi.fn());
const games = vi.hoisted(() => vi.fn());
vi.mock("../../src/client/api/load-snapshot.js", () => ({ loadSnapshot: loads }));
vi.mock("../../src/client/game/use-game.js", () => ({ useGame: games }));
import { App } from "../../src/client/App.js";
import { REVEAL_DURATION_MS, REVEAL_STAGGER_MS } from "../../src/client/components/FeatureTile.js";
import { REVEAL_FALLBACK_SAFETY_MS } from "../../src/client/components/GuessGrid.js";
import { FEATURE_ORDER } from "../../src/shared/domain.js";
import { createDefaultAssistance } from "../../src/client/game/assistance.js";
import type { RoundState } from "../../src/client/game/game-reducer.js";
import { createDefaultPracticeFilter } from "../../src/client/game/practice-filter.js";

const card = (id: string, name: string) => ({
  id, name, hasUpgrade: true, artUrl: `${id}.png`, baseCardUrl: `https://cards.example/${id}.png`, upgradedCardUrl: `https://cards.example/${id}-upgraded.png`,
  base: { cardClass: "Neutral", cardType: "Skill", mana: 1, rarity: "Common", eternal: false, ethereal: false, exhaust: false, innate: false, retain: false, sly: false },
  upgraded: { cardClass: "Neutral", cardType: "Skill", mana: 1, rarity: "Common", eternal: false, ethereal: false, exhaust: false, innate: false, retain: false, sly: false },
});
const appCards = [card("apotheosis", "Apotheosis"), card("apparition", "Apparition")];
const appSprite = { candidate: { x: 0, y: 0, width: 64, height: 64 }, guess: { x: 0, y: 0, width: 160, height: 160 } };
const searchSnapshot = {
  cards: appCards,
  cardsById: new Map(appCards.map((item) => [item.id, item])),
  spriteMap: {
    candidate: { url: "/candidate.webp", width: 128, height: 64, displayScale: 0.5 },
    guess: { url: "/guess.webp", width: 320, height: 160, displayScale: 0.45 },
    cards: { apotheosis: appSprite, apparition: appSprite },
  },
};
const appFeatureNames = ["cardClass", "cardType", "mana", "rarity", "eternal", "ethereal", "exhaust", "innate", "retain", "sly"] as const;
const makeResult = (feature: (typeof appFeatureNames)[number]) => ({
  feature,
  color: "red" as const,
  displayValue: String(appCards[1]!.base[feature]),
});
const submittedGuess = { cardId: "apparition", results: appFeatureNames.map(makeResult) };
const mixedGuess = {
  cardId: "apparition",
  results: appFeatureNames.map((feature) => ({
    ...makeResult(feature),
    color: feature === "cardType" ? "green" as const : feature === "mana" ? "yellow" as const : "red" as const,
  })),
};
const revealFallbackMs = FEATURE_ORDER.length * REVEAL_STAGGER_MS
  + REVEAL_DURATION_MS
  + REVEAL_FALLBACK_SAFETY_MS;

function dispatchTransformEnd(target: Element): void {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: "transform" });
  fireEvent(target, event);
}

beforeEach(() => {
  loads.mockReset();
  games.mockReset();
  games.mockReturnValue({ round: null, roundToken: 0, error: null, submit: vi.fn(), setMode: vi.fn(), nextRound: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture;
});

function assistedRound(overrides: Partial<RoundState> = {}): RoundState {
  return {
    mode: "daily",
    hardcore: false,
    roundId: "daily:2026-08-12:revision",
    hintSeed: "stable-seed",
    answer: { baseGroupKey: "base", selectedCardId: "apotheosis", pairKey: "pair", acceptedCardIds: ["apotheosis"] },
    guesses: [],
    status: "playing",
    terminalGuessCount: null,
    error: null,
    assistance: createDefaultAssistance(),
    practiceFilter: null,
    ...overrides,
  };
}

function readyGame(round: RoundState, overrides: Record<string, unknown> = {}) {
  return {
    status: "ready",
    round,
    roundToken: 1,
    dailyUtcDate: "2026-08-12",
    error: null,
    submit: vi.fn(),
    setMode: vi.fn(),
    consumeReveal: vi.fn(),
    consumeFilter: vi.fn(),
    consumeNegation: vi.fn(),
    setCandidateVisibility: vi.fn(),
    setPracticeFilterEnabled: vi.fn(),
    setPracticeFilterGroupDisabled: vi.fn(),
    setPracticeFilterValue: vi.fn(),
    forfeitPractice: vi.fn(),
    nextPracticeRound: vi.fn(),
    nextRound: vi.fn(),
    ...overrides,
  };
}

function practiceFilterActions() {
  return {
    setPracticeFilterEnabled: vi.fn(),
    setPracticeFilterGroupDisabled: vi.fn(),
    setPracticeFilterValue: vi.fn(),
  };
}

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    return this.state.error
      ? <p role="alert">{this.state.error.message}</p>
      : this.props.children;
  }
}

describe("App snapshot cleanup", () => {
  test("composes the live assisted controls with search input last", async () => {
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue(readyGame(assistedRound({
      guesses: Array.from({ length: 5 }, () => submittedGuess),
    })));

    const view = render(<App />);
    await screen.findByRole("combobox");
    const search = view.container.querySelector(".card-search")!;
    const inputIndex = [...search.children].findIndex((child) => child.matches("input"));
    const trayIndex = [...search.children].findIndex((child) => child.matches(".orb-tray"));
    const visibilityIndex = [...search.children].findIndex((child) => child.matches(".candidate-visibility"));
    const hintIndex = [...search.children].findIndex((child) => child.matches(".name-hint"));
    const labelIndex = [...search.children].findIndex((child) => child.matches("label.card-search__label"));

    expect([visibilityIndex, trayIndex, hintIndex, labelIndex, inputIndex]).toEqual([0, 1, 2, 3, 4]);
  });

  test("wires Practice Filter Mode between controls and search without mutating assistance presentation", async () => {
    window.localStorage.setItem("stsdle:filter-help-dismissed:v1", "1");
    const filteredCard = {
      ...appCards[0]!,
      upgraded: { ...appCards[0]!.upgraded, mana: 2 as const },
    };
    const filterCards = [filteredCard, appCards[1]!];
    const filterSnapshot = {
      ...searchSnapshot,
      cards: filterCards,
      cardsById: new Map(filterCards.map((item) => [item.id, item])),
    };
    const practiceFilter = {
      ...createDefaultPracticeFilter(),
      enabled: true,
      mana: { disabled: false, selected: [2] },
    };
    const assistance = {
      ...createDefaultAssistance(),
      negation: { guessIndex: 0, cardId: "apparition", feature: "cardClass" as const },
      visibility: { neutral: true, green: false, red: true },
    };
    const setPracticeFilterEnabled = vi.fn();
    const setPracticeFilterGroupDisabled = vi.fn();
    const setPracticeFilterValue = vi.fn();
    let gameState = readyGame(assistedRound({
      mode: "practice",
      roundId: "practice:filter",
      assistance,
      practiceFilter,
    }), { setPracticeFilterEnabled, setPracticeFilterGroupDisabled, setPracticeFilterValue });
    games.mockImplementation(() => gameState);
    loads.mockResolvedValue(filterSnapshot);

    const view = render(<App />);
    const input = await screen.findByRole("combobox", { name: "Guess a card" });
    expect(screen.getByRole("checkbox", { name: "Filter Mode" })).toBeChecked();
    const panel = screen.getByRole("region", { name: "Practice filters" });
    const boardChildren = [...view.container.querySelector(".game-board")!.children];
    expect(boardChildren.indexOf(screen.getByRole("region", { name: "Practice controls" }))).toBeLessThan(boardChildren.indexOf(panel));
    expect(boardChildren.indexOf(panel)).toBeLessThan(boardChildren.indexOf(screen.getByRole("region", { name: "Card search" })));

    const manaGroup = within(panel).getByRole("group", { name: "Mana" });
    expect(within(manaGroup).getByRole("checkbox", { name: "1" })).toBeInTheDocument();
    expect(within(manaGroup).getByRole("checkbox", { name: "2" })).toBeChecked();
    const classGroup = within(panel).getByRole("group", { name: "Class" });
    fireEvent.click(within(classGroup).getByRole("checkbox", { name: "Disable" }));
    expect(setPracticeFilterGroupDisabled).toHaveBeenCalledWith("cardClass", false);
    fireEvent.click(within(manaGroup).getByRole("checkbox", { name: "1" }));
    expect(setPracticeFilterValue).toHaveBeenCalledWith("mana", 1, true);

    const visibilityControls = screen.getByRole("group", { name: "Candidate visibility" });
    for (const category of ["Neutral", "Green", "Red"]) {
      expect(within(visibilityControls).getByRole("checkbox", { name: category })).toBeDisabled();
    }
    expect(view.container.querySelector(".card-search__assistance-slot--disabled")).not.toBeNull();
    expect(input).toBeEnabled();
    fireEvent.focus(input);
    expect(screen.getByRole("option", { name: /Apotheosis.*Upgrade only/ })).toHaveClass("card-search__option--neutral");

    gameState = {
      ...gameState,
      round: { ...gameState.round, practiceFilter: { ...practiceFilter, enabled: false } },
    };
    view.rerender(<App />);
    expect(screen.queryByRole("region", { name: "Practice filters" })).not.toBeInTheDocument();
    expect(within(visibilityControls).getByRole("checkbox", { name: "Green" })).not.toBeChecked();
    expect(within(visibilityControls).getByRole("checkbox", { name: "Green" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reveal Orb, available" })).toBeEnabled();
    expect(screen.getByRole("option", { name: /Apotheosis.*excluded by Negation Orb/ })).toHaveClass("card-search__option--red");

    fireEvent.click(screen.getByRole("checkbox", { name: "Filter Mode" }));
    expect(setPracticeFilterEnabled).toHaveBeenCalledWith(true);
  });

  test("fails explicitly when a Practice round omits required filter actions", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue(readyGame(assistedRound({
      mode: "practice",
      roundId: "practice:missing-actions",
      practiceFilter: createDefaultPracticeFilter(),
    }), {
      setPracticeFilterEnabled: undefined,
      setPracticeFilterGroupDisabled: undefined,
      setPracticeFilterValue: undefined,
    }));

    render(<AppErrorBoundary><App /></AppErrorBoundary>);

    expect(await screen.findByRole("alert")).toHaveTextContent("Practice filter actions are unavailable");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test("routes Reveal, Filter, and Negation target activations to their durable game actions", async () => {
    const consumeReveal = vi.fn();
    const consumeFilter = vi.fn();
    const consumeNegation = vi.fn();
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue(readyGame(assistedRound({ guesses: [mixedGuess] }), {
      consumeReveal,
      consumeFilter,
      consumeNegation,
    }));

    render(<App />);
    await screen.findByRole("combobox");
    fireEvent.click(screen.getByRole("button", { name: "Reveal Orb, available" }));
    fireEvent.click(screen.getByRole("button", { name: /Mana feature heading.*Use Reveal Orb/ }));
    expect(consumeReveal).toHaveBeenCalledWith({ feature: "mana" });
    expect(screen.getByRole("status")).toHaveTextContent("Reveal Orb showed Mana: 1.");

    fireEvent.click(screen.getByRole("button", { name: "Filter Orb, available" }));
    fireEvent.click(screen.getByRole("button", { name: /Type green result tile.*Use Filter Orb/ }));
    expect(consumeFilter).toHaveBeenCalledWith({ guessIndex: 0, cardId: "apparition", feature: "cardType" });

    fireEvent.click(screen.getByRole("button", { name: "Negation Orb, available" }));
    fireEvent.click(screen.getByRole("button", { name: /Class red result tile.*Use Negation Orb/ }));
    expect(consumeNegation).toHaveBeenCalledWith({ guessIndex: 0, cardId: "apparition", feature: "cardClass" });
  });

  test("announces a revealed keyword pair with accessible absent and present wording", async () => {
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue(readyGame(assistedRound()));

    render(<App />);
    await screen.findByRole("combobox");
    fireEvent.click(screen.getByRole("button", { name: "Reveal Orb, available" }));
    fireEvent.click(screen.getByRole("button", { name: /Eternal feature heading.*Use Reveal Orb/ }));

    expect(screen.getByRole("status")).toHaveTextContent("Reveal Orb showed Eternal: absent.");
  });

  test("keeps a stale Filter orb selected and announces the fixed semantic rejection", async () => {
    const consumeFilter = vi.fn();
    const staleGuess = { ...mixedGuess, results: mixedGuess.results.map((result) => ({ ...result })) };
    const round = assistedRound({ guesses: [staleGuess] });
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue(readyGame(round, { consumeFilter }));

    render(<App />);
    await screen.findByRole("combobox");
    const filter = screen.getByRole("button", { name: "Filter Orb, available" });
    fireEvent.click(filter);
    const target = screen.getByRole("button", { name: /Type green result tile.*Use Filter Orb/ });
    const sourceResult = round.guesses[0]!.results.find((result) => result.feature === "cardType")!;
    sourceResult.color = "red";
    fireEvent.click(target);

    expect(consumeFilter).not.toHaveBeenCalled();
    expect(filter).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Filter Orb requires a revealed green feature tile.");
  });

  test("keeps Filter selected when a real red tile rejects click activation", async () => {
    const consumeFilter = vi.fn();
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue(readyGame(assistedRound({ guesses: [mixedGuess] }), { consumeFilter }));

    render(<App />);
    await screen.findByRole("combobox");
    const filter = screen.getByRole("button", { name: "Filter Orb, available" });
    fireEvent.click(filter);
    fireEvent.click(screen.getByRole("button", { name: /Class red result tile.*Invalid target for Filter Orb/ }));

    expect(consumeFilter).not.toHaveBeenCalled();
    expect(filter).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Class red result tile is an invalid target for the Filter Orb.");
  });

  test("modal Escape closes help without canceling an orb, then normal Escape cancels it", async () => {
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue(readyGame(assistedRound()));

    render(<App />);
    const filter = await screen.findByRole("button", { name: "Filter Orb, available" });
    fireEvent.click(filter);
    expect(filter).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "How to play" }));
    const closeHelp = screen.getByRole("button", { name: "Close help" });
    fireEvent.keyDown(closeHelp, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "How to play" })).not.toBeInTheDocument();
    expect(filter).toHaveAttribute("aria-pressed", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(filter).toHaveAttribute("aria-pressed", "false");
  });

  test("renders durable bubble and exact badges while red classification overrides green", async () => {
    const assistance = {
      ...createDefaultAssistance(),
      reveal: { feature: "eternal" as const },
      filter: { guessIndex: 0, cardId: "apparition", feature: "cardType" as const },
      negation: { guessIndex: 0, cardId: "apparition", feature: "cardClass" as const },
    };
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue(readyGame(assistedRound({ guesses: [mixedGuess], assistance })));

    render(<App />);
    const input = await screen.findByRole("combobox");
    expect(screen.getByLabelText("Answer: absent")).toBeInTheDocument();
    expect(screen.getByLabelText("Filter Orb used here")).toBeInTheDocument();
    expect(screen.getByLabelText("Negation Orb used here")).toBeInTheDocument();

    fireEvent.focus(input);
    const candidate = screen.getByRole("option", { name: /Apotheosis.*excluded by Negation Orb/ });
    expect(candidate).toHaveClass("card-search__option--red");
    expect(candidate).not.toHaveClass("card-search__option--green");
    fireEvent.click(candidate);
    expect(games.mock.results.at(-1)?.value.submit).toHaveBeenCalledWith("apotheosis");
  });

  test("shows visible Spire Codex attribution and an explicit unofficial Mega Crit disclaimer", () => {
    loads.mockImplementation(() => new Promise(() => undefined));
    render(<App />);

    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveTextContent(/unofficial fan project/i);
    expect(footer).toHaveTextContent(/not affiliated with or endorsed by Mega Crit/i);
    expect(screen.getByRole("link", { name: "Spire Codex" })).toHaveAttribute(
      "href",
      "https://spire-codex.com/",
    );
  });
  test("StrictMode aborts all pending loads without showing an error and remounts successfully", async () => {
    const calls: AbortSignal[] = [];
    loads.mockImplementation((_fetch: typeof fetch, signal: AbortSignal) => new Promise((_resolve, reject) => {
      calls.push(signal); signal.addEventListener("abort", () => reject(new DOMException("abort", "AbortError")), { once: true });
    }));
    const first = render(<StrictMode><App /></StrictMode>);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(calls[0]?.aborted).toBe(true));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    first.unmount();
    expect(calls.every((signal) => signal.aborted)).toBe(true);
    loads.mockResolvedValueOnce({});
    render(<App />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Preparing today"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("keeps loading visible while sprite readiness is pending", async () => {
    let resolve!: (value: typeof searchSnapshot) => void;
    loads.mockImplementation(() => new Promise<typeof searchSnapshot>((resolveLoad) => { resolve = resolveLoad; }));

    const view = render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading card data");
    expect(screen.getByText("Prototype", { selector: ".subtitle" })).toBeVisible();
    expect(screen.queryByText("A daily card deduction.")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "How to play" }).closest(".hero")).toBeTruthy();
    expect(view.container.querySelector(".game-panel .game-guide")).toBeNull();
    resolve(searchSnapshot);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Preparing today's card"));
  });

  test("shows the existing retry panel when sprite readiness fails", async () => {
    loads.mockRejectedValue(new Error("Unable to prepare card artwork"));

    render(<App />);
    const panel = await screen.findByRole("alert");
    expect(panel).toHaveTextContent("We couldn't load the current card set.");
    expect(panel).toHaveTextContent("Unable to prepare card artwork");
    expect(panel).toHaveTextContent("Try again");
  });

  test("starts a fresh sprite readiness load when retrying", async () => {
    loads.mockRejectedValueOnce(new Error("Unable to prepare card artwork"));
    loads.mockImplementationOnce(() => new Promise(() => undefined));

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(loads).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("status")).toHaveTextContent("Loading card data");
  });

  test("keeps help in the hero and opens its legend modal with the active game", async () => {
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue({
      round: {
        mode: "daily",
        answer: { baseGroupKey: "base", selectedCardId: "apotheosis", pairKey: "pair", acceptedCardIds: ["apotheosis"] },
        guesses: [],
        status: "playing",
        error: null,
      },
      roundToken: 1,
      error: null,
      submit: vi.fn(),
      setMode: vi.fn(),
      nextRound: vi.fn(),
    });

    const view = render(<App />);
    const trigger = await screen.findByRole("button", { name: "How to play" });
    expect(trigger.closest(".hero")).toBeTruthy();
    expect(view.container.querySelector(".game-panel .game-guide")).toBeNull();
    expect(screen.queryByText("Both base and upgraded features match")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "How to play" })).toBeVisible();
  });

  test("renders exactly Daily, Hardcore Daily, and Practice mode tabs", async () => {
    const setMode = vi.fn();
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue({
      status: "ready",
      round: {
        mode: "daily",
        hardcore: false,
        roundId: "daily:2026-08-12:revision",
        hintSeed: "daily:2026-08-12:revision",
        answer: { baseGroupKey: "base", selectedCardId: "apotheosis", pairKey: "pair", acceptedCardIds: ["apotheosis"] },
        guesses: [],
        status: "playing",
        terminalGuessCount: null,
        error: null,
        assistance: createDefaultAssistance(),
      },
      roundToken: 1,
      dailyUtcDate: "2026-08-12",
      error: null,
      submit: vi.fn(),
      setMode,
      setCandidateVisibility: vi.fn(),
      forfeitPractice: vi.fn(),
      nextPracticeRound: vi.fn(),
      nextRound: vi.fn(),
    });

    render(<App />);
    const tabs = await screen.findAllByRole("button", { name: /^(Daily|Hardcore Daily|Practice)$/ });
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Daily", "Hardcore Daily", "Practice"]);
    fireEvent.click(screen.getByRole("button", { name: "Hardcore Daily" }));
    expect(setMode).toHaveBeenCalledWith("hardcore-daily");
    expect(screen.queryByRole("checkbox", { name: "Filter Mode" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Practice filters" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End game" })).not.toBeInTheDocument();
  });

  test("keeps mode navigation and a sanitized Retry action when active-mode setup fails", async () => {
    const setMode = vi.fn();
    const retryActiveMode = vi.fn();
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue({
      status: "loading",
      activeMode: "daily",
      round: null,
      roundToken: 3,
      dailyUtcDate: "2026-08-12",
      error: "Unable to prepare this game mode.",
      setMode,
      retryActiveMode,
    });

    render(<App />);

    expect(await screen.findByRole("navigation", { name: "Round mode" })).toBeVisible();
    expect(screen.getByRole("button", { name: "How to play" }).closest(".hero")).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent("Unable to prepare this game mode.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("BEAT_DOWN");
    fireEvent.click(screen.getByRole("button", { name: "Hardcore Daily" }));
    expect(setMode).toHaveBeenCalledWith("hardcore-daily");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retryActiveMode).toHaveBeenCalledOnce();
  });

  test("keeps navigation but removes the old round controls and share provider while a mode reloads", async () => {
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue({
      status: "loading",
      activeMode: "hardcore-daily",
      round: null,
      roundToken: 4,
      dailyUtcDate: "2026-08-13",
      error: null,
      setMode: vi.fn(),
      retryActiveMode: vi.fn(),
    });

    render(<App />);

    expect(await screen.findByRole("navigation", { name: "Round mode" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Hardcore Daily" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("status")).toHaveTextContent("Preparing today's card");
    expect(screen.queryByRole("combobox", { name: "Guess a card" })).not.toBeInTheDocument();
    expect(screen.queryByRole("main", { name: "Card guessing game" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy .* result/ })).not.toBeInTheDocument();
  });

  test("derives a masked selected-name hint from wrong guesses only in assisted rounds", async () => {
    const answer = card("answer", "Alpha Beta");
    const hintSnapshot = {
      ...searchSnapshot,
      cards: [...appCards, answer],
      cardsById: new Map([...appCards, answer].map((item) => [item.id, item])),
      spriteMap: {
        ...searchSnapshot.spriteMap,
        cards: { ...searchSnapshot.spriteMap.cards, answer: appSprite },
      },
    };
    loads.mockResolvedValue(hintSnapshot);
    games.mockReturnValue({
      status: "ready",
      round: {
        mode: "daily",
        hardcore: false,
        roundId: "daily:2026-08-12:revision",
        hintSeed: "stable-seed",
        answer: { baseGroupKey: "base", selectedCardId: "answer", pairKey: "pair", acceptedCardIds: ["answer"] },
        guesses: Array.from({ length: 5 }, () => submittedGuess),
        status: "playing",
        terminalGuessCount: null,
        error: null,
        assistance: createDefaultAssistance(),
      },
      roundToken: 1,
      dailyUtcDate: "2026-08-12",
      error: null,
      submit: vi.fn(),
      setMode: vi.fn(),
      setCandidateVisibility: vi.fn(),
      forfeitPractice: vi.fn(),
      nextPracticeRound: vi.fn(),
      nextRound: vi.fn(),
    });

    const view = render(<App />);
    expect(await screen.findByLabelText("Card name hint: blank blank blank blank blank; blank blank blank blank")).toBeVisible();
    expect(view.container.querySelectorAll(".name-hint__word")).toHaveLength(2);
    expect(screen.getByRole("group", { name: "Candidate visibility" })).toBeVisible();

    games.mockReturnValue({
      ...games.mock.results.at(-1)?.value,
      round: {
        ...games.mock.results.at(-1)?.value.round,
        mode: "hardcore-daily",
        hardcore: true,
        assistance: null,
      },
      roundToken: 2,
    });
    view.rerender(<App />);
    expect(screen.queryByLabelText(/Card name hint:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Candidate visibility" })).not.toBeInTheDocument();
  });

  test("reveals forfeited Practice answers and offers the next round without sharing", async () => {
    const nextPracticeRound = vi.fn();
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue({
      status: "ready",
      round: {
        mode: "practice",
        hardcore: false,
        roundId: "practice:one",
        hintSeed: "one",
        answer: { baseGroupKey: "base", selectedCardId: "apotheosis", pairKey: "pair", acceptedCardIds: ["apotheosis"] },
        guesses: [],
        status: "forfeited",
        terminalGuessCount: 0,
        error: null,
        assistance: createDefaultAssistance(),
        practiceFilter: createDefaultPracticeFilter(),
      },
      roundToken: 2,
      dailyUtcDate: "2026-08-12",
      error: null,
      submit: vi.fn(),
      setMode: vi.fn(),
      setCandidateVisibility: vi.fn(),
      ...practiceFilterActions(),
      forfeitPractice: vi.fn(),
      nextPracticeRound,
      nextRound: nextPracticeRound,
    });

    render(<App />);
    expect(await screen.findByRole("heading", { name: "Accepted answer" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Filter Mode" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "New Practice Round" }));
    expect(nextPracticeRound).toHaveBeenCalledOnce();
  });

  test("wires base-card candidates to game submission and excludes prior guesses", async () => {
    const submit = vi.fn();
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue({
      round: {
        mode: "daily",
        answer: { baseGroupKey: "base", selectedCardId: "apotheosis", pairKey: "pair", acceptedCardIds: ["apotheosis"] },
        guesses: [{ cardId: "apparition", results: [] }],
        status: "playing",
        error: null,
      },
      roundToken: 1,
      error: null,
      submit,
      setMode: vi.fn(),
      nextRound: vi.fn(),
    });

    render(<App />);
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "ap" } });
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["Apotheosisunhighlighted candidate"]);
    fireEvent.click(screen.getByRole("option"));
    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith("apotheosis");
  });

  test("clears search and resets filters on a new Practice round", async () => {
    const makeRound = (
      mode: "daily" | "practice",
      selectedCardId: string,
      practiceFilter: RoundState["practiceFilter"] = mode === "practice" ? createDefaultPracticeFilter() : null,
    ): RoundState => ({
      mode,
      hardcore: false,
      roundId: `${mode}:round`,
      hintSeed: `${mode}:round`,
      answer: { baseGroupKey: "base", selectedCardId, pairKey: "pair", acceptedCardIds: [selectedCardId] },
      guesses: [],
      status: "playing",
      terminalGuessCount: null,
      error: null,
      assistance: createDefaultAssistance(),
      practiceFilter,
    });
    const selectedFilter = {
      ...createDefaultPracticeFilter(),
      enabled: true,
      mana: { disabled: false, selected: [1] },
    };
    const submit = vi.fn();
    let gameState = {
      round: makeRound("daily", "apotheosis"),
      roundToken: 1,
      error: null,
      submit,
      setMode: vi.fn(),
      nextRound: vi.fn(),
      ...practiceFilterActions(),
    };
    games.mockImplementation(() => gameState);
    loads.mockResolvedValue(searchSnapshot);
    const view = render(<App />);
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "ap" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    gameState = { ...gameState, round: makeRound("practice", "apparition", selectedFilter), roundToken: 2 };
    view.rerender(<App />);
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Filter Mode" })).toBeChecked();
    expect(screen.getByRole("region", { name: "Practice filters" })).toBeVisible();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ap" } });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    gameState = { ...gameState, round: makeRound("practice", "apotheosis"), roundToken: 3 };
    view.rerender(<App />);
    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Filter Mode" })).not.toBeChecked();
    expect(screen.queryByRole("region", { name: "Practice filters" })).not.toBeInTheDocument();
  });

  test("locks the search from row insertion through the tenth tile reveal", async () => {
    const submit = vi.fn();
    let gameState = {
      ...readyGame(assistedRound()),
      submit,
    };
    games.mockImplementation(() => gameState);
    loads.mockResolvedValue(searchSnapshot);
    const view = render(<App />);
    const input = await screen.findByRole("combobox");
    expect(input).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reveal Orb, available" })).toBeEnabled();

    gameState = {
      ...gameState,
      round: {
        ...gameState.round,
        guesses: [submittedGuess],
      },
    };
    view.rerender(<App />);
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(within(screen.getByRole("group", { name: "Candidate visibility" })).getByRole("checkbox", { name: "Neutral" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reveal Orb, available" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Filter Orb, available" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Negation Orb, available" })).toBeDisabled();

    const surfaces = view.container.querySelectorAll(".feature-tile__surface");
    dispatchTransformEnd(surfaces[surfaces.length - 1]!);
    expect(screen.getByRole("combobox")).toBeEnabled();
    expect(within(screen.getByRole("group", { name: "Candidate visibility" })).getByRole("checkbox", { name: "Neutral" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reveal Orb, available" })).toBeEnabled();
  });

  test.each(["won", "forfeited"] as const)("keeps terminal %s rounds free of active orb targets", async (status) => {
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue(readyGame(assistedRound({
      mode: status === "forfeited" ? "practice" : "daily",
      roundId: status === "forfeited" ? "practice:terminal" : "daily:terminal",
      status,
      terminalGuessCount: 1,
      guesses: [mixedGuess],
    })));

    const view = render(<App />);
    await screen.findByRole("combobox");
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reveal Orb, available" })).toBeDisabled();
    expect(view.container.querySelector(".guess-grid__header-target, .feature-tile__target")).toBeNull();
  });

  test("omits every assistance surface and orb share marker in Hardcore", async () => {
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue(readyGame(assistedRound({
      mode: "hardcore-daily",
      hardcore: true,
      roundId: "hardcore-daily:2026-08-12:revision",
      guesses: Array.from({ length: 5 }, () => submittedGuess),
      assistance: null,
    })));

    const view = render(<App />);
    await screen.findByRole("combobox");
    expect(screen.queryByRole("region", { name: "Orb inventory" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Candidate visibility" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Card name hint:/)).not.toBeInTheDocument();
    expect(view.container.querySelector(".guess-grid__header-target, .feature-tile__target")).toBeNull();
    expect(view.container).not.toHaveTextContent("Orbs:");
  });

  test("disables Practice End game while an orb is actively dragging", async () => {
    class TestPointerEvent extends MouseEvent {
      readonly pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    }
    vi.stubGlobal("PointerEvent", TestPointerEvent);
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, value: vi.fn() });
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue(readyGame(assistedRound({
      mode: "practice",
      roundId: "practice:drag",
    })));

    render(<App />);
    const endGame = await screen.findByRole("button", { name: "End game" });
    const filter = screen.getByRole("button", { name: "Filter Orb, available" });
    expect(endGame).toBeEnabled();
    fireEvent.pointerDown(filter, { pointerId: 41, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(filter, { pointerId: 41, clientX: 20, clientY: 20 });
    expect(endGame).toBeDisabled();
  });

  test("keeps the search locked until a missing transition reaches the fallback", async () => {
    let gameState = {
      round: {
        mode: "daily" as const,
        answer: { baseGroupKey: "base", selectedCardId: "apotheosis", pairKey: "pair", acceptedCardIds: ["apotheosis"] },
        guesses: [] as Array<typeof submittedGuess>,
        status: "playing" as const,
        error: null,
      },
      roundToken: 1,
      error: null,
      submit: vi.fn(),
      setMode: vi.fn(),
      nextRound: vi.fn(),
    };
    games.mockImplementation(() => gameState);
    loads.mockResolvedValue(searchSnapshot);
    const view = render(<App />);
    await screen.findByRole("combobox");
    vi.useFakeTimers();

    gameState = { ...gameState, round: { ...gameState.round, guesses: [submittedGuess] } };
    view.rerender(<App />);
    expect(screen.getByRole("combobox")).toBeDisabled();
    act(() => vi.advanceTimersByTime(revealFallbackMs - 1));
    expect(screen.getByRole("combobox")).toBeDisabled();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("combobox")).toBeEnabled();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("combobox")).toBeEnabled();
  });

  test("reveals every accepted Daily answer and offers Daily sharing only after a win", async () => {
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue({
      round: {
        mode: "daily",
        answer: { baseGroupKey: "base", selectedCardId: "apotheosis", pairKey: "pair", acceptedCardIds: ["apparition", "apotheosis"] },
        guesses: [submittedGuess],
        status: "won",
        error: null,
      },
      roundToken: 1,
      dailyUtcDate: "2026-08-12",
      error: null,
      submit: vi.fn(),
      setMode: vi.fn(),
      nextRound: vi.fn(),
    });

    const view = render(<App />);
    await screen.findByRole("heading", { name: "Accepted answers" });
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)).toEqual([
      "Apotheosis",
      "Apparition",
    ]);
    expect(Array.from(view.container.querySelectorAll(".answer-reveal img"), (image) => image.getAttribute("src"))).toEqual([
      "https://cards.example/apotheosis.png",
      "https://cards.example/apotheosis-upgraded.png",
      "https://cards.example/apparition.png",
      "https://cards.example/apparition-upgraded.png",
    ]);
    expect(screen.getByRole("button", { name: "Copy Daily result" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next random card" })).not.toBeInTheDocument();
  });

  test("waits for the winning row reveal to finish before showing result UI", async () => {
    let gameState = {
      round: {
        mode: "daily" as const,
        answer: { baseGroupKey: "base", selectedCardId: "apotheosis", pairKey: "pair", acceptedCardIds: ["apotheosis"] },
        guesses: [] as Array<typeof submittedGuess>,
        status: "playing" as "playing" | "won",
        error: null,
      },
      roundToken: 1,
      dailyUtcDate: "2026-08-12",
      error: null,
      submit: vi.fn(),
      setMode: vi.fn(),
      nextRound: vi.fn(),
    };
    games.mockImplementation(() => gameState);
    loads.mockResolvedValue(searchSnapshot);
    const view = render(<App />);
    await screen.findByRole("combobox");

    gameState = {
      ...gameState,
      round: { ...gameState.round, guesses: [submittedGuess], status: "won" },
    };
    view.rerender(<App />);
    expect(screen.queryByRole("heading", { name: "Accepted answer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy Daily result" })).not.toBeInTheDocument();

    const surfaces = view.container.querySelectorAll(".feature-tile__surface");
    dispatchTransformEnd(surfaces[surfaces.length - 1]!);
    expect(screen.getByRole("heading", { name: "Accepted answer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Daily result" })).toBeInTheDocument();
  });

  test("shows a new-round action without Practice sharing after a Practice win", async () => {
    const nextRound = vi.fn();
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue({
      round: {
        mode: "practice",
        hardcore: false,
        roundId: "practice:won",
        hintSeed: "practice:won",
        answer: { baseGroupKey: "base", selectedCardId: "apotheosis", pairKey: "pair", acceptedCardIds: ["apotheosis"] },
        guesses: [submittedGuess],
        status: "won",
        terminalGuessCount: 1,
        error: null,
        assistance: createDefaultAssistance(),
        practiceFilter: createDefaultPracticeFilter(),
      },
      roundToken: 2,
      dailyUtcDate: "2026-08-12",
      error: null,
      submit: vi.fn(),
      setMode: vi.fn(),
      ...practiceFilterActions(),
      nextRound,
    });

    render(<App />);
    const next = await screen.findByRole("button", { name: "New Practice Round" });
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
    fireEvent.click(next);
    expect(nextRound).toHaveBeenCalledOnce();
  });

  test("renders restored guesses settled instead of replaying their reveal", async () => {
    loads.mockResolvedValue(searchSnapshot);
    games.mockReturnValue({
      round: {
        mode: "daily",
        answer: { baseGroupKey: "base", selectedCardId: "apotheosis", pairKey: "pair", acceptedCardIds: ["apotheosis"] },
        guesses: [submittedGuess],
        status: "playing",
        error: null,
      },
      roundToken: 5,
      dailyUtcDate: "2026-08-12",
      error: null,
      submit: vi.fn(),
      setMode: vi.fn(),
      nextRound: vi.fn(),
    });

    const view = render(<App />);
    await screen.findByRole("combobox");
    expect(view.container.querySelectorAll(".feature-tile--immediate")).toHaveLength(FEATURE_ORDER.length);
    expect(screen.getByRole("combobox")).toBeEnabled();
  });
});
