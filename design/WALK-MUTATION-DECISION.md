# Walk mutation representation decision

Status: unresolved consequential fidelity decision. The accepted Release A model
uses ordinary mutable JavaScript arrays for Go slices; it does not retain slice
capacity, shared backing storage or separate slice headers. The Release B
requirement to preserve live callback effects exposes an observable distinction
that static traversal traces cannot settle.

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

## Recommendation and alternative

The smallest implementation keeps the accepted ordinary-array model and defines
its live traversal storage semantics explicitly: capture each list reference and
initial extent, read later existing slots live, ignore appended elements, and
allow field replacement without retargeting an active list. It preserves ordinary
field edits, child replacement, pruning, comment copy/identity semantics, and
synchronous reentrancy. It cannot claim complete equivalence for destructive
structural mutation of an active array or Go capacity-dependent reallocation.
That restriction needs explicit acceptance; it must not be disguised as full
upstream mutation parity or silently implemented as rejection.

The broader alternative introduces an explicit Go slice/header/storage model,
including capacity and aliasing, with controlled mutation operations. That changes
the accepted representation and requires parser/codec/type/consumer migration and
new aliasing evidence. It should be chosen deliberately rather than hidden inside
a traversal helper.

Printing the actual current tree, supported-node traversal order, callback
pruning/exits, comment identity, and the consumer fix tests can proceed while this
decision is pending. Final Release B traversal acceptance depends on the choice.
