"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type RevealProps = {
  children: ReactNode;
  className?: string;
  id?: string;
};

/**
 * Scroll-in reveal for a page section.
 *
 * The source design hand-rolled an IntersectionObserver that wrote inline
 * opacity/transform onto every `[data-reveal]` node. `whileInView` replaces it and
 * matches how `peta-tematik/components/EditorialHeader.tsx` already animates.
 *
 * The design also force-revealed everything on a 1.6s timer, which would defeat the
 * effect on a page this long. The `landing-reveal` class carries that safety net
 * instead: `globals.css` unhides these sections when printing, and the page pairs it
 * with a `<noscript>` override — the hidden state is server-rendered, so without it
 * a visitor with scripting disabled would see an almost-empty page.
 */
export default function Reveal({ children, className, id }: RevealProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      id={id}
      className={cn("landing-reveal", className)}
      initial={reduceMotion ? false : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -12% 0px", amount: 0.08 }}
      transition={{ duration: 0.62, ease: [0.2, 0.8, 0.2, 1] }}
    >
      {children}
    </motion.section>
  );
}
