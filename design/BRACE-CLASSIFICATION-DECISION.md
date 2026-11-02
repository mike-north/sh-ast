# Brace classification without changing faithful parse records

`resolveWord` reports potential brace expansion using the pinned mvdan/sh
v3.13.1 implementation. It does not expand words, mutate caller records, or add
`BraceExp` nodes to parser output. The observation is internal; no public
`splitBraces` API is required.

## What upstream establishes

`syntax.SplitBraces` rewrites its private Word copy. Its boolean is not a
predicate for valid expansions: `{a}`, `{}`, `a{b`, and `{a,b` all return true,
yet yield no BraceExp. The binding therefore examines the resulting top-level
parts for actual BraceExp nodes. Unclosed outer braces can contain valid inner
expansions; the result, not a balanced-bracket heuristic, decides those cases.

Upstream's escape handling also differs from Bash. On the same parsed Words,
`expand.Fields` (which delegates to FieldsSeq) yields two words for
`\{a,b\}` and `a{b\,c}`, whereas Bash yields one literal word. There is no
BraceExp flag that restores escape protection later. The executable probe and
retained observations live in `validation/brace-classification/`.

The analyzer does not repair upstream grammar with a second implementation.
For a candidate with backslash uncertainty it reports `unsupported`. A narrow
lexical prerequisite can prove no expansion is possible when there is no
unescaped opening brace in any top-level literal: quotes protect their own
contents, and each backslash protects the following character. This preserves
static results for fully escaped openings and odd backslash parity within a
literal part. Adjacent literal records concatenate, so parity is carried across
their boundaries. Any unquoted backslash escape crossing a part boundary
reports unsupported, even when no top-level literal brace is present. Such a
split can expose syntax inside a following quoted part; per-part unquoting
cannot independently establish the resulting static text. This is a deliberate
conservative boundary for caller-constructed records, not another tokenizer. An even
backslash run exposes an opening brace, but the candidate remains unsupported
because of the upstream escape discrepancy. Mixed quoted parts remain in the
Word sent to upstream; no textual flattening invents adjacency or syntax.

This deliberately narrows issue #38's acceptance criteria: do not treat the
SplitBraces boolean as a semantic fact, and do not promise static results for
all escaped negative cases. This conservative uncertainty is distinct from
confirmed potential brace expansion.

## Dialect and mutation boundaries

A bare Word carries no parser dialect or shell option state. Brace recognition
therefore reports potential expansion in supporting dialects, even for records
parsed as POSIX. It does not assert that POSIX sh performs brace expansion.
This follows the analyzer's existing conservative defaults. No dialect option
or new policy model is introduced.

A necessary-condition filter avoids entering WASM for ordinary words. Results
are never cached by object identity: callers can edit syntax records between
observations. Reconstructed Go values provide the isolation boundary, so the
upstream rewrite cannot change JS records, aliases, or position snapshots.

## Independent evidence

Outcome tests use hand-derived Bash quoting/brace expectations and explicit
conservative `unsupported` results for uncertain inputs. Go tests separately
compare the transport observation with the pinned upstream operation and
assert its malformed-word behavior. The probe compares actual Bash output and
upstream expansion only to document the discrepancy; no runtime expansion or
shell execution is part of the library.

## Composed-record review boundary

Review exercised complete mutable Words, not only parser-produced shapes.
The existing analyzer could falsely report static text when an unquoted escape
was split across Lit or quoted parts. The first brace classifier inherited that
limitation by applying its prerequisite independently to each Lit; a later
brace-only guard still missed quoted content exposed by a split escape. The
accepted boundary rejects every unquoted escape crossing a part boundary as
unsupported. It does not depend on seeing braces first, and it preserves ordinary
parsed escapes that remain within a Lit. Regression tests retain the exact
reviewer cases and a matrix of Lit, single-quoted, double-quoted, empty-quoted,
and expansion boundaries. No recursive grammar reconstruction is added.

## Reason precedence for supplied BraceExp records

An existing BraceExp does not bypass whole-word uncertainty preflight. A split
escape can invalidate apparent quoting boundaries, and an independently
escape-uncertain brace candidate still falls within the declared unsupported
boundary. Both results remain non-static. Independently quoted, fully escaped,
and ordinary escaped-literal siblings preserve the known brace reason.

The reason descriptions identify why a word is not static; they do not promise
that every present feature wins over other reasons. Existing triggering-tilde
and earlier-glob resolution can precede a supplied BraceExp. Accordingly, the
review suggestion to short-circuit before observation was rejected: it would
bypass the approved unconditional split-escape guard. Tests pin the mixed
records, source immutability, and unchanged ordinary reason ordering.
