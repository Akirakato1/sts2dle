// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  FILTER_HELP_DISMISSED_KEY,
  PracticeFilterPanel,
} from "../../src/client/components/PracticeFilterPanel.js";
import {
  createDefaultPracticeFilter,
  type PracticeFilterOptions,
  type PracticeFilterState,
} from "../../src/client/game/practice-filter.js";

const nativeLocalStorage = window.localStorage;

function freshLocalStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(String(key), String(value)); },
  };
}

const OPTIONS: PracticeFilterOptions = {
  cardClass: ["Ironclad", "Silent"],
  cardType: ["Attack", "Skill"],
  mana: [0, 1, "X", "None"],
  rarity: ["Common", "Rare"],
  keywords: ["ethereal", "innate", "none"],
};

function enabledState(): PracticeFilterState {
  const state = createDefaultPracticeFilter();
  return {
    ...state,
    enabled: true,
    cardClass: { disabled: false, selected: ["Ironclad", "Silent"] },
    cardType: { disabled: true, selected: ["Attack"] },
    mana: { disabled: false, selected: [0, "None"] },
    rarity: { disabled: false, selected: [] },
    keywords: { disabled: false, selected: ["ethereal", "innate"] },
  };
}

function renderPanel(
  state = enabledState(),
  props: Partial<React.ComponentProps<typeof PracticeFilterPanel>> = {},
) {
  const onGroupDisabledChange = vi.fn();
  const onValueChange = vi.fn();
  const result = render(<PracticeFilterPanel
    state={state}
    options={OPTIONS}
    disabled={false}
    onGroupDisabledChange={onGroupDisabledChange}
    onValueChange={onValueChange}
    {...props}
  />);
  return { ...result, onGroupDisabledChange, onValueChange };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { configurable: true, value: freshLocalStorage() });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "localStorage", { configurable: true, value: nativeLocalStorage });
});

describe("PracticeFilterPanel checklists", () => {
  test("renders five accessible groups in order with Disable first", () => {
    window.localStorage.setItem(FILTER_HELP_DISMISSED_KEY, "1");
    renderPanel();

    const groups = screen.getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Class", "Type", "Mana", "Rarity", "Keywords",
    ]);
    for (const group of groups) {
      expect(within(group).getAllByRole("checkbox")[0]).toHaveAccessibleName("Disable");
    }
    expect(within(groups[2]!).getAllByRole("checkbox").map((input) => input.getAttribute("aria-label")))
      .toEqual(["Disable", "0", "1", "X", "None"]);
    expect(within(groups[4]!).getAllByRole("checkbox").map((input) => input.getAttribute("aria-label")))
      .toEqual(["Disable", "Ethereal", "Innate", "None"]);
  });

  test("retains selections while disabled and only disables value controls", () => {
    window.localStorage.setItem(FILTER_HELP_DISMISSED_KEY, "1");
    renderPanel();

    const typeGroup = screen.getByRole("group", { name: "Type" });
    expect(within(typeGroup).getByRole("checkbox", { name: "Disable" })).toBeChecked();
    expect(within(typeGroup).getByRole("checkbox", { name: "Disable" })).toBeEnabled();
    expect(within(typeGroup).getByRole("checkbox", { name: "Attack" })).toBeChecked();
    expect(within(typeGroup).getByRole("checkbox", { name: "Attack" })).toBeDisabled();
    expect(typeGroup.querySelector(".practice-filter__values")).toHaveClass("practice-filter__values--disabled");
    expect(within(typeGroup).queryByText("Choose at least one.")).not.toBeInTheDocument();
  });

  test("dispatches group-specific disable and multi-value changes", () => {
    window.localStorage.setItem(FILTER_HELP_DISMISSED_KEY, "1");
    const { onGroupDisabledChange, onValueChange } = renderPanel();

    fireEvent.click(within(screen.getByRole("group", { name: "Class" })).getByRole("checkbox", { name: "Disable" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Class" })).getByRole("checkbox", { name: "Ironclad" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Keywords" })).getByRole("checkbox", { name: "Innate" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Keywords" })).getByRole("checkbox", { name: "None" }));

    expect(onGroupDisabledChange).toHaveBeenCalledWith("cardClass", true);
    expect(onValueChange).toHaveBeenNthCalledWith(1, "cardClass", "Ironclad", false);
    expect(onValueChange).toHaveBeenNthCalledWith(2, "keywords", "innate", false);
    expect(onValueChange).toHaveBeenNthCalledWith(3, "keywords", "none", true);
  });

  test("warns when an enabled group has no selected values", () => {
    window.localStorage.setItem(FILTER_HELP_DISMISSED_KEY, "1");
    renderPanel();

    expect(within(screen.getByRole("group", { name: "Rarity" })).getByText("Choose at least one.")).toBeVisible();
    expect(within(screen.getByRole("group", { name: "Type" })).queryByText("Choose at least one.")).not.toBeInTheDocument();
  });

  test("the panel disabled prop prevents every mutation without hiding state", () => {
    window.localStorage.setItem(FILTER_HELP_DISMISSED_KEY, "1");
    const { onGroupDisabledChange, onValueChange } = renderPanel(enabledState(), { disabled: true });

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).not.toHaveLength(0);
    for (const checkbox of checkboxes) expect(checkbox).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Ironclad" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Ironclad" }));
    expect(onGroupDisabledChange).not.toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();
  });
});

