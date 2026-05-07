"use client";

import React from "react";
import dynamic from "next/dynamic";
import AnimatedLogo from "./AnimatedLogo";

/**
 * OrbAnimatedLogo — Real WebGL Orb surrounding AnimatedLogo.
 * Mimics the splash-screen orb effect from AppSplashScreen.
 * Use this for chat welcome & bot avatar where visual impact matters.
 *
 * The Orb renders in a circular container sized at 2× the logo,
 * with the AnimatedLogo centered on top.
 */

const Orb = dynamic(() => import("./backgrounds/Orb"), { ssr: false });

interface OrbAnimatedLogoProps {
  /** Logo SVG size in px */
  size?: number;
  /** Orb container size — defaults to size * 2.2 */
  orbSize?: number;
  animate?: boolean;
  playFace?: boolean;
  skipFlyIn?: boolean;
  loop?: boolean;
}

export default function OrbAnimatedLogo({
  size = 48,
  orbSize,
  animate = true,
  playFace = true,
  skipFlyIn = true,
  loop = true,
}: OrbAnimatedLogoProps) {
  const containerSize = orbSize ?? Math.round(size * 2.2);

  return (
    <div
      className="orb-animated-logo-wrap"
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: containerSize,
        height: containerSize,
      }}
    >
      {/* ═══ WebGL Orb — circular cutout ═══ */}
      <div
        className="pointer-events-none"
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          overflow: "hidden",
          animation: "orbLogoReveal 1s cubic-bezier(0.16, 1, 0.3, 1) both",
          opacity: 0,
          transform: "scale(0.5)",
        }}
      >
        <Orb
          hue={0}
          hoverIntensity={0.15}
          rotateOnHover={false}
          forceHoverState
          backgroundColor="#0a0e1a"
          color1="#2563EB"
          color2="#F59E0B"
          color3="#0C2D5A"
          innerRadius={0.35}
        />
      </div>

      {/* ═══ AnimatedLogo — centered on top ═══ */}
      <div style={{ position: "relative", zIndex: 2, display: "inline-flex" }}>
        <AnimatedLogo
          size={size}
          animate={animate}
          playFace={playFace}
          skipFlyIn={skipFlyIn}
          loop={loop}
        />
      </div>

      <style jsx>{`
        @keyframes orbLogoReveal {
          0% {
            opacity: 0;
            transform: scale(0.5);
          }
          100% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  );
}
