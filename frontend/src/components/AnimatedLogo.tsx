"use client";

import React, { useEffect, useRef } from "react";

/**
 * AnimatedLogo — SVG path morphing via a SINGLE requestAnimationFrame loop.
 *
 * Architecture: One rAF drives a deterministic timeline. Zero React state
 * changes during animation, zero setTimeout, zero CSS keyframe start/stop.
 * This eliminates all sources of stutter: no timer drift, no re-renders,
 * no animation interruption.
 *
 * Timeline (loop mode, ms) — face is the home state:
 *   0-300      face hold (robot face visible immediately)
 *   300-420    blink 1              (easeInOutCubic)
 *   420-540    open 1               (easeInOutCubic)
 *   540-700    face hold
 *   700-820    blink 2              (easeInOutCubic)
 *   820-940    open 2               (easeInOutCubic)
 *   940-1350   face hold
 *   1350-2150  settle face → logo   (easeOutCubic)
 *   2150-4150  rest (static bars)
 *   4150-10150 pulse (rAF sine wave)
 *   10150-11150 rest (static bars)
 *   11150-11950 revert logo → face  (seamless wrap)
 *   11950-12250 face hold → wraps to 0
 */

interface AnimatedLogoProps {
  size?: number;
  animate?: boolean;
  delay?: number;
  playFace?: boolean;
  skipFlyIn?: boolean;
  loop?: boolean;
  showOrb?: boolean;
}

/* ─── Path data (all M + 6C + Z, 38 numbers each) ───────────────── */

const BAR1_LOGO =
  "M 8.424 8.422 C 8.424 7.491 9.178 6.737 10.108 6.737 C 11.038 6.737 11.792 7.491 11.792 8.422 C 11.792 8.422 11.792 23.579 11.792 23.579 C 11.792 24.510 11.038 25.264 10.108 25.264 C 9.178 25.264 8.424 24.510 8.424 23.579 C 8.424 23.579 8.424 8.422 8.424 8.422 Z";
const BAR2_LOGO =
  "M 14.742 15.157 C 14.742 14.227 15.496 13.473 16.426 13.473 C 17.357 13.473 18.111 14.227 18.111 15.157 C 18.111 15.157 18.111 23.578 18.111 23.578 C 18.111 24.508 17.357 25.262 16.426 25.262 C 15.496 25.262 14.742 24.508 14.742 23.578 C 14.742 23.578 14.742 15.157 14.742 15.157 Z";
const BAR3_LOGO =
  "M 21.055 10.946 C 21.055 10.016 21.809 9.262 22.739 9.262 C 23.669 9.262 24.423 10.016 24.423 10.946 C 24.423 10.946 24.423 23.578 24.423 23.578 C 24.423 24.508 23.669 25.262 22.739 25.262 C 21.809 25.262 21.055 24.508 21.055 23.578 C 21.055 23.578 21.055 10.946 21.055 10.946 Z";

const BAR1_FACE =
  "M 10 11.5 C 12.5 11.5 13 11.5 13 12 C 13 13 13 15 13 16 C 13 16.5 12.5 16.5 10 16.5 C 7.5 16.5 7 16.5 7 16 C 7 15 7 13 7 12 C 7 11.5 7.5 11.5 10 11.5 Z";
const BAR2_SMILE =
  "M 10 22 C 10 21.4 10.4 21 11 21 C 14 21 18 21 21 21 C 21.6 21 22 21.4 22 22 C 22 22.6 21.6 23 21 23 C 18 23 14 23 11 23 C 10.4 23 10 22.6 10 22 Z";
const BAR3_FACE =
  "M 22 11.5 C 24.5 11.5 25 11.5 25 12 C 25 13 25 15 25 16 C 25 16.5 24.5 16.5 22 16.5 C 19.5 16.5 19 16.5 19 16 C 19 15 19 13 19 12 C 19 11.5 19.5 11.5 22 11.5 Z";

const BAR1_BLINK =
  "M 10 13.5 C 12 13.5 13 13.5 13 13.5 C 13 13.75 13 14.25 13 14.5 C 13 14.5 12 14.5 10 14.5 C 8 14.5 7 14.5 7 14.5 C 7 14.25 7 13.75 7 13.5 C 7 13.5 8 13.5 10 13.5 Z";
const BAR3_BLINK =
  "M 22 13.5 C 24 13.5 25 13.5 25 13.5 C 25 13.75 25 14.25 25 14.5 C 25 14.5 24 14.5 22 14.5 C 20 14.5 19 14.5 19 14.5 C 19 14.25 19 13.75 19 13.5 C 19 13.5 20 13.5 22 13.5 Z";

