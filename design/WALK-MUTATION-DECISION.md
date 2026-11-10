# Walk mutation representation decision

Status: accepted. The maintainer explicitly chose **"Keep ordinary arrays with explicit
traversal-mutation limits (Recommended)."** This resolves the Release B
representation question; it does not authorize merging or publishing either
release. The choice preserves Release A's ordinary mutable TypeScript arrays
and accepts the storage distinctions demonstrated below.

## Accepted contract

Walk is synchronous and reads each child field at its specified traversal point.
Shape-valid edits to syntax fields within a node's existing kind, pointer-child
replacement, pruning, boolean callbacks and synchronous reentrancy remain
supported. A later child observes its replacement when its field is reached;
replacing a child already being visited does not replace that active occurrence.
The `Type` discriminator and a `TypedNil` marker's `Kind` identify the node kind;
changing those tags during traversal is outside this mutation contract.

Each list captures its array reference and length when that list's traversal
starts, after any preceding callbacks. It reads each future existing slot when
reached. Consequently:

- Replacing a not-yet-visited slot is supported and visits the replacement.
- Appending is supported, but the active traversal ignores elements beyond its
  captured length. An appended object moved into an original future slot is
  visited through that slot. Appending and then replacing an original future slot
  visits that replacement, independent of any hypothetical Go slice capacity.
- Replacing or clearing the owner's array field is supported; it does not retarget
  the active list. That list continues reading the original captured array.
- A later or nested walk starts from the tree and arrays present at its own entry.
  Nested traversal has independent control state; edits it makes to shared records
  remain ordinary live edits visible to an outer traversal where reads remain.

During an active list traversal, destructive structural edits of its captured
array are outside the supported contract when they remove indices or create holes
within the captured extent, or shrink the array below that extent. For example,
truncation, `delete`, `pop`, `shift`, or a length-reducing `splice` can do this.
Keep every index in the captured extent present; removing appended indices beyond
that extent does not affect the active list.
Length-preserving replacement or reordering (including `sort` or `reverse`) follows
the same live-slot rule and can revisit an object moved into a later slot; Walk
does not promise unique-object visitation. Replace slots or assign a new owner
array when removing entries is needed. This limit applies to arrays reached through
aliases as well. The binding adds no mutation detector, rejection policy,
rollback, or promise about traversal results after such unsupported edits.

Stored comments in Last/CondLast/ThenLast/DoLast lists are ordinary JavaScript
objects. Mutating their fields changes the stored object. Replacing a Comment
slot changes that slot's object; a previously retained callback object remains
its old object and does not follow the slot. Specialized Stmt/CaseItem/ArrayElem
comment loops instead visit value copies (including copied position/byte-string
values), preserving the tested upstream copy and deferred-comment behavior.
A replacement in a future comment slot is read before that occurrence is copied.

Ordinary JavaScript aliases remain live: multiple fields may refer to the same
array or object, and mutations through either reference are observable. There is
no separate model for Go slice capacity, distinct slice headers sharing backing
storage, reslicing, or Go value-slot addresses. The contract preserves tested
upstream order and control within these representation limits; it makes no unrestricted
Go heap or storage-mutation parity claim. Printing reconstructs the actual tree
present at the print call, including supported edits, independently of a previous
walk's captured arrays. Original position snapshots remain tied to original
records and source.

## Examples and acceptance checks

| Callback action during Args `[a, b]`                                  | Required observation                                                                |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| On `a`, replace original slot 1 with `x`                              | Active list visits `a, x`.                                                          |
| On `a`, append `c`, then replace original slot 1 with `x`             | Active list visits `a, x`; a later walk sees `c` too.                               |
| On `a`, assign owner Args to a new array `[x, c]`                     | Active list continues `a, b`; later traversal/printing sees the new field.          |
| In a stored Comment callback, replace its own slot with a new Comment | Retained callback object remains the old object; slot points at the replacement.    |
| Mutate a specialized item-comment callback's copied fields            | Original comment record is unchanged.                                               |
| Remove indices within the captured extent or shrink below it          | Outside the supported mutation contract; no particular result or error is promised. |

Tests for these expectations derive from this accepted TypeScript contract.
Native Go oracle traces remain the ground truth for common order, control and
mutation behavior, while the divergent probes below explain the accepted limit.
Unsupported edits are not tested as if one accidental result were a guarantee.

## Independent upstream reproducer

Construct two `syntax.CallExpr` values with Args containing the same two Word
pointers `a` and `b`. One Args slice has length/capacity 2/2; the other has 2/4.
Their represented AST fields are identical. During the callback on `a`, perform:

```go
call.Args = append(call.Args, c)
call.Args[1] = replacement
```

Pinned upstream Walk captures the original Args slice header before entering
the loop. With capacity 2, append allocates new storage and its later iteration
still visits `b`: trace `[a, b]`. With capacity 4, append reuses storage and the
later iteration visits `replacement`: trace `[a, replacement]`. Both cases
ignore appended `c`, because the active range length is two.

A second case first replaces slot one and then reslices the field to length one.
Go's active range still visits the changed slot and remaining original slots.
The JavaScript operation `args[1] = replacement; args.length = 1` destroys those
slots; retaining only the initial values loses the intervening replacement.
Recovering these effects requires observing writes or representing backing storage.

The independent reviewer also confirmed a value-slot identity distinction without
changing length or capacity. File.Last is a Go `[]Comment`; Walk passes a pointer
to its element. Inside that callback, replacing `file.Last[0]` with a new Comment
value immediately changes the text observed through the retained callback pointer,
which still equals `&file.Last[0]`. Ordinary JavaScript array-slot replacement
creates a different object, leaving the retained callback object unchanged. This
is part of the same representation decision, not merely a resizing limitation.

## Alternatives and revision trigger

The selected model keeps ordinary arrays and explicit limits so existing syntax
records and consumer edits remain straightforward. The alternative would introduce
Go slice/header/storage abstractions, including capacity, aliasing and value-slot
addresses. That would require parser, codec, type and consumer migrations plus
new storage-identity evidence. It was not selected.

Revisit this decision if a concrete consumer needs destructive active-list edits
or Go storage aliasing/slot-address observations that cannot be expressed with
field edits, future-slot replacement or assigning a new array. Such a need would
require a new accepted contract rather than silently expanding this walker.
