This command is very similar to [`DEL`](./del): it removes the specified keys.
Just like [`DEL`](./del) a key is ignored if it does not exist. However the command
performs the actual memory reclaiming in a different thread, so it is not
blocking, while [`DEL`](./del) is. This is where the command name comes from: the
command just **unlinks** the keys from the keyspace. The actual removal
will happen later asynchronously.

@examples

```cli
SET key1 "Hello"
SET key2 "World"
UNLINK key1 key2 key3
```

