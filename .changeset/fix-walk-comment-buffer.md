---
'sh-ast': minor
---

Preserve stored comment text when a `walk` callback edits a comment copy backed by a Node.js `Buffer`. Byte-backed comment copies expose a plain `Uint8Array` with independent storage, including when the stored text is a `Buffer`. When resizing leaves a view out of bounds, the copied text is an empty `Uint8Array`.

Uses the maintained Go syntax fork at revision 38f23b706eb32d08a3797af4ea90a9ea8e5992c1 (based on mvdan/sh v3.14.1).
