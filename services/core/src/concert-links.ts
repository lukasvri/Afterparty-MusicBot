/** Reserved bridge rooms are Discord concerts, never independent browser rooms. */
export function isDiscordRoomCode(value: unknown): value is string {
  return typeof value === "string" && (value === "DISCORD1" || /^D0[A-F0-9]{6}$/.test(value));
}

export function isConcertGuildId(value: unknown): value is string {
  return typeof value === "string" && /^\d{14,22}$/.test(value);
}

/** Publish the selected guild explicitly, without inheriting URL credentials or query fields. */
export function concertLink(site: string, guildId: string): string {
  if (!isConcertGuildId(guildId)) return "";
  try {
    const url = new URL("/discord", site);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    url.searchParams.set("guildId", guildId);
    return url.href;
  } catch { return ""; }
}
