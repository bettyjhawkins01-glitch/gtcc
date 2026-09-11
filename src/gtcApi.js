// ── gtcApi.js — GTC & VerifyKit API client + auto-register flow ───────────
import axios from 'axios'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import {
  GTC_BASE, HMAC_KEY,
  VFK_BASE, VFK_HMAC_KEY, VFK_CLIENT_KEY, VFK_FINAL_KEY,
  CRED_FILE
} from './config.js'
import { ts, sig, enc, dec } from './crypto.js'

// ── shared cred state (mutable, di-reload setelah relogin) ────────────────
let _creds = null
export function loadCreds() {
  const store = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'))
  const c = store.credentials[store.active]
  _creds = { store, token: c.token, finalKey: c.finalKey, deviceId: c.clientDeviceId }
  return _creds
}
export function reloadCreds() { return loadCreds() }
export function getCreds()    { return _creds || loadCreds() }

// ── crypto helpers lokal (VFK pakai FINAL_KEY sendiri) ────────────────────
function pad(b) { const n = 16 - b.length % 16; return Buffer.concat([b, Buffer.alloc(n, n)]) }
function vfkEnc(d) {
  const c = crypto.createCipheriv('aes-256-ecb', Buffer.from(VFK_FINAL_KEY, 'hex'), null)
  c.setAutoPadding(false)
  return c.update(pad(Buffer.from(d, 'utf8'))).toString('base64') + c.final('base64')
}
function vfkDec(d) {
  const c = crypto.createDecipheriv('aes-256-ecb', Buffer.from(VFK_FINAL_KEY, 'hex'), null)
  c.setAutoPadding(false)
  const o = Buffer.concat([c.update(Buffer.from(d, 'base64')), c.final()])
  return o.subarray(0, o.length - o[o.length - 1]).toString('utf8')
}
function vfkSig(t, raw) {
  return crypto.createHmac('sha256', Buffer.from(VFK_HMAC_KEY, 'hex'))
    .update(`${t}-${raw}`).digest('base64')
}

// ── GTC request helpers ────────────────────────────────────────────────────
export async function gtc(endpoint, payload) {
  const { token, finalKey, deviceId } = getCreds()
  const raw = JSON.stringify(payload), t = ts()
  const h = {
    'Content-Type': 'application/json', 'x-os': 'android 9', 'x-app-version': '8.4.0',
    'x-client-device-id': deviceId, 'x-lang': 'en_US', 'x-req-timestamp': t,
    'x-country-code': 'id', 'x-encrypted': '1',
    'x-req-signature': sig(t, raw, HMAC_KEY), 'x-token': token
  }
  const body = JSON.stringify({ data: enc(raw, finalKey) })
  const r = await axios.post(GTC_BASE + endpoint, body, { headers: h, timeout: 15000 })
  let p = r.data; if (p.data) p = JSON.parse(dec(p.data, finalKey)); return p
}

export async function gtcPlain(endpoint, payload, devId) {
  const raw = JSON.stringify(payload), t = ts()
  const h = {
    'Content-Type': 'application/json', 'x-os': 'android 9', 'x-app-version': '8.4.0',
    'x-client-device-id': devId, 'x-lang': 'en_US', 'x-req-timestamp': t,
    'x-country-code': 'id', 'x-encrypted': '0', 'x-req-signature': sig(t, raw, HMAC_KEY)
  }
  const r = await axios.post(GTC_BASE + endpoint, raw, { headers: h, timeout: 20000 })
  return r.data
}

export async function gtcEnc(endpoint, payload, token, finalKey, devId) {
  const raw = JSON.stringify(payload), t = ts()
  const body = JSON.stringify({ data: enc(raw, finalKey) })
  const h = {
    'Content-Type': 'application/json', 'x-os': 'android 9', 'x-app-version': '8.4.0',
    'x-client-device-id': devId, 'x-lang': 'en_US', 'x-req-timestamp': t,
    'x-country-code': 'id', 'x-encrypted': '1',
    'x-req-signature': sig(t, raw, HMAC_KEY), 'x-token': token
  }
  const r = await axios.post(GTC_BASE + endpoint, body, { headers: h, timeout: 20000 })
  let p = r.data; if (p.data) p = JSON.parse(dec(p.data, finalKey)); return p
}

