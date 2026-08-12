import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type ReactNode,
} from "react";

import type { FeatureName } from "../../shared/domain.js";
import type { TileColor } from "../../shared/comparison.js";
import type { AssistanceState, OrbKind } from "../game/assistance.js";
import { ORB_LABELS, OrbVisual } from "./OrbVisual.js";

export type OrbTargetDescriptor =
  | { kind: "header"; feature: FeatureName }
  | {
    kind: "tile";
    guessIndex: number;
    cardId: string;
    feature: FeatureName;
    color: TileColor;
    revealed: boolean;
  };

export interface OrbUseResult {
  accepted: boolean;
  announcement: string;
}

export interface OrbInteractionProviderProps {
  roundKey: string | number;
  assistance: AssistanceState | null;
  disabled: boolean;
  onUse(orb: OrbKind, target: OrbTargetDescriptor): OrbUseResult;
  hitTest?: (x: number, y: number) => readonly Element[];
  children: ReactNode;
}

export interface OrbTargetBinding {
  active: boolean;
  valid: boolean;
  selectedOrb: OrbKind | null;
  targetProps: {
    "data-orb-target": string;
    tabIndex?: number;
    role?: "button";
    "aria-label"?: string;
    onClick?: MouseEventHandler;
    onKeyDown?: KeyboardEventHandler;
  };
}

interface DragState {
  orb: OrbKind;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  dragging: boolean;
  settled: boolean;
}

interface TargetRegistration {
  id: string;
  descriptor: OrbTargetDescriptor;
  validFor: readonly OrbKind[];
  label: string;
}

interface PointerListeners {
  move: (event: PointerEvent) => void;
  up: (event: PointerEvent) => void;
  cancel: (event: PointerEvent) => void;
  lost: (event: PointerEvent) => void;
}

interface OrbInteractionValue {
  selectedOrb: OrbKind | null;
  draggingOrb: OrbKind | null;
  poof: { orb: OrbKind; x: number; y: number; id: number } | null;
  announcement: string;
  getOrbButtonProps(orb: OrbKind, available: boolean): ButtonHTMLAttributes<HTMLButtonElement>;
  bindTarget(target: OrbTargetDescriptor, validFor: readonly OrbKind[], label: string): OrbTargetBinding;
}

export const ORB_POOF_DURATION_MS = 520;
const DRAG_THRESHOLD_PX = 6;

const missingProvider = () => {
  throw new Error("useOrbInteraction must be used within OrbInteractionProvider");
};

const OrbInteractionContext = createContext<OrbInteractionValue>({
  selectedOrb: null,
  draggingOrb: null,
  poof: null,
  announcement: "",
  getOrbButtonProps: missingProvider,
  bindTarget: missingProvider,
});

function sameTarget(left: OrbTargetDescriptor, right: OrbTargetDescriptor) {
  if (left.kind !== right.kind || left.feature !== right.feature) return false;
  if (left.kind === "header" || right.kind === "header") return left.kind === right.kind;
  return left.guessIndex === right.guessIndex
    && left.cardId === right.cardId
    && left.color === right.color
    && left.revealed === right.revealed;
}

function particlesFor(orb: OrbKind) {
  if (orb === "reveal") {
    return <><i className="orb-vfx__glitter orb-vfx__glitter--one" /><i className="orb-vfx__glitter orb-vfx__glitter--two" /></>;
  }
  if (orb === "filter") {
    return <><i className="orb-vfx__ring" /><i className="orb-vfx__mote orb-vfx__mote--one" /><i className="orb-vfx__mote orb-vfx__mote--two" /></>;
  }
  return <><i className="orb-vfx__spark orb-vfx__spark--one" /><i className="orb-vfx__spark orb-vfx__spark--two" /><i className="orb-vfx__smoke" /></>;
}

