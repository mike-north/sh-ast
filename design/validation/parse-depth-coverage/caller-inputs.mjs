/** Reconstructs the fixed campaign inputs; hashes pin every resulting source byte. */
export function sourceFor(spec) {
  switch (spec.name) {
    case 'subshell':
      return '(\n'.repeat(spec.n) + ':' + ')\n'.repeat(spec.n);
    case 'cmdsub':
      return 'echo $('.repeat(spec.n) + 'echo ok' + ')'.repeat(spec.n);
    case 'param':
      return 'echo ' + '${a:-'.repeat(spec.n) + 'x' + '}'.repeat(spec.n);
    case 'arith-index':
      return 'echo $(( ' + 'a['.repeat(spec.n) + '1' + ']'.repeat(spec.n) + ' ))';
    case 'arith-parens':
      return 'echo $(( ' + '('.repeat(spec.n) + '1' + ')'.repeat(spec.n) + ' ))';
    case 'iterative-add':
      return 'echo $(( ' + '1+'.repeat(spec.n) + '1 ))';
    default:
      if (
        spec.name === `comments-${spec.blocks}-${spec.keepComments}` &&
        [1, 3].includes(spec.blocks)
      )
        return ('# c\n'.repeat(50000) + ':\n').repeat(spec.blocks);
      throw new Error(`Unknown input ${spec.name}`);
  }
}
