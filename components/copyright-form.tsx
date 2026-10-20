'use client';
import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { COPYRIGHT_ACCURACY, COPYRIGHT_GOOD_FAITH, copyrightContactEmail, copyrightMailto, copyrightNoticeText } from '../lib/copyright-notice.ts';
import './copyright-form.css';

const subscribe = () => () => {};

export function CopyrightForm({ contactEmail }: { contactEmail: string | null }) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const [notice, setNotice] = useState<string | null>(null), [copyStatus, setCopyStatus] = useState('');
  const preview = useRef<HTMLTextAreaElement>(null), form = useRef<HTMLFormElement>(null);
  const recipient = copyrightContactEmail(contactEmail);
  const mailto = notice ? copyrightMailto(recipient, notice) : null;
  // No controls have names: even native/no-JS submission cannot put private fields in a URL.
  const prepare = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const current = event.currentTarget;
    for (const id of ['copyright-name', 'copyright-works', 'copyright-locations', 'copyright-signature']) {
      const field = current.elements.namedItem(id) as HTMLTextAreaElement;
      field.setCustomValidity(field.value.trim() ? '' : 'Enter the required information.');
    }
    if (!current.reportValidity()) return;
    const text = (id: string) => (current.elements.namedItem(id) as HTMLInputElement | HTMLTextAreaElement).value;
    setNotice(copyrightNoticeText({ fullName: text('copyright-name'), email: text('copyright-email'), address: text('copyright-address'),
      phone: text('copyright-phone'), works: text('copyright-works'), locations: text('copyright-locations'), details: text('copyright-details'), signature: text('copyright-signature') }));
    setCopyStatus('');
    requestAnimationFrame(() => preview.current?.focus());
  };
  const copy = async () => {
    if (!notice) return;
    try {
      if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(notice);
      if (preview.current?.value === notice) setCopyStatus('Notice copied. You still need to send it privately.');
    } catch {
      if (preview.current?.value !== notice) return;
      preview.current.focus(); preview.current.select();
      setCopyStatus('Automatic copy is unavailable. Select and copy the notice below.');
    }
  };
  return <section className="copyright-form" aria-labelledby="copyright-form-title">
    <h2 id="copyright-form-title">Prepare a copyright notice</h2>
    <p>This form prepares text on your device. It does not submit a request, upload your information or send an email. Review the text, then send it yourself through the private contact channel.</p>
    {recipient ? <p className="copyright-contact">Operator contact: <a href={'mailto:' + encodeURIComponent(recipient)}>{recipient}</a>. Opening an email draft does not send it.</p>
      : <p className="copyright-contact" role="status">No copyright email address is configured for this installation. You can prepare and copy a notice, then ask for a private contact channel through <a href="/support">Support</a>. Do not post your notice or contact details in a public GitHub issue.</p>}
    <form ref={form} onSubmit={prepare} onReset={() => { setNotice(null); setCopyStatus(''); requestAnimationFrame(() => (form.current?.elements.namedItem('copyright-name') as HTMLInputElement | null)?.focus()); }} autoComplete="off">
      <fieldset disabled={!hydrated}>
        <legend>Your contact details</legend>
        <p className="copyright-help">Fields marked “required” must be completed. A postal address may be needed for a formal DMCA notice, even though it is optional for a general copyright request here.</p>
        <div className="copyright-fields">
          <label>Full name (required)<input id="copyright-name" onInput={event => event.currentTarget.setCustomValidity('')} required maxLength={120} autoComplete="off" /></label>
          <label>Contact email (required)<input id="copyright-email" type="email" required maxLength={254} autoComplete="off" /></label>
          <label className="copyright-wide">Postal address (optional for a general notice)<textarea id="copyright-address" maxLength={500} rows={3} autoComplete="off" /></label>
          <label>Phone (optional)<input id="copyright-phone" type="tel" maxLength={60} autoComplete="off" /></label>
        </div>
        <label>Copyrighted works claimed (required)<textarea id="copyright-works" onInput={event => event.currentTarget.setCustomValidity('')} required maxLength={4000} rows={4} placeholder="Identify each copyrighted work and your relationship to it." /></label>
        <label>Exact Afterparty locations and identifying details (required)<textarea id="copyright-locations" onInput={event => event.currentTarget.setCustomValidity('')} required maxLength={4000} rows={4} placeholder="Provide exact page links, room or server details, content identifiers and relevant dates or timestamps. Share private identifiers only through the private contact channel." /></label>
        <label>Additional information (optional)<textarea id="copyright-details" maxLength={4000} rows={3} /></label>
        <div className="copyright-statements">
          <label><input id="copyright-good-faith" type="checkbox" required /> <span>{COPYRIGHT_GOOD_FAITH} (required)</span></label>
          <label><input id="copyright-accuracy" type="checkbox" required /> <span>{COPYRIGHT_ACCURACY} (required)</span></label>
        </div>
        <label>Typed signature (required)<input id="copyright-signature" onInput={event => event.currentTarget.setCustomValidity('')} required maxLength={120} placeholder="Type your full name as your signature." autoComplete="off" /></label>
        <div className="copyright-actions"><button type="submit" className="button primary">Prepare notice</button><button type="reset" className="button subtle">Clear form and preview</button></div>
      </fieldset>
    </form>
    <noscript><p>JavaScript is needed to prepare a notice here. Use <a href="/support">Support</a> to ask for a private contact channel.</p></noscript>
    {notice !== null && <section className="copyright-preview" aria-labelledby="copyright-preview-title">
      <h3 id="copyright-preview-title">Review your notice</h3>
      <p>Review and edit this text before sharing it. No request has been submitted through this form. You must send the email or share the text privately yourself.</p>
      <label htmlFor="copyright-preview">Prepared copyright notice</label>
      <textarea id="copyright-preview" ref={preview} value={notice} maxLength={20000} rows={18} onChange={event => { setNotice(event.target.value); setCopyStatus(''); }} />
      <div className="copyright-actions"><button type="button" className="button" disabled={!notice} onClick={() => void copy()}>Copy notice</button>{mailto && <a className="button primary" href={mailto}>Open email draft</a>}</div>
      <p className="copyright-help">Email apps may limit draft size. If the draft does not open correctly, copy the notice into your email app or the private channel provided by the operator. Clearing this form removes its current fields and preview; it cannot erase text you already copied or shared.</p>
      {copyStatus && <p role="status">{copyStatus}</p>}
    </section>}
  </section>;
}
