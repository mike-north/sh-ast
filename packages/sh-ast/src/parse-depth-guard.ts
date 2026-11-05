/**
 * A bounded lexical estimate of recursive parser work before entering WASM.
 * This is a binding resource limit, not a shell grammar or a proof that every
 * later parser/serializer operation fits every caller's remaining native stack.
 * Literal quote/heredoc/parameter-word content is inert; expansions re-enter
 * the appropriate grammar region. Flat comments are handled iteratively upstream.
 */
import { ShParseMaxDepthError } from './errors.js';

/**
 * Maximum estimated parser recursion units. On Node 22.22.1, the canonical
 * Linux-built shim called through ESLint 10.7.0 Linter.verify -> Language.parse
 * accepted 150, 175 and 200 nested command substitutions; 225 overflowed. This
 * supports a margin for that ordinary caller shape, not arbitrary pre-existing
 * recursion: 1,000 additional five-argument JS frames accepted 150 but not 175,
 * while 3,000 such frames overflowed even at 100. Frame count is not stack size.
 *
 * The estimate also deliberately rejects some unusually large valid constructs.
 * It does not cover every possible serialization depth (see sh-ast#71), nor can
 * any fixed input limit guarantee safety on an already exhausted caller stack.
 */
const MAX_PARSE_NESTING_DEPTH = 150;

/** Shell token separators; quotes and expansions can continue an existing word. */
const WORD_DELIMITERS = new Set(';&|(){}<>`"\'\\$ \t\n\r');
/** Arithmetic tokens have boundaries inside ordinary shell words. */
const ARITHMETIC_DELIMITERS = new Set(';&|(){}<>`"\'\\$[]=?!~+-*/%^,: \t\n\r');
/** Structural reserved words whose bodies can contain further statements. */
const LOOP_OPENERS = new Set(['for', 'while', 'until', 'select']);
/** These tokens resume command position inside an existing construct. */
const CONDITIONAL_PREFIXES = new Set(['then', 'else', 'elif']);
/** Declaration clauses parse assignment indices as arithmetic. */
const DECLARATIONS = new Set(['declare', 'local', 'export', 'readonly', 'typeset', 'nameref']);
/** Assignment operators recurse on their right operand in mvdan/sh. */
const ASSIGNMENTS = new Set([
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<=',
  '>>=',
  '**=',
  '&&=',
  '||=',
  '^^=',
]);
/** Longest-token recognition keeps comparisons distinct from assignment. */
const ARITHMETIC_OPERATORS = [
  '**=',
  '<<=',
  '>>=',
  '&&=',
  '||=',
  '^^=',
  '++',
  '--',
  '**',
  '==',
  '!=',
  '<=',
  '>=',
  '<<',
  '>>',
  '&&',
  '||',
  '^^',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '=~',
];

/** A heredoc belongs to the command region that queued it, including nested commands. */
interface PendingHeredoc {
  readonly delimiter: string;
  readonly stripTabs: boolean;
  readonly quoted: boolean;
}

/** Region identity determines which closers and punctuation have grammar meaning. */
type RegionKind =
  | 'root'
  | 'paren'
  | 'brace'
  | 'conditional'
  | 'loop'
  | 'case'
  | 'backtick'
  | 'dquote'
  | 'heredoc'
  | 'param'
  | 'arith-paren'
  | 'arith-bracket'
  | 'let';

/**
 * Per-region lexical state. Ancestor chains remain live while a child region is
 * scanned; closing a child must not erase recursion already owed by its parent.
 */
interface ScanRegion {
  readonly kind: RegionKind;
  readonly counted: boolean;
  chain: number;
  wordActive: boolean;
  commandStart: boolean;
  declarations: boolean;
  /** An empty bare `()` introduces a function body; `$()` remains a word expansion. */
  functionParameters: boolean;
  expectsOperand: boolean;
  casePattern: boolean;
  paramMode: 'name' | 'word' | 'arith';
  paramName: boolean;
  readonly heredocs: PendingHeredoc[];
  heredocCursor: number;
  heredoc?: PendingHeredoc;
}

/** Quotes and compact let expressions add no structural frame of their own. */
function region(kind: RegionKind): ScanRegion {
  return {
    kind,
    counted: !['root', 'dquote', 'heredoc', 'let'].includes(kind),
    chain: 0,
    wordActive: false,
    commandStart: true,
    declarations: false,
    functionParameters: false,
    expectsOperand: true,
    casePattern: kind === 'case',
    paramMode: 'name',
    paramName: false,
    heredocs: [],
    heredocCursor: 0,
  };
}

