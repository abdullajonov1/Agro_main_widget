import { useEffect, useRef, useState } from "react";

type UseAnimatedNumberOptions = {
  duration?: number;
  enabled?: boolean;
  precision?: number;
};

function easeInOutQuart(t: number) {
  return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

export function useAnimatedNumber(
  target: number,
  { duration = 480, enabled = true, precision = 0.05 }: UseAnimatedNumberOptions = {},
) {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    if (!enabled || !Number.isFinite(target)) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    const from = displayRef.current;
    if (Math.abs(from - target) < precision * 0.25) {
      return;
    }

    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const next = from + (target - from) * easeInOutQuart(progress);
      const prev = displayRef.current;

      if (Math.abs(next - prev) >= precision || progress >= 1) {
        const settled = progress >= 1 ? target : next;
        displayRef.current = settled;
        setDisplay(settled);
      }

      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [target, duration, enabled, precision]);

  return display;
}