// ── VerifyKit request helper ───────────────────────────────────────────────
export async function vfkCall(endpoint, payload, devId) {
  const raw = JSON.stringify(payload, null, 0), t = ts()
  const body = JSON.stringify({ data: vfkEnc(raw) })
  const h = {
    'Content-Type': 'application/json',
    'X-VFK-Client-Device-Id': devId, 'X-VFK-Client-Key': VFK_CLIENT_KEY,
    'X-VFK-Sdk-Version': '0.11.4', 'X-VFK-Os': 'android 9.0', 'X-VFK-App-Version': '8.16.0',
    'X-VFK-Encrypted': '1', 'X-VFK-Lang': 'in_ID', 'X-VFK-Req-Timestamp': t,
    'X-VFK-Req-Signature': vfkSig(t, raw)
  }
  const r = await axios.post(VFK_BASE + endpoint, body, { headers: h, timeout: 20000 })
  let p = r.data; if (p.data) p = JSON.parse(vfkDec(p.data)); return p
}

// ── DH key exchange (kecil, sesuai GTC) ───────────────────────────────────
const DH_P = 900719898367n, DH_G = 7n
function powMod(base, exp, mod) {
  let r = 1n; base %= mod
  while (exp > 0n) { if (exp % 2n === 1n) r = r * base % mod; exp /= 2n; base = base * base % mod }
  return r
}
function dhPub(priv) { return Number(powMod(DH_G, BigInt(priv), DH_P)) }
function dhKey(srvPub, priv) {
  const shared = powMod(BigInt(srvPub), BigInt(priv), DH_P)
  return crypto.createHash('sha256').update(String(shared)).digest('hex')
}

// ── Relogin state ──────────────────────────────────────────────────────────
let pendingRelogin = null
export function getPendingRelogin() { return pendingRelogin }
export function clearPendingRelogin() { pendingRelogin = null }

// ── cmdRelogin: generate GTC session + VFK deeplink untuk nomor baru ──────
export async function cmdRelogin(phone, normalize, requesterJid) {
  const phoneNorm = normalize(phone) || ('+62' + phone.replace(/\D/g, '').replace(/^0/, ''))
  const devId = crypto.randomBytes(8).toString('hex')
  const priv  = Math.floor(Math.random() * (10 ** 8 - 10 ** 6)) + 10 ** 6
  const pub   = dhPub(priv)

  // 1. Register device baru di GTC
  const reg = await gtcPlain('/v2.8/register', {
    carrierCountryCode: '510', carrierName: 'Indosat Ooredoo', carrierNetworkCode: '01',
    countryCode: 'id', deepLink: null, deviceName: 'SM-G977N', deviceType: 'Android',
    email: null, notificationToken: '', oldToken: null, peerKey: pub,
    timeZone: 'Asia/Bangkok', token: ''
  }, devId)
  const token  = reg?.result?.token
  const srvKey = reg?.result?.serverKey
  if (!token || !srvKey) throw new Error('Register gagal: ' + JSON.stringify(reg))
  const finalKey = dhKey(srvKey, priv)

  // 2. Init chain
  const base = {
    carrierCountryCode: '510', carrierName: 'Indosat Ooredoo', carrierNetworkCode: '01',
    countryCode: 'id', deviceName: 'SM-G977N', notificationToken: '',
    timeZone: 'Asia/Bangkok', token
  }
  await gtcEnc('/v2.8/init-basic',       base,                                    token, finalKey, devId)
  await gtcEnc('/v2.8/ad-settings',      { source: 'init', token },               token, finalKey, devId)
  await gtcEnc('/v2.8/init-intro',       { ...base, hasRouting: false },           token, finalKey, devId)
  await gtcEnc('/v2.8/validation-start', { app: 'verifykit', countryCode: 'id', notificationToken: '', token }, token, finalKey, devId)

  // 3. VFK flow
  await vfkCall('/v2.0/init', {
    isCallPermissionGranted: true, countryCode: 'ID', deviceName: 'SM-G977N',
    installedApps: '{"whatsapp":0,"telegram":0,"viber":0}',
    outsideCountryCode: 'ID', outsidePhoneNumber: phoneNorm,
    timezone: 'Asia/Bangkok', bundleId: 'app.source.getcontact'
  }, devId)
  await vfkCall('/v2.0/country', { countryCode: 'ID', bundleId: 'app.source.getcontact' }, devId)
  const vfkStart = await vfkCall('/v2.0/start', {
    countryCode: 'ID', mcc: '510', mnc: '01', phoneNumber: phoneNorm,
    app: 'whatsapp', bundleId: 'app.source.getcontact'
  }, devId)

  const deeplink  = vfkStart?.result?.deeplink  || ''
  const reference = vfkStart?.result?.reference || ''
  if (!deeplink || !reference) throw new Error('VFK start gagal: ' + JSON.stringify(vfkStart))

  // Extract kode dari deeplink
  const decoded = decodeURIComponent(deeplink)
  const codes   = [...decoded.matchAll(/\*(.*?)\*/g)].map(m => m[1])
  const waCode  = codes.find(c => /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(c)) || ''

  pendingRelogin = { token, finalKey, devId, reference, phone: phoneNorm, requester: requesterJid }
  return { deeplink, waCode, reference }
}

