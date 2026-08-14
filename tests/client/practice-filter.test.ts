import { describe, expect, it } from "vitest";
import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";
import {
  classifyPracticeCandidate,
  collectPracticeFilterOptions,
  createDefaultPracticeFilter,
  updatePracticeFilterGroupDisabled,
  updatePracticeFilterGroupValue,
} from "../../src/client/game/practice-filter.js";

const vector: FeatureVector = {
  cardClass: "Ironclad", cardType: "Attack", mana: 0, rarity: "Basic",
  eternal: false, ethereal: false, exhaust: false, innate: false,
  retain: false, sly: false,
};

function card(id: string, baseChanges: Partial<FeatureVector> = {}, upgradedChanges: Partial<FeatureVector> = {}): CardIdentity {
  return {
    id, name: id, hasUpgrade: true, artUrl: "", baseCardUrl: null, upgradedCardUrl: null,
    base: { ...vector, ...baseChanges },
    upgraded: { ...vector, ...upgradedChanges },
  };
}

describe("practice filter defaults and snapshot options", () => {
  it("creates an independent all-disabled default filter", () => {
    expect(createDefaultPracticeFilter()).toEqual({
      enabled: false,
      cardClass: { disabled: true, selected: [] },
      cardType: { disabled: true, selected: [] },
      mana: { disabled: true, selected: [] },
      rarity: { disabled: true, selected: [] },
      keywords: { disabled: true, selected: [] },
    });

    const first = createDefaultPracticeFilter();
    first.mana.selected.push(2);
    expect(createDefaultPracticeFilter().mana.selected).toEqual([]);
  });

  it("collects only present base and upgraded values in stable snapshot order", () => {
    const cards = [
      card("first", { mana: 2, rarity: "Rare", retain: true }, { mana: "X", cardClass: "Silent", cardType: "Skill", eternal: true }),
      card("second", { mana: 0, cardType: "Skill", retain: true }, { mana: "None", rarity: "Basic", eternal: true }),
    ];

    expect(collectPracticeFilterOptions(cards)).toEqual({
      cardClass: ["Ironclad", "Silent"],
      cardType: ["Attack", "Skill"],
      mana: [0, 2, "X", "None"],
      rarity: ["Basic", "Rare"],
      keywords: ["eternal", "retain", "none"],
    });
  });
});

