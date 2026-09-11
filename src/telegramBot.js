import { TG_BOT_TOKEN, COOLDOWN, DEFAULT_LIMIT, isAdminId } from './config.js'
import { gtc, getCreds, cmdRelogin, cmdReloginVerify, getPendingRelogin } from './gtcApi.js'
import {
  loadStats, getUserLimit, setUserLimit, getUserUsageToday,
  incUserUsageToday, trackLookup, saveStats
} from './stats.js'
import {
  normalize, fmtStart, fmtError, fmtLoading, fmtResult,
  fmtQuota, fmtProfile, fmtAdmin, fmtListLimit, esc
} from './formatter.js'

let offset = 0
const cooldown = new Map()

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function api(method, body = {}) {
  const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const j = await r.json()
  if (!j.ok) throw new Error(j.description || `Telegram ${method} gagal`)
  return j.result
}

async function send(chatId, text, extra = {}) {
  return api('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra
  })
}

async function edit(chatId, messageId, text, extra = {}) {
  return api('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra
  })
}

async function sendPhoto(chatId, photo, caption) {
  return api('sendPhoto', {
    chat_id: chatId,
    photo,
    caption,
    parse_mode: 'HTML'
  })
}

function keyboard(isAdmin) {
  const rows = [[
    { text: '📊 Limit Saya', callback_data: 'my_limit' },
    { text: 'ℹ️ Cara Pakai', callback_data: 'help' }
  ]]
  if (isAdmin) rows.push([
    { text: '👑 Admin', callback_data: 'admin' },
    { text: '💎 GTC Quota', callback_data: 'gtc_quota' }
  ])
  return { inline_keyboard: rows }
}

function friendlyErr(e) {
  const msg = String(e?.message || e)
  if (msg.includes('404')) return 'Nomor tidak terdaftar di GetContact'
  if (msg.includes('401') || msg.includes('403')) return 'Sesi GTC habis. Admin perlu login ulang.'
  return msg.slice(0, 120)
}

async function showStart(msg) {
  const uid = String(msg.from.id)
  const admin = isAdminId(uid)
  const used = getUserUsageToday(uid)
  const max = getUserLimit(uid)
  const name = msg.from.first_name || msg.from.username || 'kawan'
  await send(msg.chat.id, fmtStart(name, used, max, admin), { reply_markup: keyboard(admin) })
}

async function lookup(msg, text) {
  const chatId = msg.chat.id
  const uid = String(msg.from.id)
  const admin = isAdminId(uid)

  if (!admin) {
    if (cooldown.has(uid)) return
    cooldown.set(uid, Date.now())
    setTimeout(() => cooldown.delete(uid), COOLDOWN)
  }

  const candidates = text.split(/[\n,\s]+/).map(s => s.trim()).filter(s => /\d{7,}/.test(s)).slice(0, 5)
  if (!candidates.length) {
    await send(chatId, fmtError('Kirim nomor HP (08xxx/628xxx) atau /start'))
    return
  }

  for (const raw of candidates) {
    const phone = normalize(raw)
    if (!phone) { await send(chatId, fmtError(`Format salah: ${raw}`)); continue }
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 9 || digits.length > 15) { await send(chatId, fmtError(`Tidak valid: ${raw}`)); continue }

    if (!admin) {
      const used = getUserUsageToday(uid)
      const lim = getUserLimit(uid)
      if (lim >= 0 && used >= lim) {
        await send(chatId, `❌ Limit harian kamu habis (${used}/${lim}).\nCoba lagi besok.`)
        continue
      }
    }

    const loading = await send(chatId, fmtLoading(phone))
    try {
      const creds = getCreds()
      const pb = await gtc('/v2.8/search', { countryCode: 'id', phoneNumber: phone, source: 'search', token: creds.token })
      const code = pb?.meta?.httpStatusCode
      if (code !== 200 && code != null) {
        await edit(chatId, loading.message_id, fmtError(pb?.meta?.errorMessage || 'Unknown'))
        continue
      }
      if (!pb?.result?.profile) {
        await edit(chatId, loading.message_id, fmtError('Nomor tidak ditemukan'))
        continue
      }

      const tb = await gtc('/v2.8/number-detail', { countryCode: 'id', phoneNumber: phone, source: 'profile', token: creds.token })
      trackLookup(msg.from)
      if (!admin) incUserUsageToday(uid)

      const limitInfo = admin ? null : { used: getUserUsageToday(uid), max: getUserLimit(uid) }
      const { text: resultText, imageUrl } = fmtResult(phone, pb, tb, limitInfo)
      if (imageUrl) {
        try {
          await api('deleteMessage', { chat_id: chatId, message_id: loading.message_id })
          await sendPhoto(chatId, imageUrl, resultText)
        } catch {
          await edit(chatId, loading.message_id, resultText)
        }
      } else {
        await edit(chatId, loading.message_id, resultText)
      }
    } catch (e) {
      await edit(chatId, loading.message_id, fmtError(friendlyErr(e)))
    }
  }
}

