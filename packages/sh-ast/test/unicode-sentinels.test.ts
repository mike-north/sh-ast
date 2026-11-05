/**
 * Unicode source characters must never act as parser control markers. These
 * fixtures assert shell words and complete statement lists independently of
 * upstream's historical sentinel behavior, for both public parse operations.
 */
import { describe, expect, it } from 'vitest';
import {
  LangBash,
  LangBats,
  LangMirBSDKorn,
  LangPOSIX,
  LangZsh,
  ParseError,
  parseSync,
  parseWithPositionsSync,
  nodePos,
  printSync,
} from '../src/index.js';
import { nodes } from './regression-helpers.js';

/** Both entry points must expose identical source consumption semantics. */
const parsers = [
  parseSync,
  (source: string | Uint8Array, options: Parameters<typeof parseSync>[1]) =>
    parseWithPositionsSync(source, options).File,
];

for (const parse of parsers) {
  describe('Unicode sentinel separation', () => {
    it.each([LangBash, LangBats, LangMirBSDKorn, LangPOSIX, LangZsh])(
      'retains both words and the later command in variant %s',
      (Variant) => {
        for (const rune of ['\u0080', '\u0081']) {
          for (const source of [`echo ${rune}b\neval "$x"\n`, `echo a${rune}b\neval "$x"\n`]) {
            for (const input of [source, new TextEncoder().encode(source)]) {
              for (const KeepComments of [false, true]) {
                const file = parse(input, { Variant, KeepComments });
                expect(file.Stmts).toHaveLength(2);
                const words = nodes(file)
                  .filter((node) => node.Type === 'Lit')
                  .map((node) => node.Value);
                expect(words).toContain(source.slice(5, source.indexOf('\n')));
                expect(words).toContain('eval');
              }
            }
          }
        }
      },
    );
    it.each([LangBash, LangBats, LangMirBSDKorn, LangPOSIX, LangZsh])(
      'preserves quoted and nested source characters in variant %s',
      (Variant) => {
        for (const rune of ['\u0080', '\u0081']) {
          for (const command of [
            `echo '${rune}'`,
            `echo "${rune}"`,
            `echo $(echo ${rune})`,
            `echo \${x:-${rune}}`,
          ]) {
            const source = `${command}\necho done\n`;
            const file = parse(source, { Variant });
            expect(file.Stmts).toHaveLength(2);
            expect(printSync(file)).toBe(source);
          }
        }
      },
    );
    it('retains leading and trailing Unicode words and heredoc delimiter characters', () => {
      for (const source of ['\u0080eval "$x"\n', 'echo ok \u0080', 'echo ok\u0080']) {
        const file = parse(source, {});
        expect(file.Stmts).toHaveLength(1);
        expect(printSync(file)).toBe(source.endsWith('\n') ? source : `${source}\n`);
      }
      const source = 'cat <<E\u0080F\nabc\nE\u0080F\necho done\n';
      expect(printSync(parse(source, {}))).toBe(source);
    });
    it('keeps malformed UTF-8 as a structured byte error after Unicode text', () => {
      const prefix = new TextEncoder().encode('echo 🎉\u0080ok\r\necho ');
      const source = new Uint8Array([...prefix, 0xff, 0x0a]);
      try {
        parse(source, { Filename: 'bytes.sh' });
        expect.fail('Malformed UTF-8 must remain an error');
      } catch (error) {
        expect(error).toBeInstanceOf(ParseError);
        if (!(error instanceof ParseError)) throw error;
        expect(error.Pos).toMatchObject({ Offset: prefix.length, Line: 2, Col: 6 });
        expect(error.Text).toBe('invalid UTF-8 encoding');
      }
    });
    it('preserves accepted escaping and quoted heredocs across buffer boundaries', () => {
      for (const eol of ['\n', '\r\n']) {
        for (const size of [0, 1010, 1011, 1012, 1024, 32768]) {
          const body = `${'a'.repeat(size)}\u0080def`;
          const source = `cat <<'EOF'${eol}${body}${eol}EOF${eol}eval "$x"${eol}`;
          const file = parse(source, {});
          expect(file.Stmts).toHaveLength(2);
          expect(
            nodes(file).some((node) => node.Type === 'Lit' && node.Value === `${body}\n`),
          ).toBe(true);
        }
      }
      expect(parse('echo \\\u0080x\neval "$x"\n', {}).Stmts).toHaveLength(2);
    });
    it('keeps Unicode comments and intentional StopAt termination distinct', () => {
      const file = parse('# c\u0080\necho ok\n', { KeepComments: true });
      expect(file.Stmts).toHaveLength(1);
      expect(nodes(file).some((node) => node.Type === 'Comment' && node.Text === ' c\u0080')).toBe(
        true,
      );
      expect(parse('echo \u0080ok STOP ignored\n', { StopAt: 'STOP' }).Stmts).toHaveLength(1);
    });
    it('reports later grammar errors with byte coordinates after multibyte text', () => {
      const prefix = 'echo 🎉\u0080ok\r\n';
      try {
        parse(`${prefix}echo "unterminated`, { Filename: 'unicode.sh', RecoverErrors: 0 });
        expect.fail('The unterminated quote must be diagnosed');
      } catch (error) {
        expect(error).toBeInstanceOf(ParseError);
        if (!(error instanceof ParseError)) throw error;
        expect(error.Pos).toMatchObject({
          Offset: new TextEncoder().encode(prefix).length + 5,
          Line: 2,
          Col: 6,
        });
        expect(error.Filename).toBe('unicode.sh');
      }
      const file = parse(`${prefix}echo done\n`, { RecoverErrors: 1 });
      expect(file.Stmts).toHaveLength(2);
      const done = nodes(file).find((node) => node.Type === 'Lit' && node.Value === 'done');
      if (!done) throw new Error('Missing final word');
      expect(nodePos(done).Offset).toBe(new TextEncoder().encode(prefix).length + 5);
    });
  });
}
