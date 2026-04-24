# Vite package smoke test

This mini project consumes a locally packed npm tarball through:

```json
"nimio-player": "file:.local-package/nimio-player-local.tgz"
```

Run from the repository root:

```bash
npm run test:pkg:vite
```

The root script builds `pkg`, installs this mini project's dependencies, and
runs the Vite production build. The tarball in `.local-package` is generated
from `npm pack` and is ignored by git.

For manual playback testing:

```bash
npm run dev:pkg:vite
```

The page loads `wss://demo-nimble.softvelum.com/live/bbb` by default.
