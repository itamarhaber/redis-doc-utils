`BLMPOP` is the blocking variant of [`LMPOP`](./lmpop).

When any of the lists contains elements, this command behaves exactly like [`LMPOP`](./lmpop).
When used inside a [`MULTI`](./multi)/[`EXEC`](./exec) block, this command behaves exactly like [`LMPOP`](./lmpop).
When all lists are empty, Redis will block the connection until another client pushes to it or until the `timeout` (a double value specifying the maximum number of seconds to block) elapses.
A `timeout` of zero can be used to block indefinitely.

See [`LMPOP`](./lmpop) for more information.

