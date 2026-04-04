import { motion } from 'framer-motion';
import { ReactNode } from 'react';

const prefersReduced = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface PageTransitionProps {
  children: ReactNode;
}

export const PageTransition = ({ children }: PageTransitionProps) => {
  if (prefersReduced()) return <>{children}</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
};
