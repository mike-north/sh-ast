# Faithful schema slice

Implementation base: `1ec9ac8`, carrying the design collection on upstream main
`7bdc6b1` (`sh-ast` 0.3.1). Upstream syntax pin: `mvdan.cc/sh/v3 v3.13.1`.

This slice adds the complete data-model projection alongside the existing
normalized projection. It does not switch the public parser, export the new
surface from the package entry point, alter the WASM codec, or implement Walk or
Print. Integration owns those changes and the resulting API reports/docs.

## Contract represented

- Mutable records use upstream field spelling and a concrete `Type` discriminator.
  Scalars and token positions are required. Pointers, interfaces, nil slices, and
  nil slice elements remain explicit. Auxiliary structs are excluded from Node.
- `GoString` retains string bytes through `string | Uint8Array`; `SyntaxPos` retains
  Offset, Line, Col, IsValid, and IsRecovered. Derived node bounds are operations,
  not stored writable fields.
- Named operator values retain exact upstream numeric identity. Each family also
  admits zero and its own branded raw uint32 values. Runtime construction/range
  checks remain an integration obligation. Language constants remain separate.
- Reflection metadata is readonly in declarations. The public entry point must
  freeze its shared runtime tables. Metadata order is not upstream Walk order.

## Tests written before implementation

The initial `go test ./...` in `tools/gen-visitor-keys` failed on the absent faithful
schema/classifier/renderers. The prewritten tests compare all 46 independently
enumerated upstream records through Go reflection, all six interface method sets,
and compiled representative values from every one of the 11 operator families.
The production generator uses `go/types`; neither expected field values nor
interface membership come from its schema output.

After building the unchanged package, `pnpm --filter sh-ast run test:types` failed
15 assertions because faithful declarations did not exist, covering mutable fields,
nil/default shapes, auxiliary exclusion, and operator-family distinctions.

Two later focused red-to-green checks refined the shared contract:

- Descriptor scalar/position type names initially serialized as empty strings;
  the new descriptor-wire test failed twice, then passed with explicit null.
- Readonly metadata tests failed four assignments before readonly declarations
  were emitted. An alias test failed before the union deduplicated ClbOut/RdrClob
  by numeric identity while retaining both exported constant names.

## Completed validation

- `go -C tools/gen-visitor-keys test ./...`: passed, including complete reflection
  coverage, interface membership, constants, unsupported-field rejection,
  declaration shape, descriptor wire shape, and alias preservation.
- `NX_SKIP_NX_CACHE=true pnpm check`: passed, including build, lint, type checking,
  existing API reports, formatting, knip, and syncpack. Five existing forgotten
  export warnings in the legacy parser/normalizer remain warnings.
- `NX_SKIP_NX_CACHE=true pnpm test`: 479 runtime tests across 17 files passed;
  tsd passed, including the new faithful model assertions.
- Regeneration was byte-identical across all 13 generated files. Existing
  normalized generated files have no diff. `git diff --check` passed.

The schema reproducibility CI workflow now runs the independent Go tests before
regeneration. This slice establishes a model and generation foundation; it is not
evidence of a complete Release A candidate or consumer acceptance.
