Return the UNIX TIME of the last DB save executed with success.
A client may check if a [`BGSAVE`](./bgsave) command succeeded reading the `LASTSAVE` value,
then issuing a [`BGSAVE`](./bgsave) command and checking at regular intervals every N
seconds if `LASTSAVE` changed.

