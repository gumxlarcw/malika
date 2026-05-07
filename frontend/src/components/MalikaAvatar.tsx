"use client";

import React, { Suspense } from "react";
import dynamic from "next/dynamic";

/**
 * MalikaAvatar — BPS MALIKA logo sitting on top of the REAL WebGL Orb.
 *
 * Entrance animation (like the splash AnimatedLogo):
 *   1. Orb fades/scales in
 *   2. Logo background box scales in
 *   3. Bars fly in from different directions (staggered)
 *   4. After entrance (~1.2s), bars start the ongoing pulse animation
 *
 * Fly-in transforms live on <g> wrappers, pulse scaleY on <rect> inside,
 * so they don't conflict.
 *
 * BPS Orb colours: blue #2563EB · amber #F59E0B · navy #0C2D5A
 */

const Orb = dynamic(() => import("@/components/backgrounds/Orb"), {
  ssr: false,
  loading: () => null,
});

interface MalikaAvatarProps {
  /** Outer diameter in px (default 44) */
  size?: number;
  /** Extra CSS class on the outermost wrapper */
  className?: string;
  /** Play entrance animation (bars fly in, orb fades). Default true */
  animate?: boolean;
}

export default function MalikaAvatar({
  size = 44,
  className = "",
  animate = true,
}: MalikaAvatarProps) {
  // Logo takes ~38% of the total size — leaves room for the orb surround
  const logoSize = Math.round(size * 0.38);

  return (
    <div
      className={`flex-shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        position: "relative",
        borderRadius: "50%",
        overflow: "hidden",
      }}
    >
      {/* ── Real WebGL Orb — fades/scales in ── */}
      <div
        className="av-orb-wrap"
        style={{
          position: "absolute",
          inset: 0,
          ...(animate
            ? { opacity: 0, animation: "avOrbIn 0.8s ease-out 0.1s both" }
            : { opacity: 1 }),
        }}
      >
        <Suspense fallback={null}>
          <Orb
            hoverIntensity={0.15}
            rotateOnHover={false}
            forceHoverState={false}
            backgroundColor="#000000"
            color1="#2563EB"
            color2="#F59E0B"
            color3="#0C2D5A"
            innerRadius={0.12}
          />
        </Suspense>
      </div>

      {/* ── BPS Logo (centred on the orb) ── */}
      <svg
        width={logoSize}
        height={logoSize}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          zIndex: 2,
          display: "block",
          overflow: "visible",
          filter: "drop-shadow(0 0 2px rgba(0,0,0,0.5))",
        }}
      >
        {/* Background rounded square — scales in */}
        <g
          style={{
            transformOrigin: "16px 16px",
            ...(animate
              ? { opacity: 0, animation: "avLogoBoxIn 0.7s cubic-bezier(0.16,1,0.3,1) 0.3s both" }
              : { opacity: 1 }),
          }}
        >
          <path
            d="M0 8.42105C0 3.77023 3.77023 0 8.42105 0H23.5789C28.2298 0 32 3.77023 32 8.42105V23.5789C32 28.2298 28.2298 32 23.5789 32H8.42105C3.77023 32 0 28.2298 0 23.5789V8.42105Z"
            fill="#465FFF"
          />
        </g>

        {/* Bar 1 — left, tallest — flies in from TOP-LEFT */}
        <g
          style={{
            transformOrigin: "10px 16px",
            ...(animate
              ? { opacity: 0, animation: "avBarFromTopLeft 0.75s cubic-bezier(0.16,1,0.3,1) 0.5s both" }
              : { opacity: 1 }),
          }}
        >
          <rect
            className="avatar-bar avatar-bar-1"
            x="8.42"
            y="6.74"
            width="3.37"
            height="18.53"
            rx="1.68"
            fill="white"
            style={{ transformOrigin: "10.1px 25.26px" }}
          />
        </g>

        {/* Bar 3 — right, medium — flies in from TOP-RIGHT */}
        <g
          style={{
            transformOrigin: "22.7px 17px",
            ...(animate
              ? { opacity: 0, animation: "avBarFromTopRight 0.75s cubic-bezier(0.16,1,0.3,1) 0.7s both" }
              : { opacity: 1 }),
          }}
        >
          <rect
            className="avatar-bar avatar-bar-3"
            x="21.05"
            y="9.26"
            width="3.37"
            height="16.0"
            rx="1.68"
            fill="white"
            fillOpacity="0.7"
            style={{ transformOrigin: "22.74px 25.26px" }}
          />
        </g>

        {/* Bar 2 — middle, shortest — flies in from BOTTOM (last, dramatic) */}
        <g
          style={{
            transformOrigin: "16.4px 19px",
            ...(animate
              ? { opacity: 0, animation: "avBarFromBottom 0.75s cubic-bezier(0.16,1,0.3,1) 0.85s both" }
              : { opacity: 1 }),
          }}
        >
          <rect
            className="avatar-bar avatar-bar-2"
            x="14.74"
            y="13.47"
            width="3.37"
            height="11.79"
            rx="1.68"
            fill="white"
            fillOpacity="0.9"
            style={{ transformOrigin: "16.43px 25.26px" }}
          />
        </g>
      </svg>

      <style jsx>{`
        /* ── Entrance: Orb fades + scales in ── */
        @keyframes avOrbIn {
          0%   { opacity: 0; transform: scale(0.4); }
          100% { opacity: 1; transform: scale(1); }
        }

        /* ── Entrance: Logo box scales + rotates in ── */
        @keyframes avLogoBoxIn {
          0%   { opacity: 0; transform: scale(0.3) rotate(-10deg); }
          100% { opacity: 1; transform: scale(1) rotate(0deg); }
        }

        /* ── Entrance: Bar 1 from top-left ── */
        @keyframes avBarFromTopLeft {
          0%   { opacity: 0; transform: translate(-12px, -12px) scale(0.5) rotate(-20deg); }
          70%  { opacity: 1; transform: translate(0.5px, 0.5px) scale(1.02) rotate(1deg); }
          100% { opacity: 1; transform: translate(0, 0) scale(1) rotate(0deg); }
        }

        /* ── Entrance: Bar 3 from top-right ── */
        @keyframes avBarFromTopRight {
          0%   { opacity: 0; transform: translate(12px, -12px) scale(0.5) rotate(20deg); }
          70%  { opacity: 1; transform: translate(-0.5px, 0.5px) scale(1.02) rotate(-1deg); }
          100% { opacity: 1; transform: translate(0, 0) scale(1) rotate(0deg); }
        }

        /* ── Entrance: Bar 2 from bottom ── */
        @keyframes avBarFromBottom {
          0%   { opacity: 0; transform: translate(0, 14px) scale(0.5); }
          70%  { opacity: 1; transform: translate(0, -0.5px) scale(1.02); }
          100% { opacity: 1; transform: translate(0, 0) scale(1); }
        }

        /* ── Ongoing pulse (starts after entrance completes ~1.6s) ── */
        .avatar-bar {
          will-change: transform;
        }
        .avatar-bar-1 {
          animation: avBarPulse1 8s ease-in-out 1.6s infinite;
        }
        .avatar-bar-2 {
          animation: avBarPulse2 8s ease-in-out 2.2s infinite;
        }
        .avatar-bar-3 {
          animation: avBarPulse3 8s ease-in-out 2.8s infinite;
        }

        @keyframes avBarPulse1 {
          0%   { transform: scaleY(1); }
          15%  { transform: scaleY(0.62); }
          30%  { transform: scaleY(0.92); }
          45%  { transform: scaleY(0.70); }
          58%  { transform: scaleY(1); }
          60%, 100% { transform: scaleY(1); }
        }
        @keyframes avBarPulse2 {
          0%   { transform: scaleY(1); }
          15%  { transform: scaleY(1.38); }
          30%  { transform: scaleY(0.78); }
          45%  { transform: scaleY(1.22); }
          58%  { transform: scaleY(1); }
          60%, 100% { transform: scaleY(1); }
        }
        @keyframes avBarPulse3 {
          0%   { transform: scaleY(1); }
          15%  { transform: scaleY(0.72); }
          30%  { transform: scaleY(1.22); }
          45%  { transform: scaleY(0.62); }
          58%  { transform: scaleY(1); }
          60%, 100% { transform: scaleY(1); }
        }

        @media (prefers-reduced-motion: reduce) {
          .avatar-bar,
          .av-orb-wrap {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
