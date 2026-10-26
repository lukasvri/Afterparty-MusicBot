import { env } from 'cloudflare:workers';
import { copyrightContactEmail } from '../../../../../lib/copyright-notice.ts';

export function load() {
  return {
    contactEmail: copyrightContactEmail(
      env.COPYRIGHT_CONTACT_EMAIL ?? 'afterparty.affirm544@passmail.net',
    ),
  };
}
