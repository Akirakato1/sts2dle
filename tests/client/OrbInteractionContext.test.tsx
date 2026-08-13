// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  OrbInteractionProvider,
  useOrbInteraction,
  type OrbTargetDescriptor,
  type OrbUseResult,
} from "../../src/client/components/OrbInteractionContext.js";
import { OrbTray } from "../../src/client/components/OrbTray.js";
import type { AssistanceState } from "../../src/client/game/assistance.js";

const assistance: AssistanceState = {
  reveal: null,
  filter: null,
  negation: null,
  visibility: { neutral: true, green: true, red: true },
};

const headerDescriptor: OrbTargetDescriptor = { kind: "header", feature: "mana" };
const greenDescriptor: OrbTargetDescriptor = {
  kind: "tile",
  guessIndex: 0,
  cardId: "green-card",
  feature: "mana",
  color: "green",
  revealed: true,
};
const redDescriptor: OrbTargetDescriptor = {
  kind: "tile",
  guessIndex: 1,
  cardId: "red-card",
  feature: "rarity",
  color: "red",
  revealed: true,
};
const yellowDescriptor: OrbTargetDescriptor = {
  kind: "tile",
  guessIndex: 2,
  cardId: "yellow-card",
  feature: "mana",
  color: "yellow",
  revealed: true,
};

interface HarnessProps {
  disabled?: boolean;
  roundKey?: string;
  onUse: (orb: "reveal" | "filter" | "negation", target: OrbTargetDescriptor) => OrbUseResult;
  hitTest?: (x: number, y: number) => readonly Element[];
}

function Target({
  descriptor,
  validFor,
  label,
  testId,
}: {
  descriptor: OrbTargetDescriptor;
  validFor: readonly ("reveal" | "filter" | "negation")[];
  label: string;
  testId: string;
}) {
  const { bindTarget } = useOrbInteraction();
  const binding = bindTarget(descriptor, validFor, label);
  return <div
    {...binding.targetProps}
    className={`harness-target${binding.active ? " harness-target--active" : ""}${binding.valid ? " harness-target--valid" : ""}`}
    data-testid={testId}
  >{label}</div>;
}

function InteractionSurface({ assistanceState = assistance }: { assistanceState?: AssistanceState }) {
  const { draggingOrb, poof, selectedOrb } = useOrbInteraction();
  return <>
    <OrbTray assistance={assistanceState} disabled={false} />
    <Target descriptor={headerDescriptor} validFor={["reveal"]} label="Mana header" testId="header" />
    <Target descriptor={greenDescriptor} validFor={["filter"]} label="Green mana tile" testId="green" />
    <Target descriptor={redDescriptor} validFor={["negation"]} label="Red rarity tile" testId="red" />
    <Target descriptor={yellowDescriptor} validFor={[]} label="Yellow mana tile" testId="yellow" />
    <div data-testid="empty">Empty space</div>
    <div data-testid="interaction-state">{selectedOrb ?? "none"}|{draggingOrb ?? "none"}</div>
    {poof && <div data-testid="poof-state">{poof.orb}|{poof.x}|{poof.y}|{poof.id}</div>}
  </>;
}

function SettleOnLayout({
  element,
  enabled,
  event,
  pointerId = 0,
}: {
  element: HTMLElement | null;
  enabled: boolean;
  event: "click" | "pointerup" | "pointerup-click";
  pointerId?: number;
}) {
  useLayoutEffect(() => {
    if (!enabled || !element) return;
    if (event === "click") {
      element.click();
      return;
    }
    element.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      clientX: 80,
      clientY: 80,
      pointerId,
    }));
    if (event === "pointerup-click") element.click();
  }, [element, enabled, event, pointerId]);
  return null;
}

function defaultHitTest(x: number) {
  const testId = x === 80 ? "green" : x === 90 ? "yellow" : x === 100 ? "header" : x === 110 ? "red" : "empty";
  const element = screen.queryByTestId(testId);
  return element ? [element] : [];
}

function renderHarness({
  disabled = false,
  roundKey = "round-one",
  onUse,
  hitTest = defaultHitTest,
}: HarnessProps) {
  return render(<OrbInteractionProvider
    assistance={assistance}
    disabled={disabled}
    hitTest={hitTest}
    onUse={onUse}
    roundKey={roundKey}
  >
    <InteractionSurface />
  </OrbInteractionProvider>);
}

function accepted(announcement = "Orb consumed.") {
  return vi.fn(() => ({ accepted: true, announcement }));
}

