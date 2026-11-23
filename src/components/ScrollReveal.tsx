import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  duration?: number;
  amount?: number | 'some' | 'all';
}

export const SMOOTH_EASE = [0.22, 1, 0.36, 1] as const;

type RevealCallback = () => void;

let sharedObserver: IntersectionObserver | null = null;
const observerCallbacks = new WeakMap<Element, RevealCallback>();

function getSharedRevealObserver(): IntersectionObserver | null {
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
    return null;
  }
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting || entry.boundingClientRect.top <= window.innerHeight + 100) {
            const cb = observerCallbacks.get(entry.target);
            if (cb) {
              observerCallbacks.delete(entry.target);
              sharedObserver?.unobserve(entry.target);
              cb();
            }
          }
        }
      },
      {
        // Pre-trigger well before entering viewport so even fast scrolls glide smoothly without blank gaps
        rootMargin: '320px 0px 320px 0px',
        threshold: 0.01,
      }
    );
  }
  return sharedObserver;
}

export function ScrollReveal({
  children,
  className = '',
  y = 8,
  duration = 0.34,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      setVisible(true);
      return;
    }

    // If already in or near the viewport zone, reveal immediately without stalling
    const rect = el.getBoundingClientRect();
    if (rect.top <= window.innerHeight + 320) {
      setVisible(true);
      return;
    }

    const observer = getSharedRevealObserver();
    if (!observer) {
      setVisible(true);
      return;
    }

    observerCallbacks.set(el, () => setVisible(true));
    observer.observe(el);

    return () => {
      observerCallbacks.delete(el);
      observer.unobserve(el);
    };
  }, []);

  // Keep motion crisp, subtle, and immediate — never stacked or delayed
  const clampedY = Math.min(Math.max(y, 0), 10);
  const clampedDurationMs = Math.round(Math.min(Math.max(duration, 0.24), 0.38) * 1000);

  const revealStyle = {
    '--reveal-y': `${clampedY}px`,
    '--reveal-delay': '0ms',
    '--reveal-duration': `${clampedDurationMs}ms`,
  } as CSSProperties;

  return (
    <div
      ref={ref}
      style={revealStyle}
      className={`alif-reveal ${visible ? 'alif-reveal-visible' : ''} ${className}`.trim()}
    >
      {children}
    </div>
  );
}
