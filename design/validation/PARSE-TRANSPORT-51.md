# Parse transport cost (#51)

## Contract and boundaries

Baseline is `1b6f23d` (sh-ast 0.7.0 runtime). The public result of `parseSync` and
`parseWithPositionsSync` is unchanged: the same records, member order, `GoString`
values (strings and `Uint8Array`), typed nils, frozen position snapshots and
error classes, messages, fields and precedence. The record shape, the `Type`
discriminator and the public API are untouched; nothing is decoded lazily.

Only the internal parse response changes. Old/new JS and WASM pairs are not
supported; they ship as one package.

- **ASCII text.** Streamed strings escape every non-ASCII character as `\u`
  (surrogate pairs beyond the BMP). ASCII keeps encoding/json's escaping, and
  the small marshaled failure envelope beside a partial File is escaped the same
  way. JSON.parse yields identical JavaScript strings; JavaScript decodes a
  one-byte response instead of a two-byte one.
- **Compact File positions.** In parse and parse-with-positions responses
  (including partial Files beside parser errors), each `syntax.Pos` in the File
  is `[Offset,Line,Col,Flags]` with the sidecar's flags (bit 0 IsValid, bit 1
  IsRecovered, bit 2 OffsetOverflow). Error envelope positions, the bounds
  sidecar, and every other operation keep their spelling. Generic `Encode`/
  `Append` keep object positions, so Go round-trip tests and the printer input
  format are unaffected.
- **One JavaScript validation pass.** `restoreSyntaxFile` performs exactly the
  `isSyntaxFile` checks while replacing each well-formed tuple by the identical
  six-member record; a malformed tuple fails validation (`ShInternalError`). A
  fresh JSON.parse tree is acyclic and unshared, so this pass tracks no ancestor
  set. Caller-input validation is unchanged.
- **Encoder internals.** Per-type wire plans are prebuilt once from the
  registry; cycle tracking scans the first 32 path entries and hashes only deeper
  ones; positions are read without an interface allocation; responses are
  composed in one retained scratch buffer (bounded at 32 MiB) and copied once.
  Bounds observation runs under one recovery scope and resumes after a panic at
  the next call, preserving the exact Pos-then-End call sequence and failures.
- **Smaller JS costs.** The response terminator is found with a native
  `indexOf`; the byte-restoration walk runs only if the response text contains
  `"Bytes"` (the producer never escapes ASCII key letters, so a Bytes key always
  appears literally); schema field lists are cached per type.
- **Diagnostic export.** `syntaxLastParseNanoseconds` reports the most recent
  upstream `Parser.Parse` duration so the benchmark can split WASM time into
  parse and encode. No API result depends on it.

## Independent tests

| Contract                                                                                  | Ground truth / test                                                                                                                                         |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete parse/sidecar response bytes, five dialects, Unicode, bytes, recovery, errors    | Frozen legacy envelope converted by the test-only `wireformtest` oracle (regex/rune rewrite, no production code): `TestStreamingParseMatchesFrozenEnvelope` |
| Syntax encoder bytes and errors                                                           | Frozen legacy encoder + ASCII oracle: `TestStreamingSyntaxMatchesFrozenEncoder`                                                                             |
| Hand-derived tuple spellings (multibyte end column, invalid zero, recovered sentinel = 6) | `TestParsedFilePositionsUseCompactTuples`                                                                                                                   |
| Hand-written non-ASCII escapes, decoded back by encoding/json                             | `TestStreamingStringEscapesNonASCII`; whole responses ASCII: `TestParseResponsesAreASCII`                                                                   |
| Exact cycles across the scanned/hashed ancestry boundary; shared deep children accepted   | `TestStreamingDeepAncestryIsExact` plus existing cycle tests                                                                                                |
| Pos-before-End order and independent failures                                             | Existing `TestStreamingSnapshotMethodOrder`, snapshot and compact sidecar suites                                                                            |
| Parsed File equals an independent upstream parse                                          | `TestParseDefaultsAndOptionsMatchUpstream` (oracle expands tuples before syntax decoding)                                                                   |
| Byte-restoration fast path                                                                | `syntax-wire-decode.test.ts` against the retired copying decoder, including `"Bytes"` inside string values                                                  |
| Public output identical to the published release                                          | `tools/benchmark/identity.mjs` against `sh-ast@0.7.0` from the registry: 341 cases, 0 mismatches                                                            |

## Measurement

`pnpm benchmark` gains `parse-stages` and `parse-with-positions-stages` phases,
the `consumer-m2` fixture and the published 0.7.0 artifact; see
[the harness README](../../tools/benchmark/README.md). The measurements below
are from a 4-vCPU Linux VM, not the benchmark machine named in #51, so they show
relative change only.

Method: `consumer-m2`, Bash, `KeepComments: true`; 8 rounds of fresh worker
processes (`tools/benchmark/worker.mjs`), arm order rotating per round, 5 excluded
warmups and 30 measured calls per process; values are the median of the 8
process medians (ms). "Before" is the 0.7.0 runtime with only the parse timer
added (needed to split its WASM time); its plain phases match published 0.7.0
within noise. Upstream parse time is unchanged code; its small difference
reflects garbage-collector state, since the new encoder allocates far less.

| Measure                    | Published 0.7.0 | Before | After |              Change |
| -------------------------- | --------------: | -----: | ----: | ------------------: |
| `parseSync`                |           54.39 |  53.31 | 19.30 | −34.01 ms (−63.8 %) |
| `parseWithPositionsSync`   |           70.59 |  69.53 | 29.29 | −40.24 ms (−57.9 %) |
| parse-stages: input        |                 |   0.42 |  0.42 |               0.0 % |
| parse-stages: wasm         |                 |  32.30 |  9.55 |             −70.5 % |
| parse-stages: parse        |                 |   2.80 |  2.22 |             −20.6 % |
| parse-stages: encode       |                 |  29.51 |  7.39 |             −75.0 % |
| parse-stages: transfer     |                 |   6.99 |  0.76 |             −89.1 % |
| parse-stages: decode       |                 |  13.15 |  6.66 |             −49.3 % |
| positions-stages: input    |                 |   0.44 |  0.45 |              +3.0 % |
| positions-stages: wasm     |                 |  37.11 | 15.10 |             −59.3 % |
| positions-stages: parse    |                 |   2.57 |  2.11 |             −18.2 % |
| positions-stages: encode   |                 |  34.32 | 13.03 |             −62.0 % |
| positions-stages: transfer |                 |   8.27 |  0.88 |             −89.4 % |
| positions-stages: decode   |                 |  23.31 | 13.62 |             −41.6 % |

The 10 ms acceptance target applies to the benchmark machine and is not
established by these VM numbers. Remaining cost on the VM is dominated by
reflective encoding (~7 ms), JSON.parse plus File validation (~6.7 ms), and for
positions the upstream bound calls in WASM and snapshot construction.

## Large-heap runtime abort

Independent verification found that head `54c286b`, built with go1.26.5, aborted
the Go runtime ("found bad pointer in Go heap") on a valid sequence of large
public calls. The cause is golang/go#80472: on js/wasm, `runtime.itabInit` stored
method PCs through a GC write barrier, and those PCs overlap heap addresses once
the heap has grown. It is fixed in the Go toolchain now pinned on main (#64);
this change carries no workaround for it.

`tools/benchmark/heap-sequence.integration.mjs` runs the reported parse sequence
at eight sizes in fresh processes. On 54c286b (go1.26.5) it failed in 3/3 runs,
at k = 100 and 120 each time. The print path is covered by main's
`packages/sh-ast/test/go-runtime-abort.test.ts`.
