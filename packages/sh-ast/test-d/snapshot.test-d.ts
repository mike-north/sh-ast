/** Snapshot observations stay distinct from editable syntax and live node operations. */
import { expectError, expectType } from 'tsd';
import { parseWithPositionsSync, type File, type NodePositions, type SyntaxPos } from 'sh-ast';

const parsed = parseWithPositionsSync('echo hi');
expectType<File>(parsed.File);
expectType<NodePositions | undefined>(parsed.Positions.get(parsed.File));
const position = parsed.Positions.get(parsed.File);
if (position) {
  expectType<Readonly<SyntaxPos>>(position.Pos);
  expectError((position.Pos.Offset = 42));
  expectError((position.End = position.Pos));
}
parsed.File.Name = 'edited.sh';
expectError((parsed.File = parsed.File));
expectError(parsed.Positions.set);
expectError(parsed.Positions.get({ Type: 'Slice', Offset: null, Length: null }));
