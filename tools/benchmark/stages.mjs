/**
 * Per-stage attribution of one public parse call. Timing workers install these
 * probes before importing a package, so every boundary observed below is the
 * package's real code path: its own WASM instance, export calls and JSON.parse.
 * The probes add a few function calls per parse and are used only by the
 * dedicated stage phases, never by the ordinary parse phases.
 */
import { performance } from 'node:perf_hooks';

/** Stage names in call order; README.md defines what each one contains. */
export const stageNames = ['input', 'wasm', 'parse', 'encode', 'transfer', 'decode'];

/**
 * Converts the timestamps of one call into stage durations (milliseconds).
 * marks: start/end of the public call, the first alloc, the syntaxProcess
 * export call, and the first JSON.parse after it. parseMs includes parser
 * construction/configuration, reader setup, and upstream
 * Parser.Parse, as reported by the WASM shim; older packages report null. The
 * encode value is the export-call remainder, including encoding and call overhead,
 * not an exclusive encoder timer. Unknown parse and encode remain null while wasm
 * still covers the full export call.
 */
export function attributeStages(marks, parseMs) {
  const { start, alloc, exportStart, exportEnd, jsonStart, end } = marks;
  const ordered = [start, alloc, exportStart, exportEnd, jsonStart, end];
  if (
    !ordered.every(Number.isFinite) ||
    ordered.some((value, i) => i > 0 && value < ordered[i - 1])
  )
    throw new Error('Stage marks are missing or out of order');
  const wasm = exportEnd - exportStart;
  const known = Number.isFinite(parseMs) && parseMs >= 0 && parseMs <= wasm;
  if (parseMs !== null && !known) throw new Error('Reported parse time exceeds the export call');
  return {
    input: alloc - start,
    wasm,
    parse: known ? parseMs : null,
    encode: known ? wasm - parseMs : null,
    transfer: exportStart - alloc + (jsonStart - exportEnd),
    decode: end - jsonStart,
  };
}

/**
 * Wraps WebAssembly.Instance and JSON.parse for this process. Only packages
 * exposing the faithful syntaxProcess ABI produce marks; any other package is
 * reported as unsupported by the caller. begin/end bracket exactly one call.
 */
export function instrumentStages(clock = () => performance.now()) {
  let marks = null;
  let supported = false;
  let readParse = null;
  const Original = WebAssembly.Instance;
  WebAssembly.Instance = function (module, imports) {
    const instance = new Original(module, imports);
    const exposed = { ...instance.exports };
    if (typeof exposed.syntaxProcess === 'function') {
      supported = true;
      const { alloc, syntaxProcess, syntaxLastParseNanoseconds } = exposed;
      if (typeof syntaxLastParseNanoseconds === 'function')
        readParse = () => syntaxLastParseNanoseconds() / 1e6;
      exposed.alloc = (...args) => {
        if (marks && marks.alloc === undefined) marks.alloc = clock();
        return alloc(...args);
      };
      exposed.syntaxProcess = (...args) => {
        if (marks) marks.exportStart = clock();
        try {
          return syntaxProcess(...args);
        } finally {
          if (marks) marks.exportEnd = clock();
        }
      };
    }
    return new Proxy(instance, {
      get(target, key) {
        return key === 'exports' ? exposed : Reflect.get(target, key, target);
      },
    });
  };
  WebAssembly.Instance.prototype = Original.prototype;
  const parse = JSON.parse;
  JSON.parse = function (...args) {
    if (marks && marks.exportEnd !== undefined && marks.jsonStart === undefined)
      marks.jsonStart = clock();
    return parse.apply(JSON, args);
  };
  return {
    /** Whether the imported package exposed the faithful syntax ABI. */
    get supported() {
      return supported;
    },
    begin() {
      marks = { start: clock() };
    },
    end() {
      marks.end = clock();
      const observed = marks;
      marks = null;
      return attributeStages(observed, readParse ? readParse() : null);
    },
  };
}
