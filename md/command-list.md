Returns @array-reply of command names in this Redis server.

The list can be filtered in the following ways:
 - Get commands that belong to s specific module
 - Get commands with a specific ACL category
 - Get command to comply with a specific regex pattern

## Examples

{{% redis-cli %}}
COMMAND LIST
{{% /redis-cli %}}

