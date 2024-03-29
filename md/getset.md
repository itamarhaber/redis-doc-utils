Atomically sets `key` to `value` and returns the old value stored at `key`.
Returns an error when `key` exists but does not hold a string value.  Any 
previous time to live associated with the key is discarded on successful 
[`SET`](/commands/set) operation.

## Design pattern

`GETSET` can be used together with [`INCR`](/commands/incr) for counting with atomic reset.
For example: a process may call [`INCR`](/commands/incr) against the key `mycounter` every time
some event occurs, but from time to time we need to get the value of the counter
and reset it to zero atomically.
This can be done using `GETSET mycounter "0"`:

{{% redis-cli %}}
INCR mycounter
GETSET mycounter "0"
GET mycounter
{{% /redis-cli %}}

As per Redis 6.2, GETSET is considered deprecated. Please prefer [`SET`](/commands/set) with [`GET`](/commands/get) parameter in new code.

## Examples

{{% redis-cli %}}
SET mykey "Hello"
GETSET mykey "World"
GET mykey
{{% /redis-cli %}}

