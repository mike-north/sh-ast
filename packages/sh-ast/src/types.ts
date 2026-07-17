/**
 * Shell dialect (mvdan/sh `LangVariant`) to parse against. Mapped to
 * `LangVariant` by string name via `LangVariant.Set()` — never by numeric
 * value, since the bit-flag encoding of `LangVariant` is not a stable
 * contract across mvdan/sh versions. See design/ARCHITECTURE.md, "Parse
 * errors and dialects".
 *
 * @public
 */
export type ShellDialect = 'bash' | 'posix' | 'mksh' | 'bats' | 'zsh';

/**
 * Options accepted by {@link parseSync}.
 *
 * @public
 */
export interface ParseOptions {
  /**
   * The shell dialect to parse against.
   * @defaultValue `"bash"`
   */
  readonly dialect?: ShellDialect;

  /**
   * Filename used only to annotate error messages and positions; the source
   * is never read from disk.
   * @defaultValue `"input.sh"`
   */
  readonly filename?: string;
}

/**
 * A 1-based line/column position. Columns are UTF-16 code units, matching
 * JavaScript string indexing (see {@link ShNode.range}).
 *
 * @public
 */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/**
 * A normalized AST node produced by {@link parseSync}.
 *
 * `range` and `loc` are expressed in UTF-16 code units, so
 * `code.slice(node.range[0], node.range[1])` reproduces the node's exact
 * source text — even though mvdan/sh itself reports byte offsets and
 * byte-counting columns internally (see design/ARCHITECTURE.md's
 * "Serialization contract"). Every other field copied over from mvdan/sh's
 * typedjson tree keeps its original value but with the field name
 * lowercased (`Stmts` becomes `stmts`, `CondLast` becomes `condlast`, etc.).
 *
 * @public
 */
export interface ShNode {
  readonly type: string;
  readonly range: readonly [number, number];
  readonly loc: { readonly start: Position; readonly end: Position };
  [field: string]: unknown;
}

/**
 * The root node of a parsed shell script.
 *
 * @public
 */
export interface ShFile extends ShNode {
  readonly type: 'File';
  readonly stmts: readonly ShNode[];
}
