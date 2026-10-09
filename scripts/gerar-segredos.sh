#!/bin/sh
set -eu
printf 'AUTH_SECRET=%s\n' "$(openssl rand -hex 32)"
printf 'SURVIVAL_SECRET=%s\n' "$(openssl rand -hex 32)"
printf 'LOBBY_SECRET=%s\n' "$(openssl rand -hex 32)"
printf 'SKYBLOCK_SECRET=%s\n' "$(openssl rand -hex 32)"
