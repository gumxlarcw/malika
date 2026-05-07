export async function isReachable(url: string, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok || res.status === 400 || res.status === 404;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function disableAnimations(page: { addStyleTag: (arg0: { content: string }) => Promise<void> }) {
  try {
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          transition: none !important;
          animation-duration: 0s !important;
          animation-delay: 0s !important;
        }
      `,
    });
  } catch {
    // Ignore CSP restrictions in hardened environments.
  }
}
