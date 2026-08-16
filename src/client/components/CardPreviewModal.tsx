import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { CardIdentity } from "../../shared/domain.js";
import { formatSearchCardName } from "../game/search-card-label.js";

export interface CardPreviewModalProps {
  card: CardIdentity;
  onClose(): void;
}

type FaceStatus = "loading" | "ready" | "error";

interface CardFaceProps {
  cardName: string;
  label: "Base" | "Upgraded";
  url: string | null;
  onRetryFocus(): void;
}

function CardFace({ cardName, label, url, onRetryFocus }: CardFaceProps): React.JSX.Element {
  const [{ status, attempt }, setFace] = useState<{ status: FaceStatus; attempt: number }>({ status: "loading", attempt: 0 });

  return <section className="card-preview-modal__face-section" aria-label={`${cardName} — ${label} card face`}>
    <h3>{label}</h3>
    <div className="card-preview-modal__face" data-card-preview-face>
      {!url ? <p role="status" aria-label={`${label} image unavailable`}>{label} image unavailable.</p> : <>
        {status === "loading" && <p role="status" aria-label={`${label} image loading`}>Loading {label} image…</p>}
        {status === "error" && <div>
          <p role="status" aria-label={`${label} image failed to load`}>{label} image failed to load.</p>
          <button type="button" onClick={() => {
            onRetryFocus();
            setFace(({ attempt: previousAttempt }) => ({ status: "loading", attempt: previousAttempt + 1 }));
          }}>Retry {label} image</button>
        </div>}
        <img
          key={`${label}-${attempt}`}
          src={url}
          alt={`${cardName} — ${label} card artwork`}
          onLoad={() => setFace((face) => ({ ...face, status: "ready" }))}
          onError={() => setFace((face) => ({ ...face, status: "error" }))}
        />
      </>}
    </div>
  </section>;
}

export function CardPreviewModal({ card, onClose }: CardPreviewModalProps): React.JSX.Element {
  const titleId = useId();
  const cardName = formatSearchCardName(card);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const appContent = document.querySelector<HTMLElement>(".app-shell__content");
    const appContentWasInert = appContent?.hasAttribute("inert") ?? false;
    const htmlStyle = document.documentElement.getAttribute("style");
    const bodyStyle = document.body.getAttribute("style");
    appContent?.setAttribute("inert", "");
    document.documentElement.style.setProperty("overflow", "hidden");
    document.body.style.setProperty("overflow", "hidden");
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (!appContentWasInert) appContent?.removeAttribute("inert");
      if (htmlStyle === null) document.documentElement.removeAttribute("style");
      else document.documentElement.setAttribute("style", htmlStyle);
      if (bodyStyle === null) document.body.removeAttribute("style");
      else document.body.setAttribute("style", bodyStyle);
      queueMicrotask(() => openerRef.current?.focus());
    };
  }, [close]);

  const modal = <div className="card-preview-modal__backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialogRef} className="card-preview-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="card-preview-modal__header">
        <h2 id={titleId}>Preview {cardName}</h2>
        <button ref={closeRef} type="button" aria-label="Close preview" onClick={close}>×</button>
      </header>
      <div className={`card-preview-modal__faces${card.hasUpgrade ? "" : " card-preview-modal__faces--single"}`} style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "1rem" }}>
        <CardFace cardName={cardName} label="Base" url={card.baseCardUrl} onRetryFocus={() => closeRef.current?.focus()} />
        {card.hasUpgrade && <CardFace cardName={cardName} label="Upgraded" url={card.upgradedCardUrl} onRetryFocus={() => closeRef.current?.focus()} />}
      </div>
    </div>
  </div>;
  const root = typeof document === "undefined" ? null : document.getElementById("card-preview-root");
  return root ? createPortal(modal, root) : modal;
}