async function handleCommand(msg, text) {
  const chatId = msg.chat.id
  const uid = String(msg.from.id)
  const admin = isAdminId(uid)
  const [cmdRaw, ...args] = text.trim().split(/\s+/)
  const cmd = cmdRaw.toLowerCase().split('@')[0]

  if (['/start','/help','/menu'].includes(cmd)) return showStart(msg)

  if (cmd === '/mylimit') {
    const used = getUserUsageToday(uid), lim = getUserLimit(uid)
    const left = lim < 0 ? '∞' : Math.max(0, lim - used)
    const max = lim < 0 ? '∞' : lim
    return send(chatId, `📊 <b>Limit kamu</b>\nTerpakai: ${used}\nSisa: ${left}/${max}`)
  }

  if (!admin) return send(chatId, '⛔ Command ini khusus admin.')

  if (cmd === '/admin') return send(chatId, fmtAdmin())

  if (cmd === '/quota') {
    try {
      const b = await gtc('/v2.8/subscription', { token: getCreds().token })
      return send(chatId, fmtQuota(b))
    } catch (e) { return send(chatId, fmtError(friendlyErr(e))) }
  }

  if (cmd === '/profile') {
    try {
      const creds = getCreds()
      let b = await gtc('/v2.8/subscription', { token: creds.token })
      if (!b?.result?.profile) {
        try {
          const pb = await gtc('/v2.8/search', { countryCode: 'id', phoneNumber: creds.store.active, source: 'search', token: creds.token })
          b.result = b.result || {}; b.result.profile = pb?.result?.profile || {}
        } catch {}
      }
      return send(chatId, fmtProfile(b))
    } catch (e) { return send(chatId, fmtError(friendlyErr(e))) }
  }

  if (cmd === '/setlimit') {
    const target = (args[0] || '').replace(/\D/g, '')
    const val = parseInt(args[1], 10)
    if (!target || Number.isNaN(val)) return send(chatId, 'Format: <code>/setlimit TELEGRAM_ID 10</code>\nGunakan -1 untuk unlimited.')
    setUserLimit(target, val)
    return send(chatId, `✅ Limit <code>${esc(target)}</code> = <b>${val < 0 ? 'Unlimited' : val + '/hari'}</b>`)
  }

  if (cmd === '/resetlimit') {
    const target = (args[0] || '').replace(/\D/g, '')
    if (!target) return send(chatId, 'Format: <code>/resetlimit TELEGRAM_ID</code>')
    setUserLimit(target, DEFAULT_LIMIT)
    const s = loadStats()
    if (s.users[target]) { s.users[target].daily = 0; s.users[target].date = '' }
    saveStats(s)
    return send(chatId, `✅ Limit <code>${esc(target)}</code> direset ke ${DEFAULT_LIMIT}/hari.`)
  }

  if (cmd === '/listlimit') return send(chatId, `<b>📋 Custom Limits</b>\n\n${fmtListLimit()}`)

  if (cmd === '/relogin') {
    const ph = args[0] || ''
    if (!ph) return send(chatId, 'Format: <code>/relogin 628xxxxxxxxxx</code>')
    await send(chatId, `⏳ Generating GTC session untuk <b>${esc(ph)}</b>...`)
    try {
      const { deeplink } = await cmdRelogin(ph, normalize, `telegram:${uid}`)
      const waTarget = (deeplink.match(/wa\.me\/(\d+)/) || [])[1] || '4915735991827'
      return send(chatId,
        `🔐 <b>GTC Re-login</b>\n\n` +
        `📱 Nomor GTC: <code>${esc(ph)}</code>\n\n` +
        `<b>Langkah:</b>\n` +
        `1️⃣ Buka link ini (atau chat +${waTarget}):\n${esc(deeplink)}\n\n` +
        `2️⃣ Kirim pesan tersebut ke WhatsApp GetContact\n` +
        `3️⃣ Tunggu centang biru ✅\n` +
        `4️⃣ Balas: <code>sudahrlogin</code>`
      )
    } catch (e) { return send(chatId, fmtError('Relogin gagal: ' + friendlyErr(e))) }
  }

  return send(chatId, 'Command tidak dikenal. Gunakan /start.')
}

