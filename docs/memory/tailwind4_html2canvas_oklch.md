---
name: Tailwind 4 + html2canvas oklch incompatibility
description: html2canvas v1.4.1 throws on oklch() color functions emitted by Tailwind 4. Use html2canvas-pro (drop-in fork) instead.
type: feedback
originSessionId: 701d1992-8b19-4e01-ae1b-c294cbda954f
---
Any DOM-to-canvas capture inside a Tailwind 4 build will fail unless the library understands `oklch()`/`oklab()`/`color-mix()`. Tailwind 4's default theme normalizes every color through OKLCH, so even a node that "looks" hex in source ends up with `oklch(...)` in `getComputedStyle`.

**Why:** `html2canvas@1.4.1` (last released 2022) has a custom CSS color parser that throws on the first non-RGB/HSL color it sees. The capture aborts and the whole PNG fails. We hit this on `peta-tematik` after introducing Tailwind 4 classes (`bg-white`, `border-gray-200`, palette swatches) inside `#peta-tematik-export-area`. Earlier versions of the page worked because the export node used only `var(--pt-*)` CSS variables that resolved to hex literals.

**How to apply:** Use `html2canvas-pro` (`^2.0.2` as of 2026-05-07) — same API, supports oklch. Don't pin `html2canvas` (the unmaintained one) anywhere new. If you see a brand-new "tainted canvas" or "unsupported color" error from html2canvas in this repo, the answer is almost always to switch to the pro fork, not to hex-out the colors.

Frontend uses `--legacy-peer-deps` for installs (react-leaflet@4.2.1 expects react@18 but project is on react@19).
