---
name: App Storage bucket verification
description: Replit App Storage bucket changes can leave a stale or unauthorized runtime bucket target.
---

After creating or selecting a different App Storage bucket, confirm the app's `DEFAULT_OBJECT_STORAGE_BUCKET_ID` securely targets that bucket and restart the service before relying on uploads. Then perform a temporary write, read, and delete through the supported storage client.

**Why:** Provisioning can report success while the running service still receives a bucket target without `storage.objects.create` permission.

**How to apply:** Treat an object write/read/delete lifecycle as a deployment prerequisite for any feature that persists user files. Never record the bucket identifier in project memory.