// ── cmdReloginVerify: setelah user kirim WA ke GTC ────────────────────────
export async function cmdReloginVerify() {
  if (!pendingRelogin) throw new Error('Tidak ada sesi relogin aktif')
  const { token, finalKey, devId, reference, phone } = pendingRelogin

  // VFK check
  const chk = await vfkCall('/v2.0/check', { reference, bundleId: 'app.source.getcontact' }, devId)
  const sessionId = chk?.result?.sessionId
  if (!sessionId) throw new Error('Belum terverifikasi — kirim dulu pesannya ke WA GTC')

  // GTC verifykit-result
  const vkr = await gtcEnc('/v2.8/verifykit-result', { sessionId, token }, token, finalKey, devId)
  const valDate = vkr?.result?.validationDate
  if (!valDate) throw new Error('verifykit-result gagal: ' + JSON.stringify(vkr))

  // Simpan credential baru
  const store = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8'))
  store.active = phone
  store.credentials[phone] = {
    description: `Generated ${valDate}`,
    phoneNumber: phone, clientDeviceId: devId,
    finalKey, token, validationDate: valDate
  }
  fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true })
  fs.writeFileSync(CRED_FILE, JSON.stringify(store, null, 2))
  reloadCreds()
  pendingRelogin = null

  // Cek quota
  const sub = await gtc('/v2.8/subscription', { token: getCreds().token })
  return sub
}

// ── autoRegisterGTC: daftarkan nomor baru ke GTC (tanpa VerifyKit dulu) ──
// Kalau ingin login GTC otomatis dari env, panggil ini saat startup.
export async function autoRegisterGTC(phoneNorm) {
  const devId = crypto.randomBytes(8).toString('hex')
  const priv  = Math.floor(Math.random() * (10 ** 8 - 10 ** 6)) + 10 ** 6
  const pub   = dhPub(priv)
  const reg   = await gtcPlain('/v2.8/register', {
    carrierCountryCode: '510', carrierName: 'Indosat Ooredoo', carrierNetworkCode: '01',
    countryCode: 'id', deepLink: null, deviceName: 'SM-G977N', deviceType: 'Android',
    email: null, notificationToken: '', oldToken: null, peerKey: pub,
    timeZone: 'Asia/Bangkok', token: ''
  }, devId)
  const token  = reg?.result?.token
  const srvKey = reg?.result?.serverKey
  if (!token || !srvKey) throw new Error('autoRegister gagal: ' + JSON.stringify(reg))
  const finalKey = dhKey(srvKey, priv)
  return { token, finalKey, devId }
}
