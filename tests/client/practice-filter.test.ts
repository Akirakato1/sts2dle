import { describe, expect, it } from "vitest";

import type { CardIdentity, FeatureVector } from "../../src/shared/domain.js";
import {
  KEYWORD_FILTER_NONE,
  POWER_FILTER_NONE,
  classifyPracticeCandidate,
  collectPracticeFilterOptions,
  createDefaultPracticeFilter,
  updatePracticeFilterGroupDisabled,
  updatePracticeFilterGroupValue,
} from "../../src/client/game/practice-filter.js";

const vector: FeatureVector = {
  cardClass: "Ironclad", cardType: "Attack", mana: 0, rarity: "Basic",
  target: "Self", powers: [], keywords: [],
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
      target: { disabled: true, selected: [] },
      powers: { disabled: true, selected: [] },
      keywords: { disabled: true, selected: [] },
    });

    const first = createDefaultPracticeFilter();
    first.powers.selected.push("Strength");
    expect(createDefaultPracticeFilter().powers.selected).toEqual([]);
  });

  it("collects only present base and upgraded values in canonical snapshot order", () => {
    const cards = [
      card("first", {
        mana: 2, rarity: "Rare", target: "AllEnemies",
        powers: ["Dexterity", "Strength", "Unique Buff"], keywords: ["Exhaust", "Retain"],
      }, {
        mana: "X", cardClass: "Silent", cardType: "Skill", target: "AnyEnemy",
        powers: ["Strength"], keywords: ["Eternal"],
      }),
      card("second", {
        mana: 0, cardType: "Skill", target: "Self", powers: ["Artifact"], keywords: ["Retain"],
      }, {
        mana: "None", rarity: "Basic", target: "None", powers: [], keywords: [],
      }),
    ];

    expect(collectPracticeFilterOptions(cards)).toEqual({
      cardClass: ["Ironclad", "Silent"],
      cardType: ["Attack", "Skill"],
      mana: [0, 2, "X", "None"],
      rarity: ["Basic", "Rare"],
      target: ["Self", "AnyEnemy", "AllEnemies", "None"],
      powers: ["Artifact", "Dexterity", "Strength", "Unique Buff", POWER_FILTER_NONE],
      keywords: ["Eternal", "Exhaust", "Retain", KEYWORD_FILTER_NONE],
    });
  });
});