function dragAvatar() {
  return document.querySelector<HTMLElement>(".orb-drag-avatar");
}

beforeEach(() => {
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).setPointerCapture;
  delete (HTMLElement.prototype as Partial<HTMLElement>).releasePointerCapture;
});

describe("OrbInteractionProvider", () => {
  test("selects a Reveal orb and consumes it once from a valid clicked header", () => {
    vi.useFakeTimers();
    const onUse = accepted("Mana revealed.");
    renderHarness({ onUse });

    fireEvent.click(screen.getByRole("button", { name: "Reveal Orb, available" }));
    expect(screen.getByRole("button", { name: "Reveal Orb, available" })).toHaveAttribute("aria-pressed", "true");

    const header = screen.getByTestId("header");
    expect(header).toHaveAttribute("role", "button");
    expect(header).toHaveClass("harness-target--active", "harness-target--valid");
    fireEvent.click(header);

    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledWith("reveal", headerDescriptor);
    expect(screen.getByTestId("interaction-state")).toHaveTextContent("none|none");
    expect(screen.getAllByTestId("poof-state")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Mana revealed.");

    act(() => vi.runAllTimers());
    expect(screen.queryByTestId("poof-state")).not.toBeInTheDocument();
  });

  test("promotes at six pixels, empties the slot, follows the pointer, and drops on registered metadata", () => {
    const onUse = accepted("Filter rule activated.");
    renderHarness({ onUse });
    const filter = screen.getByRole("button", { name: "Filter Orb, available" });

    fireEvent.pointerDown(filter, { pointerId: 4, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(filter, { pointerId: 4, clientX: 15, clientY: 10 });
    expect(dragAvatar()).not.toBeInTheDocument();
    fireEvent.pointerMove(filter, { pointerId: 4, clientX: 16, clientY: 10 });

    expect(screen.getByTestId("interaction-state")).toHaveTextContent("none|filter");
    expect(filter).toBeInTheDocument();
    expect(filter).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button", { name: "Filter Orb, available" })).not.toBeInTheDocument();
    const avatar = dragAvatar();
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveStyle({ left: "16px", top: "10px", position: "fixed" });

    fireEvent.pointerMove(filter, { pointerId: 4, clientX: 80, clientY: 80 });
    expect(screen.getByTestId("green")).toHaveClass("harness-target--active", "harness-target--valid");
    fireEvent.pointerUp(filter, { pointerId: 4, clientX: 80, clientY: 80 });

    expect(onUse).toHaveBeenCalledTimes(1);
    expect(onUse).toHaveBeenCalledWith("filter", greenDescriptor);
    expect(screen.getByRole("button", { name: "Filter Orb, available" })).toBeInTheDocument();
    expect(dragAvatar()).not.toBeInTheDocument();
  });

  test("treats pointer-up below the drag threshold as one select/cancel activation", () => {
    const onUse = accepted();
    renderHarness({ onUse });
    const filter = screen.getByRole("button", { name: "Filter Orb, available" });

    fireEvent.pointerDown(filter, { pointerId: 5, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(filter, { pointerId: 5, clientX: 13, clientY: 14 });
    fireEvent.pointerUp(filter, { pointerId: 5, clientX: 13, clientY: 14 });
    fireEvent.click(filter);

    expect(onUse).not.toHaveBeenCalled();
    expect(screen.getByTestId("interaction-state")).toHaveTextContent("filter|none");
    expect(filter).toHaveAttribute("aria-pressed", "true");
  });

  test("suppresses the compatibility click after an invalid drag returns the selected orb", () => {
    const onUse = accepted();
    renderHarness({ onUse });
    const filter = screen.getByRole("button", { name: "Filter Orb, available" });
    fireEvent.click(filter);

    fireEvent.pointerDown(filter, { pointerId: 6, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(filter, { pointerId: 6, clientX: 30, clientY: 30 });
    fireEvent.pointerUp(filter, { pointerId: 6, clientX: 90, clientY: 30 });
    fireEvent.click(filter);

    expect(onUse).not.toHaveBeenCalled();
    expect(filter).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Yellow mana tile is an invalid target for the Filter Orb. Orb returned.",
    );
  });

  test.each([
    ["empty release", "pointerUp", 30],
    ["invalid release", "pointerUp", 90],
    ["pointer cancellation", "pointerCancel", 30],
    ["capture loss", "lostPointerCapture", 30],
  ] as const)("returns an unconsumed orb after %s", (_label, exitEvent, x) => {
    const onUse = accepted();
    renderHarness({ onUse });
    const negation = screen.getByRole("button", { name: "Negation Orb, available" });

    fireEvent.pointerDown(negation, { pointerId: 8, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(negation, { pointerId: 8, clientX: 30, clientY: 30 });
    fireEvent[exitEvent](negation, { pointerId: 8, clientX: x, clientY: 30 });

    expect(onUse).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Negation Orb, available" })).toBeInTheDocument();
    expect(dragAvatar()).not.toBeInTheDocument();
    expect(screen.getByRole("status")).not.toBeEmptyDOMElement();
  });

  test("Escape cancels a drag and restores the orb", () => {
    const onUse = accepted();
    renderHarness({ onUse });
    const reveal = screen.getByRole("button", { name: "Reveal Orb, available" });
    fireEvent.pointerDown(reveal, { pointerId: 9, clientX: 1, clientY: 1 });
    fireEvent.pointerMove(reveal, { pointerId: 9, clientX: 20, clientY: 20 });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onUse).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reveal Orb, available" })).toBeInTheDocument();
    expect(dragAvatar()).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/canceled/i);
  });

  test("keeps a selected orb after invalid click or rejected semantic use", () => {
    const onUse = vi.fn(() => ({ accepted: false, announcement: "That green tile is not ready." }));
    renderHarness({ onUse });
    const filter = screen.getByRole("button", { name: "Filter Orb, available" });
    fireEvent.click(filter);

    fireEvent.click(screen.getByTestId("yellow"));
    expect(onUse).not.toHaveBeenCalled();
    expect(filter).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent(/invalid target/i);

    fireEvent.click(screen.getByTestId("green"));
    expect(onUse).toHaveBeenCalledOnce();
    expect(filter).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("poof-state")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("That green tile is not ready.");
  });

  test("activating the selected orb cancels it and announces cancellation", () => {
    renderHarness({ onUse: accepted() });
    const reveal = screen.getByRole("button", { name: "Reveal Orb, available" });
    fireEvent.click(reveal);
    fireEvent.click(reveal);

    expect(reveal).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("status")).toHaveTextContent(/selection canceled/i);
  });

  test("guards a completed drag against duplicate pointer-up settlement", () => {
    const onUse = accepted();
    renderHarness({ onUse });
    const filter = screen.getByRole("button", { name: "Filter Orb, available" });
    fireEvent.pointerDown(filter, { pointerId: 11, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(filter, { pointerId: 11, clientX: 30, clientY: 30 });

    fireEvent.pointerUp(filter, { pointerId: 11, clientX: 80, clientY: 80 });
    fireEvent.pointerUp(filter, { pointerId: 11, clientX: 80, clientY: 80 });

    expect(onUse).toHaveBeenCalledTimes(1);
  });

  test.each(["Enter", " "])("consumes a selected orb with the %j key on a valid target", (key) => {
    const onUse = accepted("Negation rule activated.");
    renderHarness({ onUse });
    fireEvent.click(screen.getByRole("button", { name: "Negation Orb, available" }));

    fireEvent.keyDown(screen.getByTestId("red"), { key });

    expect(onUse).toHaveBeenCalledWith("negation", redDescriptor);
    expect(screen.getByTestId("interaction-state")).toHaveTextContent("none|none");
  });

  test("uses opaque target IDs rather than serialized descriptors", () => {
    renderHarness({ onUse: accepted() });
    const id = screen.getByTestId("green").getAttribute("data-orb-target");

    expect(id).toMatch(/^orb-target-\d+$/);
    expect(id).not.toContain("green-card");
  });

  test("clears selection, drag, and poof when the round key changes", () => {
    vi.useFakeTimers();
    const onUse = accepted();
    const view = renderHarness({ onUse, roundKey: "round-one" });
    fireEvent.click(screen.getByRole("button", { name: "Reveal Orb, available" }));
    fireEvent.click(screen.getByTestId("header"));
    expect(screen.getByTestId("poof-state")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Filter Orb, available" }), {
      pointerId: 12, clientX: 10, clientY: 10,
    });
    fireEvent.pointerMove(screen.getByRole("button", { name: "Filter Orb, available" }), {
      pointerId: 12, clientX: 30, clientY: 30,
    });
    view.rerender(<OrbInteractionProvider
      assistance={assistance}
      disabled={false}
      hitTest={defaultHitTest}
      onUse={onUse}
      roundKey="round-two"
    ><InteractionSurface /></OrbInteractionProvider>);

    expect(screen.getByTestId("interaction-state")).toHaveTextContent("none|none");
    expect(screen.queryByTestId("poof-state")).not.toBeInTheDocument();
    expect(dragAvatar()).not.toBeInTheDocument();
  });

  test("rejects a drag settlement from the prior round during the new commit layout phase", () => {
    const oldOnUse = accepted("Old round consumed.");
    const newOnUse = accepted("New round consumed.");
    const view = render(<OrbInteractionProvider
      assistance={assistance}
      disabled={false}
      hitTest={defaultHitTest}
      onUse={oldOnUse}
      roundKey="round-one"
    >
      <InteractionSurface />
      <SettleOnLayout element={null} enabled={false} event="pointerup" pointerId={21} />
    </OrbInteractionProvider>);
    const filter = screen.getByRole("button", { name: "Filter Orb, available" });
    fireEvent.pointerDown(filter, { pointerId: 21, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(filter, { pointerId: 21, clientX: 30, clientY: 30 });

    view.rerender(<OrbInteractionProvider
      assistance={assistance}
      disabled={false}
      hitTest={defaultHitTest}
      onUse={newOnUse}
      roundKey="round-two"
    >
      <InteractionSurface />
      <SettleOnLayout element={filter} enabled event="pointerup" pointerId={21} />
    </OrbInteractionProvider>);

    expect(oldOnUse).not.toHaveBeenCalled();
    expect(newOnUse).not.toHaveBeenCalled();
    expect(screen.getByTestId("interaction-state")).toHaveTextContent("none|none");
    expect(screen.getByRole("button", { name: "Filter Orb, available" })).toHaveAttribute("aria-pressed", "false");
  });

  test("suppresses the compatibility click from a prior-round pointer gesture", () => {
    const oldOnUse = accepted("Old round consumed.");
    const newOnUse = accepted("New round consumed.");
    const view = render(<OrbInteractionProvider
      assistance={assistance}
      disabled={false}
      hitTest={defaultHitTest}
      onUse={oldOnUse}
      roundKey="round-one"
    >
      <InteractionSurface />
      <SettleOnLayout element={null} enabled={false} event="pointerup" pointerId={23} />
    </OrbInteractionProvider>);
    const filter = screen.getByRole("button", { name: "Filter Orb, available" });
    fireEvent.pointerDown(filter, { pointerId: 23, clientX: 10, clientY: 10 });

    view.rerender(<OrbInteractionProvider
      assistance={assistance}
      disabled={false}
      hitTest={defaultHitTest}
      onUse={newOnUse}
      roundKey="round-two"
    >
      <InteractionSurface />
      <SettleOnLayout element={filter} enabled event="pointerup-click" pointerId={23} />
    </OrbInteractionProvider>);

    expect(oldOnUse).not.toHaveBeenCalled();
    expect(newOnUse).not.toHaveBeenCalled();
    expect(screen.getByTestId("interaction-state")).toHaveTextContent("none|none");
    expect(filter).toHaveAttribute("aria-pressed", "false");
  });

  test("rejects selected-target activation from the prior round during the new commit layout phase", () => {
    const oldOnUse = accepted("Old round consumed.");
    const newOnUse = accepted("New round consumed.");
    const view = render(<OrbInteractionProvider
      assistance={assistance}
      disabled={false}
      hitTest={defaultHitTest}
      onUse={oldOnUse}
      roundKey="round-one"
    >
      <InteractionSurface />
      <SettleOnLayout element={null} enabled={false} event="click" />
    </OrbInteractionProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Filter Orb, available" }));
    const target = screen.getByTestId("green");

    view.rerender(<OrbInteractionProvider
      assistance={assistance}
      disabled={false}
      hitTest={defaultHitTest}
      onUse={newOnUse}
      roundKey="round-two"
    >
      <InteractionSurface />
      <SettleOnLayout element={target} enabled event="click" />
    </OrbInteractionProvider>);

    expect(oldOnUse).not.toHaveBeenCalled();
    expect(newOnUse).not.toHaveBeenCalled();
    expect(screen.getByTestId("interaction-state")).toHaveTextContent("none|none");
    expect(screen.getByRole("button", { name: "Filter Orb, available" })).toHaveAttribute("aria-pressed", "false");
  });

  test("rejects an old drag settlement when assistance consumes that orb during commit", () => {
    const oldOnUse = accepted("Old assistance consumed.");
    const newOnUse = accepted("New assistance consumed.");
    const consumedAssistance: AssistanceState = {
      ...assistance,
      filter: { guessIndex: 0, cardId: "green-card", feature: "mana" },
    };
    const view = render(<OrbInteractionProvider
      assistance={assistance}
      disabled={false}
      hitTest={defaultHitTest}
      onUse={oldOnUse}
      roundKey="round-one"
    >
      <InteractionSurface />
      <SettleOnLayout element={null} enabled={false} event="pointerup" pointerId={22} />
    </OrbInteractionProvider>);
    const filter = screen.getByRole("button", { name: "Filter Orb, available" });
    fireEvent.pointerDown(filter, { pointerId: 22, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(filter, { pointerId: 22, clientX: 30, clientY: 30 });

    view.rerender(<OrbInteractionProvider
      assistance={consumedAssistance}
      disabled={false}
      hitTest={defaultHitTest}
      onUse={newOnUse}
      roundKey="round-one"
    >
      <InteractionSurface assistanceState={consumedAssistance} />
      <SettleOnLayout element={filter} enabled event="pointerup" pointerId={22} />
    </OrbInteractionProvider>);

    expect(oldOnUse).not.toHaveBeenCalled();
    expect(newOnUse).not.toHaveBeenCalled();
    expect(screen.getByTestId("interaction-state")).toHaveTextContent("none|none");
  });

  test("rejects an old drag settlement when controls become disabled during commit", () => {
    const oldOnUse = accepted("Old controls consumed.");
    const newOnUse = accepted("Disabled controls consumed.");
    const view = render(<OrbInteractionProvider
      assistance={assistance}
      disabled={false}
      hitTest={defaultHitTest}
      onUse={oldOnUse}
      roundKey="round-one"
    >
      <InteractionSurface />
      <SettleOnLayout element={null} enabled={false} event="pointerup" pointerId={24} />
    </OrbInteractionProvider>);
    const filter = screen.getByRole("button", { name: "Filter Orb, available" });
    fireEvent.pointerDown(filter, { pointerId: 24, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(filter, { pointerId: 24, clientX: 30, clientY: 30 });

    view.rerender(<OrbInteractionProvider
      assistance={assistance}
      disabled
      hitTest={defaultHitTest}
      onUse={newOnUse}
      roundKey="round-one"
    >
      <InteractionSurface />
      <SettleOnLayout element={filter} enabled event="pointerup" pointerId={24} />
    </OrbInteractionProvider>);

    expect(oldOnUse).not.toHaveBeenCalled();
    expect(newOnUse).not.toHaveBeenCalled();
    expect(screen.getByTestId("interaction-state")).toHaveTextContent("none|none");
  });

  test("cancels pending interaction when disabled and releases capture on unmount", () => {
    const release = HTMLElement.prototype.releasePointerCapture as ReturnType<typeof vi.fn>;
    const onUse = accepted();
    const view = renderHarness({ onUse });
    const filter = screen.getByRole("button", { name: "Filter Orb, available" });
    fireEvent.pointerDown(filter, { pointerId: 14, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(filter, { pointerId: 14, clientX: 30, clientY: 30 });

    view.rerender(<OrbInteractionProvider
      assistance={assistance}
      disabled
      hitTest={defaultHitTest}
      onUse={onUse}
      roundKey="round-one"
    ><InteractionSurface /></OrbInteractionProvider>);
    expect(screen.getByTestId("interaction-state")).toHaveTextContent("none|none");
    expect(dragAvatar()).not.toBeInTheDocument();
    expect(release).toHaveBeenCalledWith(14);

    view.unmount();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onUse).not.toHaveBeenCalled();
  });

  test("rebuilds opaque target registrations after a disabled boundary", () => {
    const onUse = accepted();
    const view = renderHarness({ onUse });
    const firstId = screen.getByTestId("green").getAttribute("data-orb-target");

    view.rerender(<OrbInteractionProvider
      assistance={assistance}
      disabled
      hitTest={defaultHitTest}
      onUse={onUse}
      roundKey="round-one"
    ><InteractionSurface /></OrbInteractionProvider>);
    view.rerender(<OrbInteractionProvider
      assistance={assistance}
      disabled={false}
      hitTest={defaultHitTest}
      onUse={onUse}
      roundKey="round-one"
    ><InteractionSurface /></OrbInteractionProvider>);

    expect(screen.getByTestId("green")).not.toHaveAttribute("data-orb-target", firstId);
  });
});
