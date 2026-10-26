<script lang="ts">
  import PublicPage from '#lib/ui/PublicPage.svelte';
  import CopyrightForm from '#lib/ui/CopyrightForm.svelte';

  let { data }: { data: { contactEmail: string | null } } = $props();
</script>

<PublicPage title="Copyright and removal requests">
  <p>
    Use this form to prepare a copyright notice or a request to remove access to material on
    Afterparty. Identify the work you represent and the exact page, link or game where you found the
    material. Do not include passwords, tokens, identity documents or private room host links.
  </p>
  <p>
    The form prepares a message on your device. Afterparty does not receive it until you send it
    through a contact channel. Preparing a request does not remove content automatically.
  </p>
  <CopyrightForm contactEmail={data.contactEmail} />
  <h2>What happens next</h2>
  <p>
    The maintainer reviews received requests, may ask for enough information to locate the material
    and verify your authority, and can remove or disable access to material controlled by this
    installation. If another service hosts the original media, contact that service to request
    removal there as well.
  </p>
  <p>
    For a disputed removal or a request to correct a notice, contact the maintainer privately
    through <a href="/support">Support</a>. This page does not identify a registered DMCA agent or
    claim eligibility for a legal safe harbor. The
    <a href="https://www.copyright.gov/512/">U.S. Copyright Office</a> explains the notice and counter-notice
    process.
  </p>
  <p>
    We use notices and contact details to investigate and respond to the request. Information
    necessary to handle a dispute may need to be shared with the affected content provider. Avoid
    unrelated personal information. Read our <a href="/privacy">Privacy Policy</a> and
    <a href="/terms">Terms of Service</a>.
  </p>
</PublicPage>
