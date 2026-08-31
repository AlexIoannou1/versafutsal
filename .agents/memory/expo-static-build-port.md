---
name: Expo static build port assumption
description: The Expo static build script assumes Metro can use port 8081, so concurrent local services can make its non-interactive port prompt fail.
---

When validating the Expo static build, run it with port 8081 available; the development workflow can still use its separate proxy/Metro ports.

**Why:** The static build script starts Expo non-interactively and does not accept the prompt to move when another workflow already occupies port 8081.

**How to apply:** Treat a build failure at the interactive “Use port 8082 instead?” prompt as an environment port collision, not as an application bundle failure. Confirm the running Expo workflow and its web/Android bundle logs separately.