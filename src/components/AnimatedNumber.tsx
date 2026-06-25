import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
  duration?: number;
}

export const AnimatedNumber = ({
  value,
  decimals = 0,
  suffix = '',
  prefix = '',
  className,
  duration = 600,
}: AnimatedNumberProps) => {
  const [displayValue, setDisplayValue] = useState(0);
  // Tracks the last animation target so subsequent updates start from there
  // rather than from 0 — prevents the "flicker to 0" on refetch.
  const prevValueRef = useRef(0);

  useEffect(() => {
    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      prevValueRef.current = value;
      setDisplayValue(value);
      return;
    }

    let startTime: number | null = null;
    const startValue = prevValueRef.current;
    let rafId: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);

      // Ease-out animation
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = startValue + (value - startValue) * easeOut;

      setDisplayValue(current);

      if (progress < 1) {
        rafId = requestAnimationFrame(animate);
      } else {
        prevValueRef.current = value;
      }
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      // On cancellation (new value arrived mid-animation) store the old
      // target as the next start point — avoids a jump back to 0.
      prevValueRef.current = value;
    };
  }, [value, duration]);

  const formattedValue = decimals > 0
    ? displayValue.toFixed(decimals)
    : Math.floor(displayValue).toString();

  return (
    <span className={cn('font-mono font-bold tabular-nums', className)}>
      {prefix}{formattedValue}{suffix}
    </span>
  );
};