describe("practice filter form classification", () => {
  const bothCard = card("both", { mana: 2, target: "AnyEnemy", powers: ["Strength", "Dexterity"], keywords: ["Exhaust", "Unplayable"] }, { mana: 2, target: "AnyEnemy", powers: ["Strength", "Dexterity"], keywords: ["Exhaust", "Unplayable"] });
  const baseCard = card("base", { mana: 2, target: "AnyEnemy", powers: ["Strength", "Dexterity"], keywords: ["Exhaust", "Unplayable"] }, { mana: 3, target: "Self", powers: [], keywords: [] });
  const upgradeCard = card("upgrade", { mana: 3, target: "Self", powers: [], keywords: [] }, { mana: 2, target: "AnyEnemy", powers: ["Strength", "Dexterity"], keywords: ["Exhaust", "Unplayable"] });
  const hiddenCard = card("hidden", { mana: 3, target: "Self", powers: [], keywords: [] }, { mana: 4, target: "Self", powers: [], keywords: [] });

  function activeFilter() {
    const filter = createDefaultPracticeFilter();
    filter.target = { disabled: false, selected: ["Self", "AnyEnemy"] };
    filter.powers = { disabled: false, selected: ["Strength", "Dexterity"] };
    filter.keywords = { disabled: false, selected: ["Exhaust", "Unplayable"] };
    return filter;
  }

  it("reports which complete card form matches scalar and set groups", () => {
    const filter = activeFilter();
    expect(classifyPracticeCandidate(bothCard, filter)).toBe("both");
    expect(classifyPracticeCandidate(baseCard, filter)).toBe("base-only");
    expect(classifyPracticeCandidate(upgradeCard, filter)).toBe("upgrade-only");
    expect(classifyPracticeCandidate(hiddenCard, filter)).toBeNull();
  });

  it("uses OR within scalar groups and AND across enabled groups", () => {
    const filter = createDefaultPracticeFilter();
    filter.mana = { disabled: false, selected: [2, 3] };
    filter.rarity = { disabled: false, selected: ["Rare"] };

    expect(classifyPracticeCandidate(card("either-mana", { mana: 2, rarity: "Rare" }, { mana: 3, rarity: "Rare" }), filter)).toBe("both");
    expect(classifyPracticeCandidate(card("wrong-rarity", { mana: 2, rarity: "Basic" }, { mana: 3, rarity: "Basic" }), filter)).toBeNull();
  });

  it("requires every selected power and keyword on the same form", () => {
    const filter = createDefaultPracticeFilter();
    filter.powers = { disabled: false, selected: ["Strength", "Dexterity"] };
    filter.keywords = { disabled: false, selected: ["Exhaust", "Unplayable"] };

    expect(classifyPracticeCandidate(
      card("all-sets", { powers: ["Strength", "Dexterity"], keywords: ["Exhaust", "Unplayable"] }, { powers: ["Strength", "Dexterity"], keywords: ["Exhaust", "Unplayable"] }),
      filter,
    )).toBe("both");
    expect(classifyPracticeCandidate(card("split-sets", { powers: ["Strength", "Dexterity"], keywords: ["Exhaust"] }), filter)).toBeNull();
  });

  it("matches each None sentinel only when a complete form has an empty corresponding set", () => {
    const powersNone = createDefaultPracticeFilter();
    powersNone.powers = { disabled: false, selected: [POWER_FILTER_NONE] };
    expect(classifyPracticeCandidate(card("power-free"), powersNone)).toBe("both");
    expect(classifyPracticeCandidate(card("gains-power", {}, { powers: ["Strength"] }), powersNone)).toBe("base-only");
    expect(classifyPracticeCandidate(card("has-power", { powers: ["Strength"] }, { powers: ["Strength"] }), powersNone)).toBeNull();

    const keywordsNone = createDefaultPracticeFilter();
    keywordsNone.keywords = { disabled: false, selected: [KEYWORD_FILTER_NONE] };
    expect(classifyPracticeCandidate(card("keyword-free"), keywordsNone)).toBe("both");
    expect(classifyPracticeCandidate(card("gains-keyword", {}, { keywords: ["Innate"] }), keywordsNone)).toBe("base-only");
    expect(classifyPracticeCandidate(card("has-keyword", { keywords: ["Innate"] }, { keywords: ["Innate"] }), keywordsNone)).toBeNull();
  });

  it("treats disabled groups as passing and enabled empty groups as failing", () => {
    const disabled = createDefaultPracticeFilter();
    expect(classifyPracticeCandidate(hiddenCard, disabled)).toBe("both");

    const empty = createDefaultPracticeFilter();
    empty.target = { disabled: false, selected: [] };
    expect(classifyPracticeCandidate(hiddenCard, empty)).toBeNull();

    const emptyPowers = createDefaultPracticeFilter();
    emptyPowers.powers = { disabled: false, selected: [] };
    expect(classifyPracticeCandidate(hiddenCard, emptyPowers)).toBeNull();
  });

  it("does not combine matching values from different forms", () => {
    const filter = createDefaultPracticeFilter();
    filter.target = { disabled: false, selected: ["AnyEnemy"] };
    filter.keywords = { disabled: false, selected: ["Retain"] };

    expect(classifyPracticeCandidate(card("split", { target: "AnyEnemy", keywords: [] }, { target: "Self", keywords: ["Retain"] }), filter)).toBeNull();
  });
});

describe("practice filter immutable updates", () => {
  it("updates group disabled state without mutating selections", () => {
    const filter = createDefaultPracticeFilter();
    filter.powers.selected = ["Strength"];

    const updated = updatePracticeFilterGroupDisabled(filter, "powers", false);
    expect(updated).toEqual({ ...filter, powers: { disabled: false, selected: ["Strength"] } });
    expect(updated).not.toBe(filter);
    expect(updated.powers).not.toBe(filter.powers);
    expect(filter.powers).toEqual({ disabled: true, selected: ["Strength"] });
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

  it("keeps group-specific None values mutually exclusive without clearing the other group", () => {
    const filter = createDefaultPracticeFilter();
    filter.powers = { disabled: false, selected: ["Strength"] };
    filter.keywords = { disabled: false, selected: ["Retain"] };

    const noPowers = updatePracticeFilterGroupValue(filter, "powers", POWER_FILTER_NONE, true);
    const noKeywords = updatePracticeFilterGroupValue(noPowers, "keywords", KEYWORD_FILTER_NONE, true);
    const strength = updatePracticeFilterGroupValue(noKeywords, "powers", "Strength", true);

    expect(noPowers.powers.selected).toEqual([POWER_FILTER_NONE]);
    expect(noPowers.keywords.selected).toEqual(["Retain"]);
    expect(noKeywords.keywords.selected).toEqual([KEYWORD_FILTER_NONE]);
    expect(strength.powers.selected).toEqual(["Strength"]);
    expect(strength.keywords.selected).toEqual([KEYWORD_FILTER_NONE]);
    expect(filter.powers.selected).toEqual(["Strength"]);
  });

  it("ignores values that do not belong to the target group", () => {
    const filter = createDefaultPracticeFilter();
    expect(updatePracticeFilterGroupValue(filter, "powers", "Rare", true)).toBe(filter);
  });
});