/* ─── JS Path Interpolation Engine ───────────────────────────────── */

function parsePathNumbers(d: string): number[] {
  const m = d.match(/-?\d+\.?\d*/g);
  return m ? m.map(Number) : [];
}

function parsePathTemplate(d: string): string {
  let i = 0;
  return d.replace(/-?\d+\.?\d*/g, () => `\${${i++}}`);
}

function buildPath(tmpl: string, nums: number[]): string {
  let i = 0;
  return tmpl.replace(/\$\{\d+\}/g, () => (Math.round(nums[i++] * 1000) / 1000).toString());
}

/* ─── Easings ────────────────────────────────────────────────────── */

const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/* ─── Cached path entries ────────────────────────────────────────── */

interface PEntry {
  readonly nums: readonly number[];
  readonly tmpl: string;
  readonly raw: string;
}

function mkEntry(raw: string): PEntry {
  return { nums: parsePathNumbers(raw), tmpl: parsePathTemplate(raw), raw };
}

const P = {
  B1_LOGO: mkEntry(BAR1_LOGO),   B2_LOGO: mkEntry(BAR2_LOGO),   B3_LOGO: mkEntry(BAR3_LOGO),
  B1_FACE: mkEntry(BAR1_FACE),   B2_SMIL: mkEntry(BAR2_SMILE),  B3_FACE: mkEntry(BAR3_FACE),
  B1_BLNK: mkEntry(BAR1_BLINK),  B3_BLNK: mkEntry(BAR3_BLINK),
} as const;

/** Interpolate between two cached paths. p=0→from, p=1→to. */
function lerp(from: PEntry, to: PEntry, p: number): string {
  if (p <= 0) return from.raw;
  if (p >= 1) return to.raw;
  const len = from.nums.length;
  const r = new Array<number>(len);
  for (let i = 0; i < len; i++) r[i] = from.nums[i] + (to.nums[i] - from.nums[i]) * p;
  return buildPath(to.tmpl, r);
}

/* ─── Component ──────────────────────────────────────────────────── */

