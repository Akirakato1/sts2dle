import { describe, expect, it } from "vitest";
import { deriveNameHint, type NameHintView } from "../../src/client/game/name-hints.js";

function revealedText(hint: NameHintView | null): string[] {
  if (!hint) throw new Error("expected a name hint");
  return hint.words.map((word) => word.characters.map((character) => character.revealed ? character.value : " ").join(""));
}

function revealedPositions(hint: NameHintView): number[] {
  return hint.words.flatMap((word) => word.characters.filter((character) => character.revealed).map((character) => character.position));
}

describe("deriveNameHint", () => {
  it("starts after five wrong guesses and reveals initials before random positions", () => {
    expect(deriveNameHint("Alpha Beta", 4, "round-a")).toBeNull();
    expect(revealedText(deriveNameHint("Alpha Beta", 5, "round-a"))).toEqual(["     ", "    "]);
    expect(revealedText(deriveNameHint("Alpha Beta", 6, "round-a"))).toEqual(["     ", "    "]);
    expect(revealedText(deriveNameHint("Alpha Beta", 7, "round-a"))).toEqual(["A    ", "    "]);
    expect(revealedText(deriveNameHint("Alpha Beta", 8, "round-a"))).toEqual(["A    ", "B   "]);
  });

  it("treats punctuation as revealable Unicode code points", () => {
    const hint = deriveNameHint("F.T.L.", 7, "punctuation");
    expect(hint!.words).toHaveLength(1);
    expect(hint!.words[0]!.length).toBe(6);
  });

  it("reveals exactly one indexed position after initials, even for repeated letters", () => {
    const hint = deriveNameHint("AAAA", 8, "repeated")!;
    expect(revealedPositions(hint)).toHaveLength(2);
  });

  it("uses a stable seed-specific order for non-initial positions", () => {
    const first = deriveNameHint("Alphabet Grammar", 9, "seed-a")!;
    const repeat = deriveNameHint("Alphabet Grammar", 9, "seed-a")!;
    const alternate = deriveNameHint("Alphabet Grammar", 9, "seed-b")!;

    expect(revealedText(first)).toEqual(revealedText(repeat));
    expect(revealedText(alternate)).not.toEqual(revealedText(first));
  });

  it("eventually reveals every position and then keeps the completed mask", () => {
    const complete = deriveNameHint("F.T.L.", 12, "complete")!;
    const afterExhaustion = deriveNameHint("F.T.L.", 30, "complete")!;

    expect(complete.complete).toBe(true);
    expect(complete.words[0]!.characters.every((character) => character.revealed)).toBe(true);
    expect(revealedText(afterExhaustion)).toEqual(revealedText(complete));
  });
});
