This command performs a full reset of the connection's server-side context, 
mimicking the effect of disconnecting and reconnecting again.

When the command is called from a regular client connection, it does the
following:

* Discards the current [`MULTI`](./multi) transaction block, if one exists.
* Unwatches all keys [`WATCH`](./watch)ed by the connection.
* Disables `CLIENT TRACKING`, if in use.
* Sets the connection to [`READWRITE`](./readwrite) mode.
* Cancels the connection's [`ASKING`](./asking) mode, if previously set.
* Sets `CLIENT REPLY` to `ON`.
* Sets the protocol version to RESP2.
* [`SELECT`](./select)s database 0.
* Exits [`MONITOR`](./monitor) mode, when applicable.
* Aborts Pub/Sub's subscription state ([`SUBSCRIBE`](./subscribe) and [`PSUBSCRIBE`](./psubscribe)), when
  appropriate.
* Deauthenticates the connection, requiring a call [`AUTH`](./auth) to reauthenticate when
  authentication is enabled.