export default function AnimatedLogo({
  size = 96,
  animate = false,
  delay = 0,
  playFace = false,
  skipFlyIn = false,
  loop = false,
  showOrb = false,
}: AnimatedLogoProps) {
  const bar1Ref = useRef<SVGPathElement>(null);
  const bar2Ref = useRef<SVGPathElement>(null);
  const bar3Ref = useRef<SVGPathElement>(null);
  const bgRef = useRef<SVGGElement>(null);

  const active = animate && playFace;
  const flyIn = !skipFlyIn;
  const dl = delay / 1000;

  const bgDelay = `${dl}s`;
  const bar1Delay = `${dl + 0.2}s`;
  const bar2Delay = `${dl + 0.4}s`;
  const bar3Delay = `${dl + 0.55}s`;

  /* ═══ Single rAF animation timeline ═══ */
  useEffect(() => {
    if (!active) return;

    const b1 = bar1Ref.current;
    const b2 = bar2Ref.current;
    const b3 = bar3Ref.current;
    const bg = bgRef.current;
    if (!b1 || !b2 || !b3) return;

    // When reduced-motion is enabled, CSS fly-in animations are killed,
    // so bars would stay invisible (opacity: 0). Fix: make everything
    // visible immediately, then let the rAF path-morphing still run.
    const reducedMotion = typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      [b1, b2, b3].forEach(b => {
        if (b.parentElement) {
          b.parentElement.style.opacity = "1";
          b.parentElement.style.animation = "none";
          b.parentElement.style.transform = "none";
        }
      });
      if (bg) {
        bg.style.opacity = "1";
        bg.style.animation = "none";
      }
    }

    // ── Compute timeline stamps (all ms) ──
    // Face is the home state — starts directly as robot face
    const blink1     = skipFlyIn ? 300 : delay + 1300;
    const blink1End  = blink1 + 120;
    const open1End   = blink1End + 120;
    const blink2     = open1End + 160;
    const blink2End  = blink2 + 120;
    const open2End   = blink2End + 120;
    const settle     = open2End + 410;
    const settleEnd  = settle + 800;
    // Loop-only segments
    const pulse      = settleEnd + 2000;
    const pulseEnd   = pulse + 6000;
    const revert     = pulseEnd + 1000;
    const revertEnd  = revert + 800;
    const cycleTotal = revertEnd + 300;

    let raf = 0;
    let stopped = false;
    let bgWobbled = false;
    let t0 = -1; // set on first actual rAF tick to avoid main-thread jank

    const tick = (now: number) => {
      if (stopped) return;

      // Initialize t0 on first painted frame — eliminates the race where
      // heavy hydration/WebGL work causes elapsed to skip the entire face phase
      if (t0 < 0) t0 = now;

      const elapsed = now - t0;
      let t: number;

      if (loop) {
        t = elapsed % cycleTotal;
      } else {
        t = elapsed;
        // Non-loop: stop after settle completes
        if (t > settleEnd + 50) {
          b1.setAttribute("d", BAR1_LOGO);
          b2.setAttribute("d", BAR2_LOGO);
          b3.setAttribute("d", BAR3_LOGO);
          b2.setAttribute("fill-opacity", "0.9");
          b3.setAttribute("fill-opacity", "0.7");
          b1.style.transform = "";
          b2.style.transform = "";
          b3.style.transform = "";
          return; // stop loop
        }
      }

      let d1: string, d2: string, d3: string;
      let op2 = 1, op3 = 1;
      let tx1 = "", tx2 = "", tx3 = "";

      if (t < blink1) {
        // ── Face hold (robot face visible immediately) ──
        d1 = BAR1_FACE; d2 = BAR2_SMILE; d3 = BAR3_FACE;
        // Trigger bg wobble once AFTER fly-in bars have landed (~700ms)
        if (!bgWobbled && bg && !skipFlyIn && t > 700) {
          bg.style.opacity = "1";
          bg.style.animation = "bgWobble 1.4s ease-in-out both";
          bgWobbled = true;
        }

      } else if (t < blink1End) {
        // ── Blink 1 ──
        const p = easeInOutCubic((t - blink1) / 120);
        d1 = lerp(P.B1_FACE, P.B1_BLNK, p);
        d2 = BAR2_SMILE;
        d3 = lerp(P.B3_FACE, P.B3_BLNK, p);

      } else if (t < open1End) {
        // ── Open 1 ──
        const p = easeInOutCubic((t - blink1End) / 120);
        d1 = lerp(P.B1_BLNK, P.B1_FACE, p);
        d2 = BAR2_SMILE;
        d3 = lerp(P.B3_BLNK, P.B3_FACE, p);

      } else if (t < blink2) {
        // ── Face hold 2 ──
        d1 = BAR1_FACE; d2 = BAR2_SMILE; d3 = BAR3_FACE;

      } else if (t < blink2End) {
        // ── Blink 2 ──
        const p = easeInOutCubic((t - blink2) / 120);
        d1 = lerp(P.B1_FACE, P.B1_BLNK, p);
        d2 = BAR2_SMILE;
        d3 = lerp(P.B3_FACE, P.B3_BLNK, p);

      } else if (t < open2End) {
        // ── Open 2 ──
        const p = easeInOutCubic((t - blink2End) / 120);
        d1 = lerp(P.B1_BLNK, P.B1_FACE, p);
        d2 = BAR2_SMILE;
        d3 = lerp(P.B3_BLNK, P.B3_FACE, p);

      } else if (t < settle) {
        // ── Face hold 3 ──
        d1 = BAR1_FACE; d2 = BAR2_SMILE; d3 = BAR3_FACE;

      } else if (t < settleEnd) {
        // ── Settle: face → logo bars ──
        const p = easeOutCubic((t - settle) / 800);
        d1 = lerp(P.B1_FACE, P.B1_LOGO, p);
        d2 = lerp(P.B2_SMIL, P.B2_LOGO, p);
        d3 = lerp(P.B3_FACE, P.B3_LOGO, p);
        op2 = 1 - p * 0.1;   // 1 → 0.9
        op3 = 1 - p * 0.3;   // 1 → 0.7

      } else if (t < pulse) {
        // ── Rest 1: static logo bars ──
        d1 = BAR1_LOGO; d2 = BAR2_LOGO; d3 = BAR3_LOGO;
        op2 = 0.9; op3 = 0.7;

      } else if (t < pulseEnd) {
        // ── Pulse: smooth sine-wave scaleY (rAF-driven, no CSS keyframes) ──
        d1 = BAR1_LOGO; d2 = BAR2_LOGO; d3 = BAR3_LOGO;
        op2 = 0.9; op3 = 0.7;

        const pt = (t - pulse) / (pulseEnd - pulse); // 0→1
        // Smooth envelope: ease in/out at boundaries
        const env = pt < 0.08 ? pt / 0.08 : pt > 0.92 ? (1 - pt) / 0.08 : 1;
        const amp = 0.15 * env;
        const w = Math.PI * 2 * 2; // 2 full oscillations
        const s1 = Math.sin(pt * w);
        const s2 = Math.sin(pt * w + (Math.PI * 2) / 3);
        const s3 = Math.sin(pt * w + (Math.PI * 4) / 3);

        tx1 = `scaleY(${(1 + s1 * amp).toFixed(4)})`;
        tx2 = `scaleY(${(1 + s2 * amp).toFixed(4)})`;
        tx3 = `scaleY(${(1 + s3 * amp).toFixed(4)})`;

      } else if (t < revert) {
        // ── Rest 2: static logo bars ──
        d1 = BAR1_LOGO; d2 = BAR2_LOGO; d3 = BAR3_LOGO;
        op2 = 0.9; op3 = 0.7;

      } else if (t < revertEnd) {
        // ── Revert: logo → face (seamless loop restart) ──
        const p = easeOutCubic((t - revert) / 800);
        d1 = lerp(P.B1_LOGO, P.B1_FACE, p);
        d2 = lerp(P.B2_LOGO, P.B2_SMIL, p);
        d3 = lerp(P.B3_LOGO, P.B3_FACE, p);
        op2 = 0.9 + p * 0.1;  // 0.9 → 1
        op3 = 0.7 + p * 0.3;  // 0.7 → 1

      } else {
        // ── Face hold (before cycle wraps via modulo) ──
        d1 = BAR1_FACE; d2 = BAR2_SMILE; d3 = BAR3_FACE;
      }

      // Apply path data
      b1.setAttribute("d", d1);
      b2.setAttribute("d", d2);
      b3.setAttribute("d", d3);

      // Apply fill-opacity
      b2.setAttribute("fill-opacity", op2 >= 1 ? "1" : op2.toFixed(3));
      b3.setAttribute("fill-opacity", op3 >= 1 ? "1" : op3.toFixed(3));

      // Apply pulse transforms
      if (tx1) {
        b1.style.transformOrigin = "10.1px 25.26px";
        b2.style.transformOrigin = "16.4px 25.26px";
        b3.style.transformOrigin = "22.7px 25.26px";
        b1.style.transform = tx1;
        b2.style.transform = tx2;
        b3.style.transform = tx3;
      } else if (b1.style.transform) {
        b1.style.transform = "";
        b2.style.transform = "";
        b3.style.transform = "";
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [active, skipFlyIn, loop, delay]);

  // ── Static fallback when not animating ──
  // Only set logo bars when animate will NEVER become true (non-splash contexts).
  // For splash (flyIn=true), don't overwrite face paths — let fly-in handle it.
  useEffect(() => {
    if (active) return;
    if (flyIn) return; // splash: keep face shapes until rAF takes over
    const b1 = bar1Ref.current;
    const b2 = bar2Ref.current;
    const b3 = bar3Ref.current;
    if (!b1 || !b2 || !b3) return;
    b1.setAttribute("d", BAR1_LOGO);
    b2.setAttribute("d", BAR2_LOGO);
    b3.setAttribute("d", BAR3_LOGO);
    b2.setAttribute("fill-opacity", "0.9");
    b3.setAttribute("fill-opacity", "0.7");
  }, [active, flyIn]);

  // ── BG animation (splash fly-in only) ──
  const bgAnimation = (!animate || skipFlyIn)
    ? "none"
    : `logoBoxIn 0.7s cubic-bezier(0.16, 1, 0.3, 1) ${bgDelay} both`;
  const bgOpacity = skipFlyIn ? 1 : active ? 0 : 1;

  // ── Orb sizing ──
  const orbSize = Math.round(size * 2);

  const svgContent = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", overflow: "visible", transform: "translateZ(0)" }}
    >
      {/* Blue rounded square */}
      <g ref={bgRef} style={{ transformOrigin: "16px 16px", animation: bgAnimation, opacity: bgOpacity }}>
        <path
          d="M0 8.42105C0 3.77023 3.77023 0 8.42105 0H23.5789C28.2298 0 32 3.77023 32 8.42105V23.5789C32 28.2298 28.2298 32 23.5789 32H8.42105C3.77023 32 0 28.2298 0 23.5789V8.42105Z"
          fill="#465FFF"
        />
      </g>

      {/* Bar 1 */}
      <g
        style={{
          transformOrigin: "10px 16px",
          animation: (animate && flyIn)
            ? `barFromTopLeft 0.75s cubic-bezier(0.16, 1, 0.3, 1) ${bar1Delay} both`
            : "none",
          opacity: (animate && flyIn) ? 0 : 1,
        }}
      >
        <path ref={bar1Ref} d={BAR1_FACE} fill="white" />
      </g>

      {/* Bar 3 */}
      <g
        style={{
          transformOrigin: "22.7px 17px",
          animation: (animate && flyIn)
            ? `barFromTopRight 0.75s cubic-bezier(0.16, 1, 0.3, 1) ${bar2Delay} both`
            : "none",
          opacity: (animate && flyIn) ? 0 : 1,
        }}
      >
        <path ref={bar3Ref} d={BAR3_FACE} fill="white" fillOpacity={1} />
      </g>

      {/* Bar 2 */}
      <g
        style={{
          transformOrigin: "16.4px 19px",
          animation: (animate && flyIn)
            ? `barFromBottom 0.75s cubic-bezier(0.16, 1, 0.3, 1) ${bar3Delay} both`
            : "none",
          opacity: (animate && flyIn) ? 0 : 1,
        }}
      >
        <path ref={bar2Ref} d={BAR2_SMILE} fill="white" fillOpacity={1} />
      </g>
    </svg>
  );

  return (
    <>
      {showOrb ? (
        <span
          className="anim-logo-orb-outer"
          style={{
            position: "relative",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: orbSize,
            height: orbSize,
          }}
        >
          <span className="anim-logo-orb-sphere" style={{ width: orbSize, height: orbSize }} />
          <span className="anim-logo-orb-inner" style={{ width: orbSize * 0.7, height: orbSize * 0.7 }} />
          <span style={{ position: "relative", zIndex: 2, display: "inline-flex" }}>
            {svgContent}
          </span>
        </span>
      ) : (
        svgContent
      )}

      <style jsx>{`
        @keyframes logoBoxIn {
          0% { opacity: 0; transform: scale(0.3) rotate(-10deg); }
          100% { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        @keyframes barFromTopLeft {
          0% { opacity: 0; transform: translate(-12px, -12px) scale(0.5) rotate(-20deg); }
          70% { opacity: 1; transform: translate(0.5px, 0.5px) scale(1.02) rotate(1deg); }
          100% { opacity: 1; transform: translate(0, 0) scale(1) rotate(0deg); }
        }
        @keyframes barFromTopRight {
          0% { opacity: 0; transform: translate(12px, -12px) scale(0.5) rotate(20deg); }
          70% { opacity: 1; transform: translate(-0.5px, 0.5px) scale(1.02) rotate(-1deg); }
          100% { opacity: 1; transform: translate(0, 0) scale(1) rotate(0deg); }
        }
        @keyframes barFromBottom {
          0% { opacity: 0; transform: translate(0, 14px) scale(0.5); }
          70% { opacity: 1; transform: translate(0, -0.5px) scale(1.02); }
          100% { opacity: 1; transform: translate(0, 0) scale(1); }
        }
        @keyframes bgWobble {
          0%   { transform: scale(1) rotate(0deg); }
          15%  { transform: scale(1.05) rotate(2deg); }
          40%  { transform: scale(1.05) rotate(-1.5deg); }
          65%  { transform: scale(1.02) rotate(0.5deg); }
          100% { transform: scale(1) rotate(0deg); }
        }

        /* ═══ CSS Orb (lightweight fallback for sidebar) ═══ */
        .anim-logo-orb-outer { isolation: isolate; }
        .anim-logo-orb-sphere {
          position: absolute; inset: 0; border-radius: 50%;
          background: conic-gradient(from 0deg,
            rgba(37,99,235,0.45), rgba(147,130,255,0.35),
            rgba(245,158,11,0.3), rgba(12,45,90,0.4),
            rgba(37,99,235,0.45));
          animation: orbSpin 8s linear infinite;
          filter: blur(4px); opacity: 0.7;
          pointer-events: none; z-index: 0;
        }
        .anim-logo-orb-inner {
          position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%); border-radius: 50%;
          background: radial-gradient(circle,
            rgba(70,95,255,0.3) 0%, rgba(100,160,255,0.15) 40%, transparent 70%);
          animation: orbPulse 4s ease-in-out infinite alternate;
          pointer-events: none; z-index: 1;
        }
        @keyframes orbSpin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes orbPulse {
          0% { opacity: 0.5; transform: translate(-50%, -50%) scale(0.9); }
          100% { opacity: 0.9; transform: translate(-50%, -50%) scale(1.1); }
        }

        @media (prefers-reduced-motion: reduce) {
          .anim-logo-orb-sphere, .anim-logo-orb-inner { animation: none !important; }
        }
      `}</style>
    </>
  );
}
