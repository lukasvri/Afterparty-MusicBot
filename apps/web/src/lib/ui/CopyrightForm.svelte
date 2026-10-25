<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    COPYRIGHT_ACCURACY,
    COPYRIGHT_GOOD_FAITH,
    copyrightContactEmail,
    copyrightMailto,
    copyrightNoticeText,
  } from '../../../../../lib/copyright-notice.ts';

  let { contactEmail }: { contactEmail: string | null } = $props();
  let hydrated = $state(false);
  let notice = $state<string | null>(null);
  let copyStatus = $state('');
  let preview = $state<HTMLTextAreaElement>();
  let form = $state<HTMLFormElement>();
  const recipient = $derived(copyrightContactEmail(contactEmail));
  const mailto = $derived(notice ? copyrightMailto(recipient, notice) : null);
  onMount(() => {
    hydrated = true;
  });

  async function prepare(event: SubmitEvent) {
    event.preventDefault();
    const current = event.currentTarget as HTMLFormElement;
    for (const id of [
      'copyright-name',
      'copyright-works',
      'copyright-locations',
      'copyright-signature',
    ]) {
      const field = current.elements.namedItem(id) as HTMLInputElement | HTMLTextAreaElement;
      field.setCustomValidity(field.value.trim() ? '' : 'Enter the required information.');
    }
    if (!current.reportValidity()) return;
    const text = (id: string) =>
      (current.elements.namedItem(id) as HTMLInputElement | HTMLTextAreaElement).value;
    notice = copyrightNoticeText({
      fullName: text('copyright-name'),
      email: text('copyright-email'),
      address: text('copyright-address'),
      phone: text('copyright-phone'),
      works: text('copyright-works'),
      locations: text('copyright-locations'),
      details: text('copyright-details'),
      signature: text('copyright-signature'),
    });
    copyStatus = '';
    await tick();
    preview?.focus();
  }
  async function reset() {
    notice = null;
    copyStatus = '';
    await tick();
    (form?.elements.namedItem('copyright-name') as HTMLInputElement | null)?.focus();
  }
  async function copy() {
    if (!notice) return;
    const copiedNotice = notice;
    try {
      await navigator.clipboard.writeText(copiedNotice);
      if (notice === copiedNotice)
        copyStatus = 'Notice copied. You still need to send it privately.';
    } catch {
      if (notice !== copiedNotice) return;
      preview?.focus();
      preview?.select();
      copyStatus = 'Automatic copy is unavailable. Select and copy the notice below.';
    }
  }
  function clearValidity(event: Event) {
    (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).setCustomValidity('');
  }
</script>

