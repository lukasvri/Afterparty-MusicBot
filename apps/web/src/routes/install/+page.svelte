<script lang="ts">
  import PublicPage from '#lib/ui/PublicPage.svelte';
</script>

<PublicPage title="Add Afterparty to your server">
  <p>
    Play music in Discord, save favorites and share concerts with Afterparty. You need permission to
    manage the Discord server where you install the bot.
  </p>
  <p><a class="service-action" href="/api/bot/install">Add to Discord</a></p>
  <p>
    Discord will show the selected server and requested permissions before you authorize
    installation. The bot uses channel and player-message permissions plus voice connection and
    audio playback permissions. Administrator permission is not requested.
  </p>
  <h2>Start listening</h2>
  <ol>
    <li>Choose your server in Discord’s installation screen and review its permissions.</li>
    <li>Join a voice channel and use <code>/play</code> with a search or supported music link.</li>
    <li>
      Use <code>/concert</code> to share a concert, or open
      <a href="/admin">server administration</a> for settings.
    </li>
  </ol>
  <p>
    Review the <a href="/terms">Terms of Service</a> and <a href="/privacy">Privacy Policy</a>.
    Installation does not require sharing your Discord password with us. For help, visit
    <a href="/support">Support</a>.
  </p>
</PublicPage>
