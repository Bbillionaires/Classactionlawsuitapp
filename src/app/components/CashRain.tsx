import type { CSSProperties } from "react";

const BILL_COUNT = 20;
// "$" and a couple of bill emoji, mixed so it reads as cash rather than
// a single repeated glyph.
const GLYPHS = ["💵", "$", "💵", "💸"];

interface Bill {
  left: number;
  delay: number;
  duration: number;
  size: number;
  drift: number;
  glyph: string;
}

// Deterministic pseudo-randomness from the index (no Math.random): keeps
// server and client render identical, so there's no hydration mismatch
// and no client-side JS needed just to rain some emoji.
function billAt(i: number): Bill {
  return {
    left: (i * 53) % 100,
    delay: (i * 1.7) % 9,
    duration: 8 + (i % 5) * 1.6,
    size: 1.1 + (i % 4) * 0.3,
    drift: (i % 2 === 0 ? 1 : -1) * (10 + (i % 3) * 8),
    glyph: GLYPHS[i % GLYPHS.length],
  };
}

const BILLS = Array.from({ length: BILL_COUNT }, (_, i) => billAt(i));

/**
 * Purely decorative, continuous falling-cash background. Fixed behind
 * the page content (z-index below `.page-content`), never intercepts
 * clicks, and backs off entirely under prefers-reduced-motion.
 */
export default function CashRain() {
  return (
    <div className="cash-rain" aria-hidden="true">
      {BILLS.map((bill, i) => (
        <span
          key={i}
          className="cash-bill"
          style={
            {
              left: `${bill.left}%`,
              fontSize: `${bill.size}rem`,
              animationDelay: `${bill.delay}s`,
              animationDuration: `${bill.duration}s`,
              "--drift": `${bill.drift}px`,
            } as CSSProperties
          }
        >
          {bill.glyph}
        </span>
      ))}
    </div>
  );
}
