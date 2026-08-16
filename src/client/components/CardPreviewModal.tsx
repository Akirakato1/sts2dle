import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { CardIdentity } from "../../shared/domain.js";

export interface CardPreviewModalProps {
  card: CardIdentity;
  onClose(): void;
}

type FaceStatus = "loading" | "ready" | "error";

interface CardFaceProps {
  cardName: string;
  label: "Base" | "Upgraded";
  url: string | null;
}

function CardFace({ cardName, label, url }: CardFaceProps): React.JSX.Element {
  const [{ status, attempt }, setFace] = useState<{ status: FaceStatus; attempt: number }>({ status: "loading", attempt: 0 });

  return <section className="card-preview-modal__face-section" aria-label={`${cardName} — ${label} card face`}>
    <h3>{label}</h3>
    <div className="card-preview-modal__face" data-card-preview-face>
      {!url ? <p role="status" aria-label={`${label} image unavailable`}>{label} image unavailable.</p> : <>
        {status === "loading" && <p role="status" aria-label={`${label} image loading`}>Loading {label} image…</p>}
        {status === "error" && <div>
          <p role="status" aria-label={`${label} image failed to load`}>{label} image failed to load.</p>
          <button type="button" onClick={() => setFace(({ attempt: previousAttempt }) => ({ status: "loading", attempt: previousAttempt + 1 }))}>Retry {label} image</button>
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
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const appContent = document.querySelector<HTMLElement>(".app-shell__content");
    appContent?.setAttribute("inert", "");
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
      if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      appContent?.removeAttribute("inert");
      queueMicrotask(() => openerRef.current?.focus());
    };
  }, [close]);

  const modal = <div className="card-preview-modal__backdrop" onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <div ref={dialogRef} className="card-preview-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="card-preview-modal__header">
        <h2 id={titleId}>Preview {card.name}</h2>
        <button ref={closeRef} type="button" aria-label="Close preview" onClick={close}>×</button>
      </header>
      <div className={`card-preview-modal__faces${card.hasUpgrade ? "" : " card-preview-modal__faces--single"}`} style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "1rem" }}>
        <CardFace cardName={card.name} label="Base" url={card.baseCardUrl} />
        {card.hasUpgrade && <CardFace cardName={card.name} label="Upgraded" url={card.upgradedCardUrl} />}
      </div>
    </div>
  </div>;
  const root = typeof document === "undefined" ? null : document.getElementById("card-preview-root");
  return root ? createPortal(modal, root) : modal;
}
