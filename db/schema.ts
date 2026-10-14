import {sqliteTable, text, integer} from 'drizzle-orm/sqlite-core';
export const rooms = sqliteTable('rooms', {
  code: text('code').primaryKey(), name: text('name').notNull(), ownerHash: text('owner_hash').notNull(),
  state: text('state').notNull(), version: integer('version').notNull().default(1),
  updatedAt: integer('updated_at').notNull(), expiresAt: integer('expires_at').notNull(), guildId:text('guild_id'), isPublic:integer('is_public',{mode:'boolean'}).notNull().default(false),
});
export const cached = sqliteTable('cached', {key: text('key').primaryKey(), data: text('data').notNull(), expiresAt: integer('expires_at').notNull()});
export const limits = sqliteTable('limits', {key: text('key').primaryKey(), count: integer('count').notNull(), until: integer('until').notNull()});
export const visitors = sqliteTable('visitors', {key: text('key').primaryKey(), room: text('room').notNull(), until: integer('until').notNull()});
export const adminSessions=sqliteTable('admin_sessions',{tokenHash:text('token_hash').primaryKey(),passwordRevision:text('password_revision').notNull(),expiresAt:integer('expires_at').notNull()});
export const playbackHistory=sqliteTable('playback_history',{eventId:text('event_id').primaryKey(),videoId:text('video_id').notNull(),video:text('video').notNull(),source:text('source').notNull(),guildId:text('guild_id'),playedAt:integer('played_at').notNull()});
export const botState=sqliteTable('bot_state',{key:text('key').primaryKey(),state:text('state').notNull(),updatedAt:integer('updated_at').notNull()});
export const botCommands=sqliteTable('bot_commands',{id:text('id').primaryKey(),guildId:text('guild_id'),payload:text('payload').notNull(),status:text('status').notNull(),result:text('result'),createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull()});
export const discordOauthStates=sqliteTable('discord_oauth_states',{tokenHash:text('token_hash').primaryKey(),expiresAt:integer('expires_at').notNull()});
export const discordAdminSessions=sqliteTable('discord_admin_sessions',{tokenHash:text('token_hash').primaryKey(),tokenCipher:text('token_cipher').notNull(),expiresAt:integer('expires_at').notNull()});
