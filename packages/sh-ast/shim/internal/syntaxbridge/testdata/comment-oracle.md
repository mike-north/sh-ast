# Comment advancement compatibility oracle

`comment-oracle.json` records 140 inputs/options (14 grammar and reader cases,
five pinned dialects, retained/discarded comments), each at seven reader chunk
sizes. Hashes were captured from pristine `mvdan.cc/sh/v3 v3.14.1`, Go 1.26.10,
in an isolated module without a `replace` directive, before changing comment
advancement. Its module checksum is
`h1:bXkhQWNHCs0KZEChF8hYS6FC+T2N9mUZLbQv9blditI=`.

The SHA-256 input is the compact JSON produced by `commentSnapshot`: complete
upstream `typedjson` File output, including all node Pos/End and stored position
fields, followed by exact error type/text and ParseError byte coordinates.
The snapshot helper is serialization only; the independent pristine parser
supplies expected semantics. Do not regenerate these hashes from the maintained
parser under test.

Reader chunk sizes intentionally have separate hashes. Pristine upstream's
`StopAt` behavior can differ at refill boundaries. This change preserves that
behavior rather than silently folding a separate lexer fix into comment
iteration. Other cases cover initial/inline/trailing comments, blank lines,
CRLF, multibyte text, hash literals/parameter operators, queued and reentrant
heredocs, malformed syntax, terminal EOF, reader failure, and backticks.
