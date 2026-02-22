#!/bin/bash
set -euo pipefail

# 05b-list-groups.sh — Query WhatsApp groups from the database.
# Output: pipe-separated JID|name lines, most recent first.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
DB_PATH="$PROJECT_ROOT/store/messages.db"

LIMIT="${1:-30}"

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: database not found" >&2
  exit 1
fi

node -e "
import Database from 'better-sqlite3';
const db = new Database('$DB_PATH', {readonly: true});
const rows = db.prepare(\"SELECT jid, name FROM chats WHERE jid LIKE '%@g.us' AND jid <> '__group_sync__' AND name <> jid ORDER BY last_message_time DESC LIMIT $LIMIT\").all();
rows.forEach(r => console.log(r.jid + '|' + r.name));
db.close();
" --input-type=module 2>/dev/null
