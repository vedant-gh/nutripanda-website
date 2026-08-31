import assert from 'node:assert/strict'
import test from 'node:test'
import { escapeHtml, safeEmailSubjectPart } from '../../lib/notifications/html.ts'
import {
  isIdempotencyKey,
  isTemplateForChannel,
  safeTrackingUrl,
  sanitizeNotificationPayload,
} from '../../lib/notifications/input.ts'

test('email interpolation escapes every HTML-significant character', () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('x')"> & goodbye`),
    '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; goodbye'
  )
  assert.equal(safeEmailSubjectPart('NP-1\r\nBcc: attacker@example.com'), 'NP-1 Bcc: attacker@example.com')
})
test('notification channel/template pairs are allowlisted', () => {
  assert.equal(isTemplateForChannel('email', 'order_confirmation'), true)
  assert.equal(isTemplateForChannel('email', 'shipping_update'), false)
  assert.equal(isTemplateForChannel('whatsapp', 'shipping_update'), true)
  assert.equal(isTemplateForChannel('whatsapp', 'made_up'), false)
})

test('idempotency keys and tracking links reject unsafe input', () => {
  assert.equal(isIdempotencyKey('order:abc:email:confirmation'), true)
  assert.equal(isIdempotencyKey('short'), false)
  assert.equal(isIdempotencyKey('order key with spaces'), false)
  assert.equal(safeTrackingUrl('javascript:alert(1)'), null)
  assert.equal(safeTrackingUrl('https://tracking.example/awb/123'), 'https://tracking.example/awb/123')
  assert.deepEqual(sanitizeNotificationPayload({ tracking_link: 123 }), {})
})
