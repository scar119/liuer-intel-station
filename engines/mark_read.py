#!/usr/bin/env python3
import sys, json, sqlite3

db_path, ids_json, value = sys.argv[1], sys.argv[2], int(sys.argv[3])
ids = json.loads(ids_json)
if not ids:
    print("ok")
    sys.exit(0)

placeholders = ",".join("?" for _ in ids)
conn = sqlite3.connect(db_path)
conn.execute(f"UPDATE entries SET read=? WHERE id IN ({placeholders})", [value] + ids)
conn.commit()
conn.close()
print("ok")