describe("PracticeFilterPanel help", () => {
  test("auto-opens once and explains every filter matching rule", () => {
    const { unmount } = renderPanel();
    const dialog = screen.getByRole("dialog", { name: "Filter help" });

    expect(dialog).toHaveTextContent("Disable accepts any value for that group");
    expect(dialog).toHaveTextContent("An enabled group with nothing checked matches no cards");
    expect(dialog).toHaveTextContent("Class, Type, Mana, and Rarity use OR within each group");
    expect(dialog).toHaveTextContent("Keywords use AND");
    expect(dialog).toHaveTextContent("None means that form has no keywords and clears keyword choices");
    expect(dialog).toHaveTextContent("Enabled groups combine with AND");
    expect(dialog).toHaveTextContent("Base and upgraded forms are evaluated separately");

    fireEvent.click(screen.getByRole("button", { name: "Close filter help" }));
    expect(window.localStorage).toHaveLength(1);
    expect(window.localStorage.getItem(FILTER_HELP_DISMISSED_KEY)).toBe("1");
    unmount();

    renderPanel();
    expect(screen.queryByRole("dialog", { name: "Filter help" })).not.toBeInTheDocument();
  });

  test("the question-mark trigger always reopens help and receives returned focus", async () => {
    window.localStorage.setItem(FILTER_HELP_DISMISSED_KEY, "1");
    renderPanel();
    const trigger = screen.getByRole("button", { name: "Filter help" });

    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "Close filter help" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Close filter help" }));

    expect(screen.queryByRole("dialog", { name: "Filter help" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  test("traps forward and reverse Tab and closes with Escape", async () => {
    renderPanel();
    const close = screen.getByRole("button", { name: "Close filter help" });
    expect(close).toHaveFocus();

    const forward = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" });
    document.dispatchEvent(forward);
    expect(forward.defaultPrevented).toBe(true);
    expect(close).toHaveFocus();

    const reverse = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab", shiftKey: true });
    document.dispatchEvent(reverse);
    expect(reverse.defaultPrevented).toBe(true);
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Filter help" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Filter help" })).toHaveFocus());
  });

  test("closes only when the true backdrop is clicked", () => {
    const view = renderPanel();
    fireEvent.click(screen.getByRole("dialog", { name: "Filter help" }));
    expect(screen.getByRole("dialog", { name: "Filter help" })).toBeVisible();

    fireEvent.click(view.container.querySelector(".practice-filter-help__backdrop")!);
    expect(screen.queryByRole("dialog", { name: "Filter help" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(FILTER_HELP_DISMISSED_KEY)).toBe("1");
  });
});
