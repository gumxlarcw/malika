import React from "react";

/**
 * Shell-free layout for the public landing page.
 *
 * The `(admin)` group wraps its pages in the sidebar, top bar, and mobile bottom
 * nav. The landing page brings its own header and footer, so it sits in its own
 * route group with nothing around it.
 */
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
