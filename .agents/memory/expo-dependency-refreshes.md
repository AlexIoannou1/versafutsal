---
name: Expo dependency refreshes
description: Metro's watcher must be recreated after pnpm replaces an Expo native package.
---

After aligning Expo dependencies with `expo install --fix`, restart the Expo workflow before evaluating device startup.

**Why:** pnpm can atomically replace a native module directory while Metro is watching it. The inherited watcher then crashes with an `ENOENT` path error even though the installed dependency set is valid.

**How to apply:** Run Expo's compatibility check, install only the SDK-supported releases, then perform one clean managed-workflow restart and verify both iOS and Android manifests and bundles through the public packager route.