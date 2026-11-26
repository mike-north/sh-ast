---
'sh-ast': minor
---

Preserve stored comment text when a `walk` callback edits a comment copy backed by a Node.js `Buffer`. Copies of byte-backed comment text have independent storage.

Uses the maintained Go syntax fork at revision 38f23b706eb32d08a3797af4ea90a9ea8e5992c1 (based on mvdan/sh v3.14.1).