export function OrbInteractionProvider({
  roundKey,
  assistance,
  disabled,
  onUse,
  hitTest,
  children,
}: OrbInteractionProviderProps) {
  const [selectedOrb, setSelectedOrbState] = useState<OrbKind | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [poof, setPoof] = useState<OrbInteractionValue["poof"]>(null);
  const [announcement, setAnnouncement] = useState("");

  const selectedOrbRef = useRef<OrbKind | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const selectionBeforePointerRef = useRef<OrbKind | null>(null);
  const captureElementRef = useRef<HTMLButtonElement | null>(null);
  const pointerListenersRef = useRef<PointerListeners | null>(null);
  const ignoreNextClickRef = useRef(false);
  const ignoreClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poofTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const poofIdRef = useRef(0);
  const targetIdRef = useRef(0);
  const targetsRef = useRef<TargetRegistration[]>([]);
  const registryRoundRef = useRef(roundKey);
  const onUseRef = useRef(onUse);
  const hitTestRef = useRef(hitTest);
  const disabledRef = useRef(disabled);
  const assistanceRef = useRef(assistance);
  const cancelFromEscapeRef = useRef<() => void>(() => undefined);

  onUseRef.current = onUse;
  hitTestRef.current = hitTest;
  disabledRef.current = disabled;
  assistanceRef.current = assistance;

  if (registryRoundRef.current !== roundKey) {
    registryRoundRef.current = roundKey;
    targetsRef.current = [];
  }

  const setSelectedOrb = (next: OrbKind | null) => {
    selectedOrbRef.current = next;
    setSelectedOrbState(next);
  };

  const setCurrentDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  };

  const clearPoof = () => {
    if (poofTimerRef.current !== null) {
      clearTimeout(poofTimerRef.current);
      poofTimerRef.current = null;
    }
    setPoof(null);
  };

  const detachPointerListeners = () => {
    const listeners = pointerListenersRef.current;
    if (!listeners) return;
    if (typeof document !== "undefined") {
      document.removeEventListener("pointermove", listeners.move);
      document.removeEventListener("pointerup", listeners.up);
      document.removeEventListener("pointercancel", listeners.cancel);
    }
    const element = captureElementRef.current;
    element?.removeEventListener("pointermove", listeners.move);
    element?.removeEventListener("pointerup", listeners.up);
    element?.removeEventListener("pointercancel", listeners.cancel);
    element?.removeEventListener("lostpointercapture", listeners.lost);
    pointerListenersRef.current = null;
  };

  const releaseCapture = (pointerId: number) => {
    const element = captureElementRef.current;
    captureElementRef.current = null;
    if (!element?.releasePointerCapture) return;
    try {
      element.releasePointerCapture(pointerId);
    } catch {
      // Capture may already have been released by the browser.
    }
  };

  const findTarget = (x: number, y: number) => {
    const elements = hitTestRef.current
      ? hitTestRef.current(x, y)
      : typeof document !== "undefined" && typeof document.elementsFromPoint === "function"
        ? document.elementsFromPoint(x, y)
        : [];

    for (const element of elements) {
      const targetElement = element.closest<HTMLElement>("[data-orb-target]");
      const id = targetElement?.dataset.orbTarget;
      if (!id) continue;
      const registration = targetsRef.current.find((candidate) => candidate.id === id);
      if (registration) return registration;
    }
    return null;
  };

  const targetPoint = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };

  const attemptUse = (orb: OrbKind, target: TargetRegistration, x: number, y: number) => {
    if (disabledRef.current || !assistanceRef.current) {
      setSelectedOrb(null);
      setAnnouncement(`${ORB_LABELS[orb]} Orb interaction is unavailable.`);
      return false;
    }
    if (!target.validFor.includes(orb)) {
      setSelectedOrb(orb);
      setAnnouncement(`${target.label} is an invalid target for the ${ORB_LABELS[orb]} Orb.`);
      return false;
    }

    const result = onUseRef.current(orb, target.descriptor);
    setAnnouncement(result.announcement);
    if (!result.accepted) {
      setSelectedOrb(orb);
      return false;
    }

    setSelectedOrb(null);
    clearPoof();
    const nextPoof = { orb, x, y, id: ++poofIdRef.current };
    setPoof(nextPoof);
    poofTimerRef.current = setTimeout(() => {
      poofTimerRef.current = null;
      setPoof((current) => current?.id === nextPoof.id ? null : current);
    }, ORB_POOF_DURATION_MS);
    return true;
  };

  const toggleSelection = (orb: OrbKind) => {
    if (disabledRef.current || !assistanceRef.current || assistanceRef.current[orb] !== null) return;
    const next = selectedOrbRef.current === orb ? null : orb;
    setSelectedOrb(next);
    setAnnouncement(next
      ? `${ORB_LABELS[orb]} Orb selected. Choose a target.`
      : `${ORB_LABELS[orb]} Orb selection canceled.`);
  };

  const settleDrag = (
    pointerId: number,
    reason: "up" | "cancel" | "lost" | "escape",
    x?: number,
    y?: number,
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId || drag.settled) return;
    drag.settled = true;
    detachPointerListeners();
    releaseCapture(pointerId);
    setCurrentDrag(null);

    if (reason === "up" && !drag.dragging) {
      ignoreNextClickRef.current = true;
      if (ignoreClickTimerRef.current !== null) clearTimeout(ignoreClickTimerRef.current);
      ignoreClickTimerRef.current = setTimeout(() => {
        ignoreNextClickRef.current = false;
        ignoreClickTimerRef.current = null;
      }, 0);
      toggleSelection(drag.orb);
      return;
    }

    if (reason === "up" && x !== undefined && y !== undefined) {
      const target = findTarget(x, y);
      if (target && target.validFor.includes(drag.orb)) {
        attemptUse(drag.orb, target, x, y);
        return;
      }
      setSelectedOrb(selectionBeforePointerRef.current);
      setAnnouncement(target
        ? `${target.label} is an invalid target for the ${ORB_LABELS[drag.orb]} Orb. Orb returned.`
        : `${ORB_LABELS[drag.orb]} Orb returned; no target was selected.`);
      return;
    }

    setSelectedOrb(selectionBeforePointerRef.current);
    setAnnouncement(`${ORB_LABELS[drag.orb]} Orb drag canceled and returned.`);
  };

  const movePointer = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.settled || drag.pointerId !== event.pointerId) return;
    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    const dragging = drag.dragging || distance >= DRAG_THRESHOLD_PX;
    const next = { ...drag, x: event.clientX, y: event.clientY, dragging };
    if (dragging && !drag.dragging) {
      setSelectedOrb(null);
      setAnnouncement(`${ORB_LABELS[drag.orb]} Orb dragging. Release it over a valid target.`);
    }
    setCurrentDrag(next);
    if (dragging) findTarget(event.clientX, event.clientY);
  };

  const beginPointer = (orb: OrbKind, event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabledRef.current || !assistanceRef.current || assistanceRef.current[orb] !== null || dragRef.current) return;
    const pointerId = event.pointerId;
    const drag: DragState = {
      orb,
      pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      dragging: false,
      settled: false,
    };
    selectionBeforePointerRef.current = selectedOrbRef.current;
    captureElementRef.current = event.currentTarget;
    setCurrentDrag(drag);
    try {
      event.currentTarget.setPointerCapture?.(pointerId);
    } catch {
      // Pointer capture is an enhancement; document listeners still settle the drag.
    }

    const listeners: PointerListeners = {
      move: movePointer,
      up: (nativeEvent) => settleDrag(nativeEvent.pointerId, "up", nativeEvent.clientX, nativeEvent.clientY),
      cancel: (nativeEvent) => settleDrag(nativeEvent.pointerId, "cancel"),
      lost: (nativeEvent) => settleDrag(nativeEvent.pointerId, "lost"),
    };
    pointerListenersRef.current = listeners;
    document.addEventListener("pointermove", listeners.move);
    document.addEventListener("pointerup", listeners.up);
    document.addEventListener("pointercancel", listeners.cancel);
    event.currentTarget.addEventListener("pointermove", listeners.move);
    event.currentTarget.addEventListener("pointerup", listeners.up);
    event.currentTarget.addEventListener("pointercancel", listeners.cancel);
    event.currentTarget.addEventListener("lostpointercapture", listeners.lost);
  };

  const clearTransient = (nextAnnouncement = "") => {
    const drag = dragRef.current;
    if (drag && !drag.settled) drag.settled = true;
    detachPointerListeners();
    if (drag) releaseCapture(drag.pointerId);
    setCurrentDrag(null);
    setSelectedOrb(null);
    clearPoof();
    if (ignoreClickTimerRef.current !== null) {
      clearTimeout(ignoreClickTimerRef.current);
      ignoreClickTimerRef.current = null;
    }
    ignoreNextClickRef.current = false;
    setAnnouncement(nextAnnouncement);
  };

  cancelFromEscapeRef.current = () => {
    const drag = dragRef.current;
    if (drag) {
      settleDrag(drag.pointerId, "escape");
    } else if (selectedOrbRef.current) {
      const orb = selectedOrbRef.current;
      setSelectedOrb(null);
      setAnnouncement(`${ORB_LABELS[orb]} Orb selection canceled.`);
    }
  };

  const previousRoundRef = useRef(roundKey);
  useEffect(() => {
    if (previousRoundRef.current !== roundKey) {
      previousRoundRef.current = roundKey;
      clearTransient();
    }
  }, [roundKey]);

  useEffect(() => {
    if (disabled) {
      clearTransient("Orb interaction canceled because controls are disabled.");
      targetsRef.current = [];
    }
  }, [disabled]);

  const revealAvailable = assistance?.reveal === null;
  const filterAvailable = assistance?.filter === null;
  const negationAvailable = assistance?.negation === null;
  useEffect(() => {
    const orb = dragRef.current?.orb ?? selectedOrbRef.current;
    if (!assistance || (orb && assistance[orb] !== null)) clearTransient();
  }, [assistance, revealAvailable, filterAvailable, negationAvailable]);

  useEffect(() => {
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (dragRef.current || selectedOrbRef.current) {
        event.preventDefault();
        cancelFromEscapeRef.current();
      }
    };
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => document.removeEventListener("keydown", onDocumentKeyDown);
  }, [roundKey]);

  useEffect(() => () => {
    const drag = dragRef.current;
    if (drag && !drag.settled) drag.settled = true;
    detachPointerListeners();
    if (drag) releaseCapture(drag.pointerId);
    if (poofTimerRef.current !== null) clearTimeout(poofTimerRef.current);
    if (ignoreClickTimerRef.current !== null) clearTimeout(ignoreClickTimerRef.current);
    targetsRef.current = [];
  }, []);

  const getOrbButtonProps = (orb: OrbKind, available: boolean): ButtonHTMLAttributes<HTMLButtonElement> => {
    const selected = selectedOrb === orb;
    return {
      type: "button",
      disabled: disabled || !assistance || !available,
      "aria-label": `${ORB_LABELS[orb]} Orb, available`,
      "aria-pressed": selected,
      className: `orb-button${selected ? " orb-button--selected" : ""}`,
      onClick: () => {
        if (ignoreNextClickRef.current) {
          ignoreNextClickRef.current = false;
          if (ignoreClickTimerRef.current !== null) {
            clearTimeout(ignoreClickTimerRef.current);
            ignoreClickTimerRef.current = null;
          }
          return;
        }
        toggleSelection(orb);
      },
      onPointerDown: (event) => beginPointer(orb, event),
      onLostPointerCapture: (event) => settleDrag(event.pointerId, "lost"),
    };
  };

  const bindTarget = (target: OrbTargetDescriptor, validFor: readonly OrbKind[], label: string): OrbTargetBinding => {
    let registration = targetsRef.current.find((candidate) => sameTarget(candidate.descriptor, target));
    if (!registration) {
      registration = { id: `orb-target-${++targetIdRef.current}`, descriptor: target, validFor, label };
      targetsRef.current.push(registration);
    } else {
      registration.descriptor = target;
      registration.validFor = validFor;
      registration.label = label;
    }

    const activeOrb = dragState?.dragging ? dragState.orb : selectedOrb;
    const active = activeOrb !== null;
    const valid = activeOrb !== null && validFor.includes(activeOrb);
    const activate = (element: HTMLElement) => {
      const orb = selectedOrbRef.current;
      if (!orb) return;
      const point = targetPoint(element);
      attemptUse(orb, registration, point.x, point.y);
    };

    return {
      active,
      valid,
      selectedOrb: activeOrb,
      targetProps: {
        "data-orb-target": registration.id,
        ...(active ? {
          tabIndex: 0,
          role: "button" as const,
          "aria-label": `${label}. ${valid ? `Use ${ORB_LABELS[activeOrb]} Orb` : `Invalid target for ${ORB_LABELS[activeOrb]} Orb`}.`,
          onClick: (event: React.MouseEvent) => activate(event.currentTarget as HTMLElement),
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
            event.preventDefault();
            activate(event.currentTarget as HTMLElement);
          },
        } : {}),
      },
    };
  };

  const draggingOrb = dragState?.dragging ? dragState.orb : null;
  const value = useMemo<OrbInteractionValue>(() => ({
    selectedOrb,
    draggingOrb,
    poof,
    announcement,
    getOrbButtonProps,
    bindTarget,
  }), [announcement, assistance, disabled, dragState, poof, roundKey, selectedOrb]);

  return <OrbInteractionContext.Provider value={value}>
    {children}
    {dragState?.dragging && <div
      aria-hidden="true"
      className={`orb-drag-avatar orb-drag-avatar--${dragState.orb} orb-vfx`}
      style={{ left: dragState.x, position: "fixed", top: dragState.y }}
    >
      <OrbVisual kind={dragState.orb} />
      {particlesFor(dragState.orb)}
    </div>}
    <span className="orb-announcement" aria-atomic="true" aria-live="polite" role="status">{announcement}</span>
  </OrbInteractionContext.Provider>;
}

export function useOrbInteraction() {
  return useContext(OrbInteractionContext);
}
