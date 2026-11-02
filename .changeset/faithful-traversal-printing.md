---
'sh-ast': minor
---

Add synchronous traversal and printing for the faithful mvdan/sh v3.13.1 syntax model. Traversal preserves upstream callback order and control using ordinary TypeScript arrays: active lists capture their array and extent, read future slots live, ignore appends, and retain their captured array when its owner field is replaced. Destructive active-array edits are unsupported; Go slice capacity, reslicing, backing-store aliases and value-slot addresses are not modeled. Printing uses the current edited tree and the pinned printer options. These operations support transformations while original parse-position snapshots remain tied to their original source.
