/**
 * Current-tree positions and printing must agree after edits. The expected
 * values mirror independent native Go operations in printer_bounds_review_test.go,
 * including byte-based bounds after emoji/CJK and deliberately stale positions.
 */
import { expect, it } from 'vitest';
import { nodeEnd, nodePos, parseSync } from '../src/syntax.js';
import { printSync } from '../src/syntax-print.js';

it('updates comment-derived bounds and prints the edited text', () => {
  const file = parseSync('#old\n', { KeepComments: true });
  const comment = file.Last?.[0];
  if (!comment) throw new Error('Expected trailing comment');
  expect(nodePos(comment)).toMatchObject({ Offset: 0, Line: 1, Col: 1 });
  expect(nodeEnd(comment)).toMatchObject({ Offset: 4, Line: 1, Col: 5 });
  comment.Text = 'new 🎉';
  expect(nodePos(comment)).toMatchObject({ Offset: 0, Line: 1, Col: 1 });
  expect(nodeEnd(comment)).toMatchObject({ Offset: 9, Line: 1, Col: 10 });
  const output = printSync(file);
  expect(output).toBe('#new 🎉\n');
  expect(parseSync(output, { KeepComments: true }).Last?.[0]?.Text).toBe('new 🎉');
});

it('derives a word end from its replacement final part and prints current values', () => {
  const file = parseSync("echo pre'old 🎉'\n");
  const call = file.Stmts?.[0]?.Cmd;
  if (call?.Type !== 'CallExpr') throw new Error('Expected command');
  const word = call.Args?.[1];
  if (!word?.Parts) throw new Error('Expected compound word');
  expect(nodePos(word)).toMatchObject({ Offset: 5, Line: 1, Col: 6 });
  expect(nodeEnd(word)).toMatchObject({ Offset: 18, Line: 1, Col: 19 });
  word.Parts[word.Parts.length - 1] = {
    Type: 'SglQuoted',
    Dollar: false,
    Value: 'new 你好',
    Left: { Offset: 40, Line: 3, Col: 7, IsValid: true, IsRecovered: false, OffsetOverflow: false },
    Right: {
      Offset: 60,
      Line: 3,
      Col: 27,
      IsValid: true,
      IsRecovered: false,
      OffsetOverflow: false,
    },
  };
  expect(nodePos(word)).toMatchObject({ Offset: 5, Line: 1, Col: 6 });
  expect(nodeEnd(word)).toMatchObject({ Offset: 61, Line: 3, Col: 28 });
  const output = printSync(file);
  expect(output).toBe("echo pre'new 你好'\n");
  const reparsed = parseSync(output).Stmts?.[0]?.Cmd;
  if (reparsed?.Type !== 'CallExpr') throw new Error('Expected reparsed command');
  expect(reparsed.Args).toHaveLength(2);
  expect(reparsed.Args?.[1]?.Parts).toMatchObject([
    { Type: 'Lit', Value: 'pre' },
    { Type: 'SglQuoted', Value: 'new 你好' },
  ]);
});
