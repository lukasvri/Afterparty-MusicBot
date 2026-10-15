import { ServicePage } from '@/components/service-page';
export const metadata = { title: 'Support | Afterparty' };
export default function Support() {
  return <ServicePage title="Support and privacy requests">
    <p>The Afterparty Discord bot and website are maintained by Discord user <strong>lukasvri</strong>.</p>
    <h2>Contact the maintainer</h2>
    <p>In Discord, contact <strong>lukasvri</strong> in a server shared with the bot, or use Discord’s Add Friend feature to contact that username. Ask for support or a private channel for a data access or deletion request. A server administrator can help you identify the bot’s maintainer.</p>
    <p>If Discord contact is unavailable, <a href="https://github.com/lukasvri/Afterparty-MusicBot/issues/new">open a GitHub issue</a> asking the maintainer for a private contact channel. Do not include personal information, private server or user IDs, tokens, login details or private logs in a public issue.</p>
    <h2>What to include</h2>
    <p>For a bug, describe the command or feature, what you expected and what happened. For privacy requests, state whether you want access, correction, export or deletion. Share account or server identifiers privately when requested so the maintainer can locate the correct records and verify your authority.</p>
    <h2>Manage your installation</h2>
    <p>Use <a href="/admin">server administration</a> for settings, <a href="/install">Install bot</a> to add the bot, or Discord’s server settings to remove it. Read our <a href="/privacy">Privacy Policy</a> for storage and deletion details and our <a href="/terms">Terms of Service</a> for usage rules.</p>
  </ServicePage>;
}
