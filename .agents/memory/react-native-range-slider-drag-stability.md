---
name: React Native range-slider drag stability
description: Keep custom range slider thumbs predictable across React Native and web touch targets.
---

For custom two-thumb sliders, keep each thumb's responder stable with refs, record its value when the drag begins, and calculate the next value from `gestureState.dx`.

**Why:** `nativeEvent.locationX` can be relative to changing nested touch targets, while re-creating responders as controlled values change can make a drag jump or switch handles.

**How to apply:** Give each thumb a sufficiently large hit target, clamp the value against the other thumb, and use refs for the current range, callback, track width, and drag-start value.