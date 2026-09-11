#!/usr/bin/env node
// ── setup-gtc.mjs — CLI interaktif untuk setup akun GTC dari awal ─────────
// Jalankan: node setup-gtc.mjs
// Tidak butuh WA bot jalan. Cukup punya nomor WA yang mau didaftarkan ke GTC.

import 'dotenv/config'
import readline from 'readline'
import crypto from 'crypto'
import axios from 'axios'
import fs from 'fs'
import path from 'path'

// ── Config ─────────────────────────────────────────────────────────────────
const CRED_FILE    = process.env.CRED_FILE   || (process.env.HOME + '/.config/gtc/credentials.json')
const GTC_BASE     = 'https://pbssrv-centralevents.com'
const VFK_BASE     = 'https://api.verifykit.com'
const HMAC_KEY     = '31426764382a642f3a6665497235466f3d236d5d785b722b4c657457442a495b494524324866782a2364292478587a78662d7a7b7578593f71703e2b7e365762'
const VFK_HMAC_KEY = '3452235d713252604a35562d325f765238695738485863672a705e6841544d3c7e6e45463028266f372b544e596f3829236b392825262e534a7e774f37653932'
const VFK_CLIENT_KEY = 'bhvbd7ced119dc6ad6a0b35bd3cf836555d6f71930d9e5a405f32105c790d'
const VFK_FINAL_KEY  = 'bd48d8c25293cfb537619cc93ae3d6e372eb2ddfffff4ab0eb000777144c7bfa'
const DH_P = 900719898367n, DH_G = 7n

// ── Crypto helpers ─────────────────────────────────────────────────────────
function ts() { return String(Date.now()) }
function sig(t, m, k) {
  return crypto.createHmac('sha256', Buffer.from(k, 'hex')).update(`${t}-${m}`).digest('base64')
}
function pad(b) { const n = 16 - b.length % 16; return Buffer.concat([b, Buffer.alloc(n, n)]) }
function enc(d, k) {
  const c = crypto.createCipheriv('aes-256-ecb', Buffer.from(k, 'hex'), null)
  c.setAutoPadding(false)
  return c.update(pad(Buffer.from(d, 'utf8'))).toString('base64') + c.final('base64')
}
function dec(d, k) {
  const c = crypto.createDecipheriv('aes-256-ecb', Buffer.from(k, 'hex'), null)
  c.setAutoPadding(false)
  const o = Buffer.concat([c.update(Buffer.from(d, 'base64')), c.final()])
  return o.subarray(0, o.length - o[o.length - 1]).toString('utf8')
}
function vfkEnc(d) { return enc(d, VFK_FINAL_KEY) }
function vfkDec(d) { return dec(d, VFK_FINAL_KEY) }
function vfkSig(t, raw) {
  return crypto.createHmac('sha256', Buffer.from(VFK_HMAC_KEY, 'hex')).update(`${t}-${raw}`).digest('base64')
}
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

