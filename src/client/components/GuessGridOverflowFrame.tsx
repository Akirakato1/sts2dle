import React, { useCallback, useEffect, useRef, useState } from "react";

export interface GuessGridOverflowFrameProps {
  readonly children: React.ReactNode;
  readonly resetKey: string | number;
  readonly reducedMotion: boolean;
}

interface ScrollState {
  readonly overflowing: boolean;
  readonly canScrollLeft: boolean;
  readonly canScrollRight: boolean;
}

const INITIAL_SCROLL_STATE: ScrollState = {
  overflowing: false,
  canScrollLeft: false,
  canScrollRight: false,
};

const FEATURE_COLUMN_STEP_PX = 88;

export function GuessGridOverflowFrame({
  children,
  resetKey,
  reducedMotion,
}: GuessGridOverflowFrameProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrollLeftRef = useRef(0);
  const [scrollState, setScrollState] = useState<ScrollState>(INITIAL_SCROLL_STATE);
  const [interacted, setInteracted] = useState(false);

  const measure = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const { clientWidth, scrollLeft, scrollWidth } = scroller;
    const overflowing = scrollWidth > clientWidth + 1;
    const nextState = {
      overflowing,
      canScrollLeft: overflowing && scrollLeft > 1,
      canScrollRight: overflowing && scrollLeft + clientWidth < scrollWidth - 1,
    };
    setScrollState((current) => current.overflowing === nextState.overflowing
      && current.canScrollLeft === nextState.canScrollLeft
      && current.canScrollRight === nextState.canScrollRight
      ? current
      : nextState);
  }, []);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    lastScrollLeftRef.current = scroller.scrollLeft;
    setInteracted(false);
    measure();
  }, [measure, resetKey]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const handleScroll = () => {
      const nextScrollLeft = scroller.scrollLeft;
      if (nextScrollLeft !== lastScrollLeftRef.current) setInteracted(true);
      lastScrollLeftRef.current = nextScrollLeft;
      measure();
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    const grid = scroller.firstElementChild;
    observer?.observe(scroller);
    if (grid) observer?.observe(grid);
    scroller.addEventListener("scroll", handleScroll);
    measure();
    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      observer?.disconnect();
    };
  }, [children, measure]);

  const scrollOneColumn = (direction: -1 | 1) => {
    setInteracted(true);
    scrollRef.current?.scrollBy({
      left: direction * FEATURE_COLUMN_STEP_PX,
      behavior: reducedMotion ? "auto" : "smooth",
    });
  };

  const showHint = scrollState.overflowing && !interacted;
  const showControls = showHint || scrollState.canScrollLeft || scrollState.canScrollRight;

  return <section className="guess-grid-overflow" aria-label="Guess results">
    {showControls && <div className="guess-grid-overflow__controls">
      {showHint && <span className="guess-grid-overflow__hint">
        Swipe or scroll for more columns <span aria-hidden="true">&#8594;</span>
      </span>}
      {scrollState.canScrollLeft && <button
        type="button"
        className="guess-grid-overflow__control guess-grid-overflow__control--left"
        aria-label="Scroll guesses left"
        onClick={() => scrollOneColumn(-1)}
      >
        <span aria-hidden="true">&#8249;</span>
      </button>}
      {scrollState.canScrollRight && <button
        type="button"
        className="guess-grid-overflow__control guess-grid-overflow__control--right"
        aria-label="Scroll guesses right"
        onClick={() => scrollOneColumn(1)}
      >
        <span aria-hidden="true">&#8250;</span>
      </button>}
    </div>}
    <div className="guess-grid-overflow__viewport">
      <div className="guess-grid-scroll" ref={scrollRef}>
        {children}
      </div>
      {scrollState.canScrollLeft && <span
        className="guess-grid-overflow__fade guess-grid-overflow__fade--left"
        aria-hidden="true"
      />}
      {scrollState.canScrollRight && <span
        className="guess-grid-overflow__fade guess-grid-overflow__fade--right"
        aria-hidden="true"
      />}
    </div>
  </section>;
}
