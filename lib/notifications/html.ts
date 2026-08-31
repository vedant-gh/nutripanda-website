/** Escape untrusted text before interpolating it into an HTML email. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
/** Remove control characters that are invalid in an email subject header. */
export function safeEmailSubjectPart(value: unknown, maxLength = 160): string {
  return String(value ?? '')
    .replace(/[\r\n\0-\x1f\x7f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength)
}
