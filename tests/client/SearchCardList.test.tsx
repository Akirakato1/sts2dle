// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SearchCardList } from "../../src/client/components/SearchCardList.js";
import type { CardIdentity, FeatureVector, SpriteMap } from "../../src/shared/domain.js";

const vector: FeatureVector = { cardClass: "Silent", cardType: "Skill", mana: 1, rarity: "Common", target: "Self", powers: [], keywords: [] };
const makeCard = (id: string, name: string): CardIdentity => ({ id, name, hasUpgrade: true, artUrl: "", baseCardUrl: null, upgradedCardUrl: null, base: vector, upgraded: vector });
const cards = [makeCard("apparition", "Apparition"), makeCard("alchemize", "Alchemize"), makeCard("afterimage", "Afterimage")];
const spriteMap: SpriteMap = { candidate: { url: "/candidate.png", width: 32, height: 32, displayScale: 1 }, guess: { url: "/guess.png", width: 32, height: 32, displayScale: 1 }, cards: Object.fromEntries(cards.map((card) => [card.id, { candidate: { x: 0, y: 0, width: 32, height: 32 }, guess: { x: 0, y: 0, width: 32, height: 32 } }])) };
afterEach(cleanup);
test("renders candidate sprites and accessible form-match preview buttons", () => {
  render(<SearchCardList results={[{ card: cards[0]!, formMatch: "base-only" }, { card: cards[1]!, formMatch: "upgrade-only" }, { card: cards[2]!, formMatch: "both" }]} spriteMap={spriteMap} onPreview={vi.fn()} onWarmPreview={vi.fn()} />);
  expect(screen.getAllByRole("button", { name: /Preview/ })).toHaveLength(cards.length); expect(screen.getByRole("button", { name: "Preview Apparition — Base only" })).toBeVisible(); expect(screen.getByRole("button", { name: "Preview Alchemize — Upgrade only" })).toBeVisible(); expect(screen.getByRole("button", { name: "Preview Afterimage" })).toBeVisible(); expect(screen.getAllByRole("img")).toHaveLength(cards.length);
});
test("warms on pointer/focus and previews on click or Enter", () => {
  const onPreview = vi.fn(); const onWarmPreview = vi.fn(); render(<SearchCardList results={[{ card: cards[0]!, formMatch: "both" }]} spriteMap={spriteMap} onPreview={onPreview} onWarmPreview={onWarmPreview} />);
  const button = screen.getByRole("button", { name: "Preview Apparition" }); fireEvent.pointerEnter(button); fireEvent.focus(button); fireEvent.click(button); fireEvent.keyDown(button, { key: "Enter" });
  expect(onWarmPreview).toHaveBeenCalledWith(cards[0]); expect(onPreview).toHaveBeenCalledTimes(2); expect(onPreview).toHaveBeenLastCalledWith(cards[0]);
});
