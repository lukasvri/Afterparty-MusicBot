/** Canonical room-presence SQL. Callers retain authorization and own D1 access. */
export const visitorSQL = {
  heartbeat: "INSERT INTO visitors(key,room,until) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET until=excluded.until WHERE until<?",
  count: "SELECT count(*) AS n FROM visitors WHERE room=? AND until>?",
  expire: "DELETE FROM visitors WHERE until<?",
  removeRoom: "DELETE FROM visitors WHERE room=?",
  directory: `SELECT r.code,r.name,r.expires_at,
    (SELECT count(*) FROM visitors v WHERE v.room=r.code AND v.until>?) AS viewers
    FROM rooms r WHERE r.is_public=1 AND r.expires_at>? AND r.guild_id IS NULL AND r.code!='DISCORD1'
    ORDER BY viewers DESC,r.updated_at DESC LIMIT 60`,
} as const;
