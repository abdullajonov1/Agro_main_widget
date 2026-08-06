import { React } from "jimu-core";
import { useEffect, useRef, useState } from "react";

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function")
      return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(Boolean(mq.matches));
    onChange();
    if (typeof mq.addEventListener === "function")
      mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (typeof mq.removeEventListener === "function")
        mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  return reduced;
}

export function formatAgriInteger(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

type AgriAnimatedCountProps = {
  /** Target value; null/undefined shows emptyFallback. Always animated as whole integers. */
  value: number | null | undefined;
  durationMs?: number;
  /** Animate from this integer on first paint (default 0 when value is finite). */
  animateFromOnMount?: number;
  emptyFallback?: string;
  format?: (n: number) => string;
  className?: string;
};

/**
 * Smooth integer count-up / count-down between successive values.
 * Decimals are rounded; animation steps only whole numbers.
 */
export default function AgriAnimatedCount(
  props: AgriAnimatedCountProps,
): JSX.Element {
  const {
    value,
    durationMs = 700,
    animateFromOnMount = 0,
    emptyFallback = "0",
    format = formatAgriInteger,
    className,
  } = props;

  const reducedMotion = useReducedMotion();
  const mountedRef = useRef(false);
  const prevValueRef = useRef<number | null>(null);
  const [displayValue, setDisplayValue] = useState<number | null>(() =>
    value == null || !Number.isFinite(value) ? null : Math.round(value),
  );

  useEffect(() => {
    const to =
      value == null || !Number.isFinite(Number(value))
        ? null
        : Math.round(Number(value));

    if (to == null) {
      setDisplayValue(null);
      prevValueRef.current = null;
      mountedRef.current = true;
      return;
    }

    if (reducedMotion) {
      setDisplayValue(to);
      prevValueRef.current = to;
      mountedRef.current = true;
      return;
    }

    const shouldAnimateFromMount =
      !mountedRef.current && typeof animateFromOnMount === "number";
    const from = shouldAnimateFromMount
      ? Math.round(animateFromOnMount)
      : prevValueRef.current == null
        ? Math.round(animateFromOnMount)
        : prevValueRef.current;

    mountedRef.current = true;

    if (to === from) {
      setDisplayValue(to);
      prevValueRef.current = to;
      return;
    }

    let raf = 0;
    const start = performance.now();
    const span = to - from;
    setDisplayValue(from);

    const step = (now: number) => {
      const t = Math.max(0, Math.min(1, (now - start) / durationMs));
      const eased = easeOutCubic(t);
      setDisplayValue(Math.round(from + span * eased));
      if (t < 1) raf = window.requestAnimationFrame(step);
      else {
        setDisplayValue(to);
        prevValueRef.current = to;
      }
    };

    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [animateFromOnMount, durationMs, reducedMotion, value]);

  const text =
    displayValue == null ? emptyFallback : format(displayValue);

  return className ? (
    <span className={className}>{text}</span>
  ) : (
    <>{text}</>
  );
}