// ── API helpers ────────────────────────────────────────────────────────────
async function gtcPlain(endpoint, payload, devId) {
  const raw = JSON.stringify(payload), t = ts()
  const h = {
    'Content-Type': 'application/json', 'x-os': 'android 9', 'x-app-version': '8.4.0',
    'x-client-device-id': devId, 'x-lang': 'en_US', 'x-req-timestamp': t,
    'x-country-code': 'id', 'x-encrypted': '0', 'x-req-signature': sig(t, raw, HMAC_KEY)
  }
  const r = await axios.post(GTC_BASE + endpoint, raw, { headers: h, timeout: 20000 })
  return r.data
}
async function gtcEnc(endpoint, payload, token, finalKey, devId) {
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
async function vfkCall(endpoint, payload, devId) {
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

// ── Input helper ───────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
function ask(q) { return new Promise(res => rl.question(q, ans => res(ans.trim()))) }
function normalize(raw) {
  let p = raw.replace(/[^\d+]/g, '').trim()
  if (p.startsWith('+62')) return p
  if (p.startsWith('08'))  return '+62' + p.slice(1)
  if (p.startsWith('628')) return '+' + p
  if (p.startsWith('62'))  return '+' + p
  if (p.startsWith('0'))   return '+62' + p.slice(1)
  if (p.startsWith('+'))   return p
  return '+' + p
}

// ── UI helpers ─────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m', blue: '\x1b[34m'
}
function log(msg)    { console.log(msg) }
function ok(msg)     { console.log(`${C.green}✅ ${msg}${C.reset}`) }
function warn(msg)   { console.log(`${C.yellow}⚠️  ${msg}${C.reset}`) }
function err(msg)    { console.log(`${C.red}❌ ${msg}${C.reset}`) }
function info(msg)   { console.log(`${C.cyan}ℹ️  ${msg}${C.reset}`) }
function step(n, msg){ console.log(`\n${C.bold}${C.blue}[${n}]${C.reset} ${C.bold}${msg}${C.reset}`) }
function box(title, lines) {
  const w = Math.max(title.length, ...lines.map(l => l.length)) + 4
  console.log(`\n╔${'═'.repeat(w)}╗`)
  console.log(`║  ${C.bold}${title.padEnd(w - 2)}${C.reset}║`)
  console.log(`╠${'═'.repeat(w)}╣`)
  for (const l of lines) console.log(`║  ${l.padEnd(w - 2)}║`)
  console.log(`╚${'═'.repeat(w)}╝`)
}

// ── Main flow ──────────────────────────────────────────────────────────────
async function main() {
  console.clear()
  log(`${C.bold}${C.cyan}`)
  log(`  ╔═══════════════════════════════════════╗`)
  log(`  ║     GTC WhatsApp Bot — Setup CLI      ║`)
  log(`  ║   Daftar akun GTC untuk nomor baru    ║`)
  log(`  ╚═══════════════════════════════════════╝`)
  log(`${C.reset}`)

  // ── Cek creds yang sudah ada ────────────────────────────────────────────
  let store = { active: null, credentials: {} }
  if (fs.existsSync(CRED_FILE)) {
    try { store = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')) } catch { /* ok */ }
    const existing = Object.keys(store.credentials || {})
    if (existing.length > 0) {
      warn(`Sudah ada ${existing.length} akun GTC tersimpan:`)
      existing.forEach((k, i) => log(`  ${i + 1}. ${k}${k === store.active ? ' ← aktif' : ''}`))
      const cont = await ask(`\nTambah akun baru? (y/N): `)
      if (!['y', 'yes'].includes(cont.toLowerCase())) {
        const switchAns = await ask(`Switch akun aktif? Ketik nomor atau Enter untuk batal: `)
        if (switchAns && store.credentials[normalize(switchAns)]) {
          store.active = normalize(switchAns)
          fs.writeFileSync(CRED_FILE, JSON.stringify(store, null, 2))
          ok(`Akun aktif diganti ke ${store.active}`)
        }
        rl.close(); return
      }
    }
  }

  // ── Step 1: input nomor ─────────────────────────────────────────────────
  step(1, 'Nomor WhatsApp yang akan didaftarkan ke GTC')
  info('Nomor ini akan dipakai untuk verifikasi via WA GTC.')
  info('Format: 08xxx / 628xxx / +628xxx')
  const rawPhone = await ask(`\nNomor: `)
  const phone = normalize(rawPhone)
  if (!phone || phone.replace(/\D/g, '').length < 9) {
    err('Nomor tidak valid.'); rl.close(); return
  }
  ok(`Nomor: ${phone}`)

  // ── Step 2: Register device ke GTC ─────────────────────────────────────
  step(2, 'Register device baru ke server GTC...')
  const devId = crypto.randomBytes(8).toString('hex')
  const priv  = Math.floor(Math.random() * (10 ** 8 - 10 ** 6)) + 10 ** 6
  const pub   = dhPub(priv)

  let token, finalKey
  try {
    const reg = await gtcPlain('/v2.8/register', {
      carrierCountryCode: '510', carrierName: 'Indosat Ooredoo', carrierNetworkCode: '01',
      countryCode: 'id', deepLink: null, deviceName: 'SM-G977N', deviceType: 'Android',
      email: null, notificationToken: '', oldToken: null, peerKey: pub,
      timeZone: 'Asia/Bangkok', token: ''
    }, devId)
    token    = reg?.result?.token
    const srvKey = reg?.result?.serverKey
    if (!token || !srvKey) throw new Error(JSON.stringify(reg))
    finalKey = dhKey(srvKey, priv)
    ok('Device registered, token diterima')
  } catch (e) { err('Register gagal: ' + e.message); rl.close(); return }

  // ── Step 3: Init chain ──────────────────────────────────────────────────
  step(3, 'Init session GTC...')
  try {
    const base = {
      carrierCountryCode: '510', carrierName: 'Indosat Ooredoo', carrierNetworkCode: '01',
      countryCode: 'id', deviceName: 'SM-G977N', notificationToken: '',
      timeZone: 'Asia/Bangkok', token
    }
    await gtcEnc('/v2.8/init-basic',       base,                                       token, finalKey, devId)
    await gtcEnc('/v2.8/ad-settings',      { source: 'init', token },                  token, finalKey, devId)
    await gtcEnc('/v2.8/init-intro',       { ...base, hasRouting: false },              token, finalKey, devId)
    await gtcEnc('/v2.8/validation-start', { app: 'verifykit', countryCode: 'id', notificationToken: '', token }, token, finalKey, devId)
    ok('Init chain selesai')
  } catch (e) { err('Init gagal: ' + e.message); rl.close(); return }

  // ── Step 4: VerifyKit flow ──────────────────────────────────────────────
  step(4, 'Mulai VerifyKit flow untuk verifikasi nomor...')
  let deeplink, waCode, reference
  try {
    await vfkCall('/v2.0/init', {
      isCallPermissionGranted: true, countryCode: 'ID', deviceName: 'SM-G977N',
      installedApps: '{"whatsapp":0,"telegram":0,"viber":0}',
      outsideCountryCode: 'ID', outsidePhoneNumber: phone,
      timezone: 'Asia/Bangkok', bundleId: 'app.source.getcontact'
    }, devId)
    await vfkCall('/v2.0/country', { countryCode: 'ID', bundleId: 'app.source.getcontact' }, devId)
    const vfkStart = await vfkCall('/v2.0/start', {
      countryCode: 'ID', mcc: '510', mnc: '01', phoneNumber: phone,
      app: 'whatsapp', bundleId: 'app.source.getcontact'
    }, devId)
    deeplink  = vfkStart?.result?.deeplink  || ''
    reference = vfkStart?.result?.reference || ''
    if (!deeplink || !reference) throw new Error('Deeplink kosong: ' + JSON.stringify(vfkStart))

    const decoded = decodeURIComponent(deeplink)
    const codes   = [...decoded.matchAll(/\*(.*?)\*/g)].map(m => m[1])
    waCode = codes.find(c => /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(c)) || ''
    ok('VerifyKit session siap')
  } catch (e) { err('VerifyKit gagal: ' + e.message); rl.close(); return }

  // ── Step 5: Instruksi kirim WA ──────────────────────────────────────────
  step(5, 'Kirim pesan verifikasi ke WA GetContact')
  box('📲 INSTRUKSI', [
    `Buka WhatsApp di HP kamu`,
    `Klik link ini (atau salin & kirim manual):`,
    ``,
    deeplink.length > 60 ? deeplink.slice(0, 60) + '…' : deeplink,
    ``,
    `Kode verifikasi: ${waCode || '(ada di dalam deeplink)'}`,
    ``,
    `Setelah pesan ke WA GTC terkirim (centang biru),`,
    `kembali ke terminal ini dan tekan ENTER.`,
  ])
  log(`\n${C.dim}Deeplink penuh:\n${deeplink}${C.reset}\n`)
  await ask(`Tekan ENTER setelah pesan ke WA GTC terkirim dan centang biru...`)

  // ── Step 6: Verify ──────────────────────────────────────────────────────
  step(6, 'Memverifikasi ke server VerifyKit...')
  let sessionId
  // Coba beberapa kali karena kadang perlu beberapa detik
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      info(`Percobaan ${attempt}/5...`)
      const chk = await vfkCall('/v2.0/check', { reference, bundleId: 'app.source.getcontact' }, devId)
      sessionId = chk?.result?.sessionId
      if (sessionId) { ok('Session ID diterima: ' + sessionId.slice(0, 12) + '…'); break }
      warn('Belum ada session ID, tunggu 3 detik...')
      await new Promise(r => setTimeout(r, 3000))
    } catch (e) {
      warn(`Check error: ${e.message}`)
      await new Promise(r => setTimeout(r, 3000))
    }
  }
  if (!sessionId) {
    err('Verifikasi gagal setelah 5 percobaan.')
    err('Pastikan pesan sudah dikirim ke WA GTC dan ada centang biru.')
    rl.close(); return
  }

  // ── Step 7: GTC verifykit-result ────────────────────────────────────────
  step(7, 'Finalisasi akun GTC...')
  let validationDate
  try {
    const vkr = await gtcEnc('/v2.8/verifykit-result', { sessionId, token }, token, finalKey, devId)
    validationDate = vkr?.result?.validationDate
    if (!validationDate) throw new Error(JSON.stringify(vkr))
    ok('Akun GTC terverifikasi! validationDate: ' + validationDate)
  } catch (e) { err('Finalisasi gagal: ' + e.message); rl.close(); return }

  // ── Step 8: Simpan credentials ──────────────────────────────────────────
  step(8, 'Menyimpan credentials...')
  store.active = phone
  store.credentials[phone] = {
    description: `Setup via CLI ${new Date().toISOString()}`,
    phoneNumber: phone, clientDeviceId: devId,
    finalKey, token, validationDate
  }
  fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true })
  fs.writeFileSync(CRED_FILE, JSON.stringify(store, null, 2))
  ok(`Credentials disimpan ke: ${CRED_FILE}`)

  // ── Step 9: Test quota ───────────────────────────────────────────────────
  step(9, 'Cek quota akun baru...')
  try {
    const sub  = await gtcEnc('/v2.8/subscription', { token }, token, finalKey, devId)
    const u    = sub?.result?.subscriptionInfo?.usage || {}
    const srem = u?.search?.remainingCount ?? '?'
    const slim = u?.search?.limit         ?? '?'
    const plan = sub?.result?.subscriptionInfo?.subscriptionType || '-'
    box('📊 GTC Quota', [
      `Nomor : ${phone}`,
      `Plan  : ${plan}`,
      `Search: ${srem} / ${slim}`,
      `Tags  : ${u?.numberDetail?.remainingCount ?? '?'} / ${u?.numberDetail?.limit ?? '?'}`,
    ])
  } catch (e) { warn('Gagal cek quota: ' + e.message) }

  // ── Done ─────────────────────────────────────────────────────────────────
  log(`\n${C.bold}${C.green}════════════════════════════════════════${C.reset}`)
  log(`${C.bold}${C.green}  ✅ Setup selesai! Bot siap dijalankan.${C.reset}`)
  log(`${C.bold}${C.green}════════════════════════════════════════${C.reset}`)
  log(`\nJalankan bot:\n  ${C.cyan}node index.js${C.reset}\n`)

  rl.close()
}

main().catch(e => { console.error(e); process.exit(1) })
