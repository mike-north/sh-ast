# Staged Release B changeset

This is reviewed release-note content, intentionally outside the active changeset
directory. Activate only after the Release A 0.4.0 release is published and its
changeset consumed, following [the staged procedure](../RELEASE-PLAN.md#staged-release-preparation).
Do not rename this file into `.changeset` while the A minor change is still pending.

Proposed active file contents, to reconcile with the completed B contract:

```md
---
'sh-ast': minor
---

Add synchronous traversal and printing for the faithful mvdan/sh v3.13.1 syntax model. Traversal preserves upstream callback order and control; printing uses the current edited tree and the pinned printer options. These operations support transformations while original parse-position snapshots remain tied to their original source.
```
