import type { ReactNode } from 'react';
import { motion } from 'motion/react';

interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  duration?: number;
  amount?: number | 'some' | 'all';
}

export const SMOOTH_EASE = [0.16, 1, 0.3, 1] as const;

export function ScrollReveal({
  children,
  className,
  delay = 0,
  y = 28,
  duration = 0.5,
  amount = 'some',
}: ScrollRevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount }}
      transition={{
        duration,
        delay,
        ease: SMOOTH_EASE,
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
