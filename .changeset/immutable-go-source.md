---
'sh-ast': minor
---

Consume the maintained Go syntax fork at immutable revision bbc7c4ace575d5de375726fdaa2a5c001c46564c (based on mvdan/sh v3.14.1), using the same source for schema generation and canonical Linux WASM. Native fixes and their upkeep now live in the Go fork; the binding no longer carries a semantic source patch stack. Builds verify resolved source identity and actual module-cache integrity.

Drop the constructed split-literal backslash and Zsh reverse-subscript compatibility holds. The selected Go printer doubles a trailing backslash, and reverse-subscript patterns remain opaque literal text: wildcard forms can parse, while nested substitutions are not exposed as syntax nodes. These are selected-Go observations, not a claim that opaque text contains no executable commands or that every printed program preserves shell behavior. Analysis extraction and its uncertainty contract are separate work.

Expose synchronous `splitBraces(word): boolean` as the faithful Go syntax transformation. It mutates the Word, returns the exact upstream boolean, and retains original WordPart objects that Go reuses. A true result can occur without a BraceExp. Remove the private analysis-specific brace-classification bridge operation; classification remains in the analysis layer.

Bound SplitBraces output transport to 256 nested Go struct records, checked iteratively after the upstream transformation and before recursive encoding. Deep valid results are refused as typed bridge failures without changing the caller's Word. JavaScript input/output stack exhaustion retains its original RangeError as the cause of ShInternalError. This is a bridge resource constraint, separate from grammar and parser work limits.
