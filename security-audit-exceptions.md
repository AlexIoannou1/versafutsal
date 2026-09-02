# Security audit exceptions

## `image-size` Metro development dependency

The registry currently reports two high-severity denial-of-service advisories for `image-size@1.2.1`:

- ICNS parser infinite loop
- JXL and HEIF parser infinite loops

The advisories report no patched release (`patched_versions: <0.0.0`). The dependency is pulled in only through Expo's Metro development/build tooling (`@expo/cli → @expo/metro → metro → image-size`), not the API server or shipped application runtime.

The vulnerable parsers process project assets during local Metro bundling. They are not used for player or venue-owner uploads, which are handled by the API image pipeline. Exploitation would therefore require a developer to add an untrusted ICNS, JXL, or HEIF file to the source tree and run Metro.

Re-evaluate this exception when Expo/Metro updates its `image-size` dependency or the registry publishes a patched release.