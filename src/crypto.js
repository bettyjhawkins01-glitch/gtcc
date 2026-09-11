// ── crypto.js — AES-256-ECB + HMAC helpers ────────────────────────────────
import crypto from 'crypto'

export function ts() { return String(Date.now()) }

export function sig(t, m, k) {
  return crypto.createHmac('sha256', Buffer.from(k, 'hex'))
    .update(`${t}-${m}`).digest('base64')
}

function pad(b) {
  const n = 16 - b.length % 16
  return Buffer.concat([b, Buffer.alloc(n, n)])
}

export function enc(d, k) {
  const c = crypto.createCipheriv('aes-256-ecb', Buffer.from(k, 'hex'), null)
  c.setAutoPadding(false)
  return c.update(pad(Buffer.from(d, 'utf8'))).toString('base64') + c.final('base64')
}

export function dec(d, k) {
  const c = crypto.createDecipheriv('aes-256-ecb', Buffer.from(k, 'hex'), null)
  c.setAutoPadding(false)
  const o = Buffer.concat([c.update(Buffer.from(d, 'base64')), c.final()])
  return o.subarray(0, o.length - o[o.length - 1]).toString('utf8')
}
