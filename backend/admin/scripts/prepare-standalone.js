const path = require('path');
const fs = require('fs/promises');

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  await fs.cp(src, dest, { recursive: true, force: true });
}

async function main() {
  const root = path.resolve(__dirname, '..');

  const nextDir = path.join(root, '.next');
  const standaloneDir = path.join(nextDir, 'standalone');

  const staticSrc = path.join(nextDir, 'static');
  const staticDest = path.join(standaloneDir, '.next', 'static');

  const publicSrc = path.join(root, 'public');
  const publicDest = path.join(standaloneDir, 'public');

  if (!(await exists(standaloneDir))) {
    throw new Error('Missing .next/standalone. Did you run `npm run build`?');
  }

  if (await exists(staticSrc)) {
    await copyDir(staticSrc, staticDest);
    // eslint-disable-next-line no-console
    console.log(`[prepare-standalone] Copied ${staticSrc} -> ${staticDest}`);
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[prepare-standalone] Skipped: ${staticSrc} not found`);
  }

  if (await exists(publicSrc)) {
    await copyDir(publicSrc, publicDest);
    // eslint-disable-next-line no-console
    console.log(`[prepare-standalone] Copied ${publicSrc} -> ${publicDest}`);
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[prepare-standalone] Skipped: ${publicSrc} not found`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[prepare-standalone] Failed:', err);
  process.exit(1);
});
