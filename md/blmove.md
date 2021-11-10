`BLMOVE` is the blocking variant of [`LMOVE`](./lmove).
When `source` contains elements, this command behaves exactly like [`LMOVE`](./lmove).
When used inside a [`MULTI`](./multi)/[`EXEC`](./exec) block, this command behaves exactly like [`LMOVE`](./lmove).
When `source` is empty, Redis will block the connection until another client
pushes to it or until `timeout` (a double value specifying the maximum number of seconds to block) is reached.
A `timeout` of zero can be used to block indefinitely.

This command comes in place of the now deprecated [`BRPOPLPUSH`](./brpoplpush). Doing
`BLMOVE RIGHT LEFT` is equivalent.

See [`LMOVE`](./lmove) for more information.

## Pattern: Reliable queue

Please see the pattern description in the [`LMOVE`](./lmove) documentation.

## Pattern: Circular list

Please see the pattern description in the [`LMOVE`](./lmove) documentation.

