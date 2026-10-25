/** Explicit negative metadata only. Absence is unknown, never proof of human authorship. */
export function metadataAiGenerated(title: unknown, artist: unknown, description?: unknown, tags?: unknown, containsSyntheticMedia?: unknown): true | undefined {
  if (containsSyntheticMedia === true) return true;
  const strings = [title, artist, description, ...(Array.isArray(tags) ? tags.slice(0, 100) : [])]
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.slice(0, 20000).normalize('NFKC').toLowerCase().replace(/[\u200b-\u200f\u2060\ufeff]/g, '').replace(/[_\u2010-\u2015-]+/g, ' '));
  for (const raw of strings) {
    const text = raw.replace(/\b(?:no|not|without|non)\s+ai(?:\s+(?:generated|music|vocals?|voice))?\b/gu, '');
    if (/\b(?:ai|a\.i\.|artificial intelligence|ki)\s*(?:generated|generert|genererte|generierte|erzeugt|created|produced|composed|assisted|assistert|laget|lagd|produsert|komponert|re\s?creat(?:ed|ion)|remake|rendition|cover|covers|music|musikk|song|songs|vocals?|voice|remix|version|artist)\b/u.test(text) ||
      /\b(?:generated|created|made|produced|composed|sung)\s+(?:entirely\s+)?(?:by|with|using)\s+(?:ai|artificial intelligence|suno|udio)\b/u.test(text) ||
      /\b(?:laget|lagd|produsert|komponert|sunget)\s+(?:av|med|ved hjelp av)\s+(?:ki|ai|kunstig intelligens|suno|udio)\b/u.test(text) ||
      /\b(?:suno|udio)(?:\s+(?:ai|music|song|cover|generated))?\b/u.test(text) ||
      /\b(?:synthetic|cloned)\s+(?:vocals?|voice)\b/u.test(text) ||
      /\bkunst(?:ig|lich(?:e|er)?)\s+intelligen[sz]\b/u.test(text)) return true;
  }
  return undefined;
}