describe("practice filter form classification", () => {
  const bothCard = card("both", { mana: 2, retain: true }, { mana: 2, retain: true });
  const baseCard = card("base", { mana: 2, retain: true }, { mana: 3, retain: false });
  const upgradeCard = card("upgrade", { mana: 3, retain: false }, { mana: 2, retain: true });
  const hiddenCard = card("hidden", { mana: 3, retain: false }, { mana: 4, retain: false });

  function activeFilter() {
    const filter = createDefaultPracticeFilter();
    filter.mana = { disabled: false, selected: [2] };
    filter.keywords = { disabled: false, selected: ["retain"] };
    return filter;
  }

  it("reports which complete card form matches", () => {
    const filter = activeFilter();
    expect(classifyPracticeCandidate(bothCard, filter)).toBe("both");
    expect(classifyPracticeCandidate(baseCard, filter)).toBe("base-only");
    expect(classifyPracticeCandidate(upgradeCard, filter)).toBe("upgrade-only");
    expect(classifyPracticeCandidate(hiddenCard, filter)).toBeNull();
  });

  it("uses OR within a core group and AND across enabled groups", () => {
    const filter = createDefaultPracticeFilter();
    filter.mana = { disabled: false, selected: [2, 3] };
    filter.rarity = { disabled: false, selected: ["Rare"] };

    expect(classifyPracticeCandidate(card("either-mana", { mana: 2, rarity: "Rare" }, { mana: 3, rarity: "Rare" }), filter)).toBe("both");
    expect(classifyPracticeCandidate(card("wrong-rarity", { mana: 2, rarity: "Basic" }, { mana: 3, rarity: "Basic" }), filter)).toBeNull();
  });

  it("requires every selected keyword on the same form", () => {
    const filter = createDefaultPracticeFilter();
    filter.keywords = { disabled: false, selected: ["retain", "eternal"] };

    expect(classifyPracticeCandidate(card("all-keywords", { retain: true, eternal: true }, { retain: true, eternal: true }), filter)).toBe("both");
    expect(classifyPracticeCandidate(card("one-keyword", { retain: true, eternal: false }), filter)).toBeNull();
  });

  it("matches None only when a complete form has no keywords", () => {
    const filter = createDefaultPracticeFilter();
    filter.keywords = { disabled: false, selected: ["none"] };

    expect(classifyPracticeCandidate(card("keyword-free"), filter)).toBe("both");
    expect(classifyPracticeCandidate(card("gains-innate", {}, { innate: true }), filter)).toBe("base-only");
    expect(classifyPracticeCandidate(card("already-innate", { innate: true }, { innate: true }), filter)).toBeNull();
  });

  it("treats disabled groups as passing and enabled empty groups as failing", () => {
    const disabled = createDefaultPracticeFilter();
    expect(classifyPracticeCandidate(hiddenCard, disabled)).toBe("both");

    const empty = createDefaultPracticeFilter();
    empty.mana = { disabled: false, selected: [] };
    expect(classifyPracticeCandidate(hiddenCard, empty)).toBeNull();

    const emptyKeywords = createDefaultPracticeFilter();
    emptyKeywords.keywords = { disabled: false, selected: [] };
    expect(classifyPracticeCandidate(hiddenCard, emptyKeywords)).toBeNull();
  });

  it("does not combine matching values from different forms", () => {
    const filter = createDefaultPracticeFilter();
    filter.mana = { disabled: false, selected: [2] };
    filter.keywords = { disabled: false, selected: ["retain"] };

    expect(classifyPracticeCandidate(card("split", { mana: 2, retain: false }, { mana: 3, retain: true }), filter)).toBeNull();
  });
});

describe("practice filter immutable updates", () => {
  it("updates group disabled state without mutating selections", () => {
    const filter = createDefaultPracticeFilter();
    filter.mana.selected = [2];

    const updated = updatePracticeFilterGroupDisabled(filter, "mana", false);
    expect(updated).toEqual({ ...filter, mana: { disabled: false, selected: [2] } });
    expect(updated).not.toBe(filter);
    expect(updated.mana).not.toBe(filter.mana);
    expect(filter.mana).toEqual({ disabled: true, selected: [2] });
  });

  it("deduplicates selected values while immutably adding and removing them", () => {
    const filter = createDefaultPracticeFilter();
    const selected = updatePracticeFilterGroupValue(filter, "mana", 2, true);
    const duplicate = updatePracticeFilterGroupValue(selected, "mana", 2, true);
    const removed = updatePracticeFilterGroupValue(duplicate, "mana", 2, false);

    expect(selected.mana.selected).toEqual([2]);
    expect(duplicate.mana.selected).toEqual([2]);
    expect(duplicate).toBe(selected);
    expect(removed.mana.selected).toEqual([]);
    expect(filter.mana.selected).toEqual([]);
  });

  it("keeps None mutually exclusive with real keyword selections", () => {
    const filter = createDefaultPracticeFilter();
    filter.keywords = { disabled: false, selected: ["retain"] };

    const none = updatePracticeFilterGroupValue(filter, "keywords", "none", true);
    const retain = updatePracticeFilterGroupValue(none, "keywords", "retain", true);

    expect(none.keywords.selected).toEqual(["none"]);
    expect(retain.keywords.selected).toEqual(["retain"]);
    expect(filter.keywords.selected).toEqual(["retain"]);
  });

  it("ignores values that do not belong to the target group", () => {
    const filter = createDefaultPracticeFilter();
    expect(updatePracticeFilterGroupValue(filter, "mana", "Rare", true)).toBe(filter);
  });
});
