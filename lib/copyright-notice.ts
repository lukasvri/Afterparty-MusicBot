/** An address only, never a mailto URL or email header supplied by configuration. */
export function copyrightContactEmail(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 254 || /[\s%?&#=:/\\]/.test(value)) return null;
  const parts = value.split('@');
  if (parts.length !== 2 || parts[0].length > 64 ||
    !/^[A-Za-z0-9_+-]+(?:\.[A-Za-z0-9_+-]+)*$/.test(parts[0]) ||
    !/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(parts[1])) return null;
  return value;
}

export const COPYRIGHT_GOOD_FAITH = 'I have a good faith belief that the disputed use is not authorized by the copyright owner, its agent, or the law.';
export const COPYRIGHT_ACCURACY = 'The information in this notice is accurate and, under penalty of perjury, I am the copyright owner or authorized to act on the owner’s behalf.';

export type CopyrightNoticeFields = {
  fullName: string; email: string; address: string; phone: string;
  works: string; locations: string; details: string; signature: string;
};

export function copyrightNoticeText(fields: CopyrightNoticeFields): string {
  return ['Copyright removal request for Afterparty', '',
    'Full name: ' + fields.fullName.trim(), 'Contact email: ' + fields.email.trim(),
    'Postal address: ' + (fields.address.trim() || 'Not provided (optional for a general notice)'),
    'Phone: ' + (fields.phone.trim() || 'Not provided (optional)'), '',
    'Copyrighted work(s) claimed:', fields.works.trim(), '',
    'Exact Afterparty location(s) and identifying details:', fields.locations.trim(), '',
    'Additional information:', fields.details.trim() || 'None provided', '',
    'Statements:', COPYRIGHT_GOOD_FAITH, COPYRIGHT_ACCURACY, '',
    'Typed signature: ' + fields.signature.trim(),
  ].join('\n');
}

export function copyrightMailto(recipient: unknown, notice: string): string | null {
  const email = copyrightContactEmail(recipient);
  return email ? 'mailto:' + encodeURIComponent(email) + '?subject=' +
    encodeURIComponent('Afterparty copyright removal request') + '&body=' + encodeURIComponent(notice.toWellFormed()) : null;
}