/** Parameter slices and indices use the same operator grammar as arithmetic expressions. */
function arithmetic(current: ScanRegion): boolean {
  return (
    current.kind === 'arith-paren' ||
    current.kind === 'arith-bracket' ||
    current.kind === 'let' ||
    (current.kind === 'param' && current.paramMode === 'arith')
  );
}

/**
 * Scans only far enough to establish a refusal. Counts brackets and recursive
 * operator links, retaining ancestor contributions. It intentionally approximates
 * grammar; accepted input still goes through the upstream parser unchanged.
 */
function estimateMaxNestingDepth(text: string, limit: number): number {
  const stack = [region('root')];
  let depth = 0;
  let chains = 0;
  let maximum = 0;
  let i = 0;

  /** All callers retain the root region, so a current region always exists. */
  const top = (): ScanRegion => stack[stack.length - 1];
  /** Effective depth includes outstanding work in every live grammar region. */
  function note(): void {
    maximum = Math.max(maximum, depth + chains);
  }
  /** Opening a child preserves its parent's operator obligations. */
  function push(kind: RegionKind): ScanRegion {
    const next = region(kind);
    stack.push(next);
    if (next.counted) {
      depth++;
    }
    note();
    return next;
  }
  /** Only a compatible closer may discard a region and its outstanding chains. */
  function pop(...kinds: readonly RegionKind[]): boolean {
    const current = top();
    if (stack.length === 1 || !kinds.includes(current.kind)) {
      return false;
    }
    stack.pop();
    if (current.counted) {
      depth--;
    }
    chains -= current.chain;
    return true;
  }
  /** A completed statement or compact let argument releases only its own chain. */
  function reset(current: ScanRegion): void {
    chains -= current.chain;
    current.chain = 0;
  }
  /** One recursive operator adds work without opening a bracket. */
  function link(current: ScanRegion): void {
    current.chain++;
    chains++;
    note();
  }
  /** Queued heredocs start in their own command region's source order. */
  function startHeredoc(): void {
    const owner = top();
    if (owner.heredocCursor < owner.heredocs.length) {
      const info = owner.heredocs[owner.heredocCursor++];
      push('heredoc').heredoc = info;
    }
  }
  /** Dollar expansion openers have the same meaning in code and expandable text. */
  function dollar(): number {
    if (text[i] !== '$') {
      return 0;
    }
    const current = top();
    const next = text[i + 1];
    current.wordActive = true;
    current.commandStart = false;
    current.expectsOperand = false;
    if (next === '(' && text[i + 2] === '(') {
      push('arith-paren');
      push('arith-paren');
      return 3;
    }
    if (next === '(') {
      push('paren');
      return 2;
    }
    if (next === '{') {
      push('param');
      return 2;
    }
    if (next === '[') {
      push('arith-bracket');
      return 2;
    }
    return 0;
  }
  /** Single-quoted content is literal, including compact let's quoted word operands. */
  function singleQuote(ansi: boolean): void {
    i += ansi ? 2 : 1;
    while (i < text.length && text[i] !== "'") {
      i += ansi && text[i] === '\\' ? 2 : 1;
    }
    if (i < text.length) {
      i++;
    }
  }

  while (i < text.length) {
    if (maximum > limit) {
      return maximum;
    }
    const current = top();
    const ch = text[i];
    const math = arithmetic(current);

    if (current.kind === 'heredoc') {
      const info = current.heredoc;
      if (!info) {
        throw new Error('Heredoc region has no delimiter');
      }
      if (i === 0 || text[i - 1] === '\n') {
        let end = text.indexOf('\n', i);
        if (end < 0) {
          end = text.length;
        }
        const line = text.slice(i, end).replace(/\r$/, '');
        const compare = info.stripTabs ? line.replace(/^\t+/, '') : line;
        if (compare === info.delimiter) {
          pop('heredoc');
          i = end < text.length ? end + 1 : end;
          startHeredoc();
          continue;
        }
      }
      if (info.quoted) {
        i++;
        continue;
      }
    }

    if (current.kind === 'dquote' || current.kind === 'heredoc') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (current.kind === 'dquote' && ch === '"') {
        pop('dquote');
        i++;
        continue;
      }
      const consumed = dollar();
      if (consumed) {
        i += consumed;
        continue;
      }
      if (ch === '`') {
        push('backtick');
      }
      i++;
      continue;
    }

    if (ch === '\\') {
      if (text[i + 1] === '\n') {
        i += 2;
        continue;
      }
      current.commandStart = false;
      current.wordActive = true;
      i += 2;
      continue;
    }
    if (ch === "'" || (ch === '$' && text[i + 1] === "'")) {
      current.wordActive = true;
      current.commandStart = false;
      current.expectsOperand = false;
      singleQuote(ch === '$');
      continue;
    }
    if (ch === '"') {
      current.wordActive = true;
      current.commandStart = false;
      current.expectsOperand = false;
      push('dquote');
      i++;
      continue;
    }
    if (ch === '`') {
      current.wordActive = true;
      current.commandStart = false;
      current.expectsOperand = false;
      if (!pop('backtick')) {
        push('backtick');
      }
      i++;
      continue;
    }
    const consumed = dollar();
    if (consumed) {
      i += consumed;
      continue;
    }

    if (current.kind === 'param') {
      if (ch === '}') {
        pop('param');
        i++;
        continue;
      }
      if (current.paramMode === 'word') {
        i++;
        continue;
      }
      if (current.paramMode === 'name') {
        if (ch === '[' && current.paramName) {
          push('arith-bracket');
          i++;
          continue;
        }
        if (ch === ':' && !'-+=?'.includes(text[i + 1] ?? '\0')) {
          current.paramMode = 'arith';
          current.expectsOperand = true;
        } else if (current.paramName && '-+=?/#%@^,'.includes(ch)) {
          current.paramMode = 'word';
        } else if (!'#!'.includes(ch)) {
          current.paramName = true;
        }
        i++;
        continue;
      }
    }

    if (math) {
      if (current.kind === 'let' && ';\n|&'.includes(ch)) {
        pop('let');
        continue;
      }
      if (' \t\r\n'.includes(ch)) {
        if (current.kind === 'let') {
          reset(current);
          current.expectsOperand = true;
        }
        i++;
        continue;
      }
      if (ch === '(') {
        current.expectsOperand = false;
        push('arith-paren');
        i++;
        continue;
      }
      if (ch === '[') {
        current.expectsOperand = false;
        push('arith-bracket');
        i++;
        continue;
      }
      if (ch === ')' || ch === ']') {
        pop(ch === ')' ? 'arith-paren' : 'arith-bracket');
        i++;
        continue;
      }
      const operator = ARITHMETIC_OPERATORS.find((token) => text.startsWith(token, i)) ?? ch;
      if (ASSIGNMENTS.has(operator) || operator === '**' || operator === '?') {
        link(current);
        current.expectsOperand = true;
        i += operator.length;
        continue;
      }
      if (['!', '~', '+', '-', '++', '--'].includes(operator)) {
        if (current.expectsOperand) {
          link(current);
        }
        current.expectsOperand = true;
        i += operator.length;
        continue;
      }
      if (ARITHMETIC_DELIMITERS.has(ch)) {
        current.expectsOperand = true;
        i += operator.length;
        continue;
      }
      while (i < text.length && !ARITHMETIC_DELIMITERS.has(text[i])) {
        i++;
      }
      current.expectsOperand = false;
      continue;
    }

    // Ordinary shell code. A quote or escaped space can continue a word, so a
    // comment boundary depends on lexical word state, not the previous raw byte.
    if (ch === '#' && !current.wordActive) {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (' \t\r'.includes(ch)) {
      current.wordActive = false;
      i++;
      continue;
    }
    if (ch === '\n' || ch === ';' || (ch === '&' && text[i + 1] !== '&')) {
      if (current.kind === 'case' && ch === ';' && (text[i + 1] === ';' || text[i + 1] === '&')) {
        current.casePattern = true;
        i += text[i + 1] === ';' && text[i + 2] === '&' ? 3 : 2;
      } else {
        i++;
      }
      reset(current);
      current.wordActive = false;
      current.commandStart = true;
      current.declarations = false;
      if (ch === '\n') {
        startHeredoc();
      }
      continue;
    }
    if (ch === '|' || (ch === '&' && text[i + 1] === '&')) {
      if (!(current.kind === 'case' && current.casePattern)) {
        link(current);
      }
      i += text[i + 1] === '|' || text[i + 1] === '&' ? 2 : 1;
      current.wordActive = false;
      current.commandStart = true;
      continue;
    }
    if (ch === '{' || ch === '}') {
      // Brace reserved words must stand alone in command position. Literal
      // argument braces cannot own or close any surrounding region.
      const boundary = i + 1 === text.length || ' \t\r\n;&|()<>'.includes(text[i + 1]);
      if (
        current.commandStart &&
        !current.wordActive &&
        boundary &&
        !(current.kind === 'case' && current.casePattern)
      ) {
        current.commandStart = false;
        if (ch === '{') {
          push('brace');
        } else {
          pop('brace');
        }
      } else {
        current.wordActive = true;
        current.commandStart = false;
      }
      i++;
      continue;
    }
    if (ch === '(') {
      current.wordActive = false;
      if (current.kind === 'case' && current.casePattern) {
        i++;
        continue;
      }
      current.commandStart = false;
      if (text[i + 1] === '(') {
        push('arith-paren');
        push('arith-paren');
        i += 2;
      } else {
        push('paren').functionParameters = text[i + 1] === ')';
        i++;
      }
      continue;
    }
    if (ch === ')') {
      if (current.kind === 'case') {
        current.casePattern = false;
        current.commandStart = true;
        current.wordActive = false;
      } else {
        if (pop('paren') && current.functionParameters) {
          top().commandStart = true;
          top().wordActive = false;
        }
      }
      i++;
      continue;
    }
    if (ch === '<' && text[i + 1] === '<' && text[i + 2] !== '<') {
      let j = i + 2;
      const stripTabs = text[j] === '-';
      if (stripTabs) {
        j++;
      }
      while (text[j] === ' ' || text[j] === '\t') {
        j++;
      }
      let delimiter = '';
      let quoted = false;
      // Match mvdan's raw delimiter spelling: quote markers (including dollar
      // prefixes) disappear, but escapes inside quoted parts remain literal.
      // Runtime ANSI-C decoding would hide subsequent code behind a false body.
      while (j < text.length && !' \t\r\n;&|()<>'.includes(text[j])) {
        if (text[j] === '\\') {
          quoted = true;
          j++;
          if (j < text.length) {
            delimiter += text[j++];
          }
        } else if (
          text[j] === "'" ||
          text[j] === '"' ||
          (text[j] === '$' && (text[j + 1] === "'" || text[j + 1] === '"'))
        ) {
          quoted = true;
          const dollarQuote = text[j] === '$';
          if (dollarQuote) {
            j++;
          }
          const quote = text[j++];
          while (j < text.length && text[j] !== quote) {
            if (text[j] === '\\' && (dollarQuote || quote === '"') && j + 1 < text.length) {
              delimiter += text[j++] + text[j++];
            } else {
              delimiter += text[j++];
            }
          }
          if (j < text.length) {
            j++;
          }
        } else {
          delimiter += text[j++];
        }
      }
      current.heredocs.push({ delimiter, stripTabs, quoted });
      current.wordActive = false;
      i = j;
      continue;
    }
    if (ch === '<' || ch === '>') {
      current.wordActive = false;
      i++;
      continue;
    }

    // Assignment indices are grammar only in assignment/declaration position;
    // ordinary arguments such as `echo x[x[` remain literal shell words.
    if (!current.wordActive && (current.commandStart || current.declarations)) {
      const name = /^[A-Za-z_][A-Za-z0-9_]*\[/.exec(text.slice(i));
      if (name) {
        current.wordActive = true;
        i += name[0].length;
        push('arith-bracket');
        continue;
      }
    }
    let end = i + 1;
    while (end < text.length && !WORD_DELIMITERS.has(text[end])) {
      end++;
    }
    const word = text.slice(i, end);
    const wholeWord = end === text.length || ' \t\r\n;&|()<>'.includes(text[end]);
    const atCommand = wholeWord && current.commandStart && !current.wordActive;
    const pattern = current.kind === 'case' && current.casePattern;
    current.wordActive = true;
    current.commandStart = false;
    if (atCommand && word === 'esac' && current.kind === 'case') {
      pop('case');
    } else if (atCommand && !pattern) {
      if (word === 'if') {
        push('conditional');
      } else if (LOOP_OPENERS.has(word)) {
        push('loop');
      } else if (word === 'fi') {
        pop('conditional');
      } else if (word === 'done') {
        pop('loop');
      } else if (word === 'case') {
        push('case');
      } else if (word === 'let') {
        push('let');
      } else if (
        (CONDITIONAL_PREFIXES.has(word) && current.kind === 'conditional') ||
        (word === 'do' && current.kind === 'loop') ||
        word === 'time' ||
        word === '!'
      ) {
        current.commandStart = true;
        current.wordActive = false;
      } else if (DECLARATIONS.has(word)) {
        current.declarations = true;
      }
    }
    i = end;
  }
  return maximum;
}

/**
 * Refuses estimated recursive parser work beyond the binding's empirical limit.
 * Both whole-file parse operations use this before entering the shared WASM
 * instance. It does not certify unrelated serializer or caller-stack capacity.
 * @internal
 */
export function assertParseDepthWithinLimit(text: string): void {
  const estimated = estimateMaxNestingDepth(text, MAX_PARSE_NESTING_DEPTH);
  if (estimated > MAX_PARSE_NESTING_DEPTH) {
    throw new ShParseMaxDepthError(MAX_PARSE_NESTING_DEPTH, estimated);
  }
}