async function handleText(msg) {
  const text = (msg.text || '').trim()
  const lower = text.toLowerCase()
  const uid = String(msg.from.id)

  if (['sudahrlogin','sudah relogin','done relogin'].includes(lower)) {
    if (!isAdminId(uid)) return send(msg.chat.id, '⛔ Khusus admin.')
    const pending = getPendingRelogin()
    if (!pending) return send(msg.chat.id, '❌ Tidak ada sesi relogin aktif. Mulai dengan /relogin 628xxx')
    await send(msg.chat.id, '⏳ Verifying...')
    try {
      const b = await cmdReloginVerify()
      const rem = b?.result?.subscriptionInfo?.usage?.search?.remainingCount ?? '?'
      const lim = b?.result?.subscriptionInfo?.usage?.search?.limit ?? '?'
      return send(msg.chat.id, `✅ <b>GTC Login Sukses!</b>\n\n🔍 Quota: ${esc(rem)}/${esc(lim)}\n🔄 Credentials diperbarui`)
    } catch (e) { return send(msg.chat.id, fmtError('Verify gagal: ' + friendlyErr(e))) }
  }

  if (text.startsWith('/')) return handleCommand(msg, text)
  return lookup(msg, text)
}

async function handleCallback(q) {
  try { await api('answerCallbackQuery', { callback_query_id: q.id }) } catch {}
  const msg = q.message
  const uid = String(q.from.id)
  if (q.data === 'help') return send(msg.chat.id, '🔎 Kirim nomor HP langsung ke bot.\nContoh: <code>628123456789</code>')
  if (q.data === 'my_limit') {
    const used = getUserUsageToday(uid), lim = getUserLimit(uid)
    const left = lim < 0 ? '∞' : Math.max(0, lim - used)
    const max = lim < 0 ? '∞' : lim
    return send(msg.chat.id, `📊 <b>Limit kamu</b>\nTerpakai: ${used}\nSisa: ${left}/${max}`)
  }
  if (!isAdminId(uid)) return
  if (q.data === 'admin') return send(msg.chat.id, fmtAdmin())
  if (q.data === 'gtc_quota') {
    try {
      const b = await gtc('/v2.8/subscription', { token: getCreds().token })
      return send(msg.chat.id, fmtQuota(b))
    } catch (e) { return send(msg.chat.id, fmtError(friendlyErr(e))) }
  }
}

export async function startTelegramBot() {
  if (!TG_BOT_TOKEN) throw new Error('TG_BOT_TOKEN belum di-set')
  console.log('[TG] Telegram bot polling started')
  while (true) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/getUpdates?offset=${offset}&timeout=30&allowed_updates=%5B%22message%22,%22callback_query%22%5D`)
      const j = await r.json()
      if (!j.ok) { await sleep(5000); continue }
      for (const u of j.result) {
        offset = u.update_id + 1
        try {
          if (u.callback_query) await handleCallback(u.callback_query)
          else if (u.message?.text) await handleText(u.message)
        } catch (e) {
          console.error('[TG update]', e)
          if (u.message?.chat?.id) {
            try { await send(u.message.chat.id, fmtError(friendlyErr(e))) } catch {}
          }
        }
      }
    } catch (e) {
      console.error('[TG poll]', e.message)
      await sleep(5000)
    }
  }
}