<section aria-labelledby="copyright-form-title">
  <h2 id="copyright-form-title">Prepare a copyright notice</h2>
  <p>
    This form prepares text on your device. It does not submit a request, upload your information or
    send an email. Review the text, then send it yourself through the private contact channel.
  </p>
  {#if recipient}
    <p>
      Operator contact: <a href={'mailto:' + encodeURIComponent(recipient)}>{recipient}</a>. Opening
      an email draft does not send it.
    </p>
  {:else}
    <p role="status">
      No copyright email address is configured for this installation. You can prepare and copy a
      notice, then ask for a private contact channel through <a href="/support">Support</a>. Do not
      post your notice or contact details in a public GitHub issue.
    </p>
  {/if}
  <!-- Controls intentionally have no names, so native submission cannot serialize private data. -->
  <form bind:this={form} onsubmit={prepare} onreset={reset} autocomplete="off">
    <fieldset disabled={!hydrated}>
      <legend>Your contact details</legend>
      <p class="help">
        Fields marked “required” must be completed. A postal address may be needed for a formal DMCA
        notice, even though it is optional for a general copyright request here.
      </p>
      <div class="fields">
        <label
          >Full name (required)<input
            id="copyright-name"
            oninput={clearValidity}
            required
            maxlength="120"
            autocomplete="off"
          /></label
        >
        <label
          >Contact email (required)<input
            id="copyright-email"
            type="email"
            required
            maxlength="254"
            autocomplete="off"
          /></label
        >
        <label class="wide"
          >Postal address (optional for a general notice)<textarea
            id="copyright-address"
            maxlength="500"
            rows="3"
            autocomplete="off"></textarea></label
        >
        <label
          >Phone (optional)<input
            id="copyright-phone"
            type="tel"
            maxlength="60"
            autocomplete="off"
          /></label
        >
      </div>
      <label
        >Copyrighted works claimed (required)<textarea
          id="copyright-works"
          oninput={clearValidity}
          required
          maxlength="4000"
          rows="4"
          placeholder="Identify each copyrighted work and your relationship to it."
        ></textarea></label
      >
      <label
        >Exact Afterparty locations and identifying details (required)<textarea
          id="copyright-locations"
          oninput={clearValidity}
          required
          maxlength="4000"
          rows="4"
          placeholder="Provide exact page links, room or server details, content identifiers and relevant dates or timestamps. Share private identifiers only through the private contact channel."
        ></textarea></label
      >
      <label
        >Additional information (optional)<textarea id="copyright-details" maxlength="4000" rows="3"
        ></textarea></label
      >
      <div class="statements">
        <label
          ><input id="copyright-good-faith" type="checkbox" required /><span
            >{COPYRIGHT_GOOD_FAITH} (required)</span
          ></label
        >
        <label
          ><input id="copyright-accuracy" type="checkbox" required /><span
            >{COPYRIGHT_ACCURACY} (required)</span
          ></label
        >
      </div>
      <label
        >Typed signature (required)<input
          id="copyright-signature"
          oninput={clearValidity}
          required
          maxlength="120"
          placeholder="Type your full name as your signature."
          autocomplete="off"
        /></label
      >
      <div class="actions">
        <button type="submit" class="primary">Prepare notice</button><button type="reset"
          >Clear form and preview</button
        >
      </div>
    </fieldset>
  </form>
  <noscript
    ><p>
      JavaScript is needed to prepare a notice here. Use <a href="/support">Support</a> to ask for a private
      contact channel.
    </p></noscript
  >
  {#if notice !== null}
    <section class="preview" aria-labelledby="copyright-preview-title">
      <h3 id="copyright-preview-title">Review your notice</h3>
      <p>
        Review and edit this text before sharing it. No request has been submitted through this
        form. You must send the email or share the text privately yourself.
      </p>
      <label for="copyright-preview">Prepared copyright notice</label>
      <textarea
        id="copyright-preview"
        bind:this={preview}
        bind:value={notice}
        maxlength="20000"
        rows="18"
        oninput={() => {
          copyStatus = '';
        }}></textarea>
      <div class="actions">
        <button type="button" disabled={!notice} onclick={copy}>Copy notice</button>{#if mailto}<a
            class="primary"
            href={mailto}>Open email draft</a
          >{/if}
      </div>
      <p class="help">
        Email apps may limit draft size. If the draft does not open correctly, copy the notice into
        your email app or the private channel provided by the operator. Clearing this form removes
        its current fields and preview; it cannot erase text you already copied or shared.
      </p>
      {#if copyStatus}<p role="status">{copyStatus}</p>{/if}
    </section>
  {/if}
</section>

<style>
  fieldset {
    margin: 24px 0;
    padding: 24px;
    border: 1px solid var(--line);
    border-radius: 16px;
    min-width: 0;
  }
  legend {
    padding: 0 8px;
    color: #f2f2f4;
    font-weight: 650;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 20px;
  }
  .wide {
    grid-column: 1 / -1;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 18px 0;
    color: #dedee5;
    font-size: 13px;
  }
  input,
  textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 44px;
    border: 1px solid #424753;
    border-radius: 10px;
    padding: 12px;
    background: #101216;
    color: #f2f2f4;
    font: inherit;
    font-size: 16px;
  }
  textarea {
    resize: vertical;
  }
  .statements label {
    flex-direction: row;
    align-items: flex-start;
    gap: 12px;
  }
  .statements input {
    width: 20px;
    min-height: 20px;
    flex: 0 0 20px;
    margin-top: 2px;
    accent-color: #ff263e;
  }
  .help {
    font-size: 13px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 20px;
  }
  button,
  .actions a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    min-height: 46px;
    padding: 10px 16px;
    border: 1px solid #424753;
    border-radius: 10px;
    background: var(--surface-raised);
    color: white;
    font:
      600 14px Inter,
      system-ui,
      sans-serif;
    text-decoration: none;
    cursor: pointer;
  }
  .primary {
    background: #ff263e !important;
    border-color: #ff263e !important;
    color: #100b0e !important;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .preview {
    border-top: 1px solid #303036;
    margin-top: 32px;
    padding-top: 12px;
  }
  @media (max-width: 600px) {
    .fields {
      grid-template-columns: 1fr;
    }
    fieldset {
      padding: 16px;
    }
  }
</style>
