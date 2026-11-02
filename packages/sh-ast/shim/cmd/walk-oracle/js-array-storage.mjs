/**
 * Representation probe, not a walker implementation. Run with Node to compare
 * destructive JavaScript truncation with storageProbes in the native oracle.
 * A removed replacement is absent from both the live array and initial snapshot.
 */
const array = ['a', 'b', 'c'];
const capturedStorage = array;
const initialSlots = array.slice();
const capturedLength = array.length;
const trace = [];
for (let index = 0; index < capturedLength; index += 1) {
  const value = capturedStorage[index];
  trace.push(value ?? '<missing>');
  if (value === 'a') {
    array[1] = 'replacement';
    array.length = 1;
  }
}
console.log(JSON.stringify({ trace, initialSlots, final: array }));

// Go's &comments[i] remains the address of a value slot after whole-slot assignment.
// An ordinary JavaScript object reference instead retains the previous object.
const comments = [{ Text: 'before' }];
const activeComment = comments[0];
const commentTrace = [activeComment.Text];
comments[0] = { Text: 'after' };
commentTrace.push(activeComment.Text);
console.log(
  JSON.stringify({
    mutation: 'replace active comment value slot',
    trace: commentTrace,
    current: comments[0].Text,
  }),
);
