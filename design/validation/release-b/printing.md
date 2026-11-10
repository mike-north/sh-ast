# Release B printing validation

`printSync(node, options)` rebuilds the current faithful syntax record in Go and
collects the output of a fresh mvdan/sh v3.13.1 printer. An edited quoted argument
or operator changes the output even when its parsed positions still describe the
old source. The operation does not reparse or replay source text.

## Operation contract

The return value is `GoString`: valid UTF-8 output is a string, while other output
is a `Uint8Array`. Supported roots are File, Stmt, Word, Assign, every Command,
and every WordPart. Other real Node families are representable inputs but receive
the ordinary unsupported-root error from upstream. File printing appends a
newline, including for an empty file; a Word or Stmt does not acquire that File
newline.

All eight upstream options are passed through: Indent, BinaryNextLine,
SwitchCaseIndent, SpaceRedirects, KeepPadding, Minify, SingleLine and
FunctionNextLine. Indent retains the WASM Go uint64 domain through safe numbers
and bigint. Explicit zero selects tabs; all boolean defaults are false.
KeepPadding retains upstream's documented best-effort and deprecated status.
Each call creates a fresh printer, so options and printer state do not leak into
later calls.

| Condition                                                    | Public failure                                      |
| ------------------------------------------------------------ | --------------------------------------------------- |
| A record or option cannot be represented by the binding      | InputError                                          |
| Upstream Print returns an error, including unsupported roots | PrintError with code SH_AST_SYNTAX_PRINT            |
| Upstream Print panics on a representable value               | PrintPanicError with code SH_AST_SYNTAX_PRINT_PANIC |
| Transport or response invariants fail                        | ShInternalError                                     |

Both printing failures retain `Message: GoString` separately from the text used
for `Error.message`. Minify together with SingleLine returns PrintError before
root dispatch, even for a typed-nil Word. A typed-nil Word without that option
combination panics; a typed-nil Comment is an unsupported root. These cases remain
distinct, and a later successful parse or print still works.

There is no arbitrary writer API, printer reuse API, or partial-output protocol.
Failures expose their upstream kind and message, not a buffer from a partly
completed print.

## Independent expectations

The Go regression suite invokes pinned upstream `NewPrinter(...).Print` directly
on native syntax values, independently of operation dispatch, wire decoding and
option decoding. Its root inventory is transcribed from `Printer.Print` and the
pinned Command and WordPart implementers. It exercises 29 supported root families
and 14 unsupported families, including a BraceExp produced by upstream
SplitBraces. Generated schema enumeration does not establish expected support.

The suite covers every formatting option's observable effect, explicit defaults,
combined options, comments and heredocs, Unicode text, edited arguments and
operators, constructed nodes with zero positions, stale parsed positions,
recovered parser output, typed nils, partial records, independent failure kinds,
and reuse after failure.

The TypeScript suite additionally pins hand-specified strings and responses
obtained from independent native printer invocations. Its boundaries reject
malformed trees, invalid uint64 options, unknown options, cycles, unpaired
surrogates and malformed transport results. A transport probe checks that a
bigint above the safe-number range reaches the wire as its exact decimal value.

Three formatting details are explicit upstream observations:

- An empty File prints `"\n"`.
- SingleLine can move a following command onto the heredoc command line, while
  retaining the required newlines around the heredoc body and terminator.
- Parsing `(foo |` with RecoverErrors 2 and printing the result yields `(foo |)\n`.

The byte-output contract does not promise that every input byte survives upstream
formatting. Go's tabwriter uses `0xff` as an escape marker and StripEscape removes
it: a Lit containing bytes `[0x78, 0xff]` prints `"x"`. The separate `[0x78, 0xfe]`
fixture prints those exact bytes and proves that malformed UTF-8 output survives
the bridge as bytes.

## Resource boundary

The binding reconstructs a complete tree and collects complete output. Large
Indent values and constructed trees can consume substantial time and memory.
Preserving uint64 does not establish resource safety for every value: maximum
uint64 reaches upstream's negative-width panic on the pinned WASM target, while
large positive widths can amplify output.

A bounded output writer alone would not reliably stop indentation work promptly:
upstream emits repeated WriteByte calls through a buffered writer without using
each returned error to terminate those loops. The implementation therefore makes
no output-cap or unbounded-input safety claim and adds no invented indentation
limit. The existing parser depth guard remains unchanged; it does not validate
arbitrary constructed printing inputs. Resource probes use bounded workloads;
giant output allocation is not part of routine tests.

## Validation evidence and integration boundary

The Go tests were run before operation implementation and failed with
`unknown syntax operation "print"`; the TypeScript tests were then run before
module implementation and failed to import `syntax-print`. Their local red logs
are retained in `work/printer-before.log` and `work/print-ts-red.log`.

The implementation slice passes:

- `go test ./...` and `go vet ./...` in the shim module.
- Actual js/wasm internal Go tests through `go_js_wasm_exec`.
- 50 printing runtime tests across two TypeScript suites.
- All 566 package runtime tests across 27 suites after building package outputs.
- Source type checking, focused source and runtime lint, formatting, and an
  isolated tsd probe of the exact new exported declarations.

Runtime observations use a disposable Linux amd64 Go 1.26.5 build. That binary is
not part of this source and test commit. Public barrel exports, canonical
optimized WASM, API rollups, documentation generation, installed-package
consumer checks and final release gates belong to the assembled Release B
candidate. This record establishes the printing slice's behavior and local
regressions; it is not evidence of publication or final candidate acceptance.
