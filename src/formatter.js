import { getCreds } from './gtcApi.js'
import { loadStats, loadLimits, getUserUsageToday } from './stats.js'
import { DEFAULT_LIMIT } from './config.js'

function dig(o, p, d = null) {
  for (const k of p.split('.')) {
    if (!o || typeof o !== 'object' || !(k in o)) return d
    o = o[k]
  }
  return o
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))
}

export function normalize(raw) {
  let p = raw.replace(/[^\d+]/g, '').trim()
  if (p.startsWith('+62')) return p
  if (p.startsWith('08')) return '+62' + p.slice(1)
  if (p.startsWith('628')) return '+' + p
  if (p.startsWith('62')) return '+' + p
  if (p.startsWith('0')) return '+62' + p.slice(1)
  if (p.startsWith('+')) return p
  if (p.length >= 7) return '+' + p
  return null
}

export function maskPhone(phone) {
  const d = phone.replace(/\D/g, '')
  return d.length > 7 ? `+${d.slice(0, 4)} •••• ${d.slice(-3)}` : phone
}

export function fmtStart(name, used, max, isAdmin = false) {
  const left = max < 0 ? '∞' : Math.max(0, max - used)
  const limit = max < 0 ? '∞' : max
  return [
    `👋 <b>Halo ${esc(name || 'kawan')}!</b>`,
    '',
    '🔎 Kirim nomor HP untuk cek:',
    '<code>08123456789</code>',
    '<code>628123456789</code>',
    '<code>+628123456789</code>',
    '',
    isAdmin ? '🛡 Kamu terdeteksi sebagai admin.' : `📊 Sisa limit hari ini: <b>${left}/${limit}</b>`
  ].join('\n')
}

export function fmtError(msg) { return `❌ ${esc(msg)}` }
export function fmtLoading(phone) { return `🔍 Lookup <b>${esc(maskPhone(phone))}</b>...\nMohon tunggu ⏳` }

export function fmtResult(phone, pb, tb, limit = null) {
  const prof = dig(pb, 'result.profile') || {}
  const tags = dig(tb, 'result.tags') || []
  const name = (prof.displayName || prof.name || '?').trim()
  const tagcount = tags.length
  const spam = prof.isSpam
  const sptype = (prof.spamType || '').trim()
  const imageUrl = prof.profileImage || null

  const lines = [
    '<b>📋 GetContact Result</b>', '',
    `📱 <b>Nomor</b> : ${esc(maskPhone(phone))}`,
    `👤 <b>Nama</b>  : ${esc(name)}`,
    `🏷️ <b>Tags</b>  : ${tagcount}${spam ? ` ⚠️ SPAM${sptype ? ': ' + esc(sptype) : ''}` : ''}`,
    '', `<b>Tag List (${tagcount}):</b>`
  ]

  if (!tags.length) lines.push('<i>Tidak ada tag</i>')
  else {
    for (let i = 0; i < tags.length; i += 5) {
      lines.push(tags.slice(i, i + 5).map(t => esc((t.tag || '?').trim())).join(' • '))
    }
  }

  if (limit !== null) {
    const sisa = limit.max < 0 ? '∞' : `${Math.max(0, limit.max - limit.used)}`
    const max = limit.max < 0 ? '∞' : limit.max
    lines.push('', `📊 <b>Sisa limit</b> : ${sisa}/${max}`)
  }
  return { text: lines.join('\n'), imageUrl }
}

export function fmtQuota(b) {
  const u = dig(b, 'result.subscriptionInfo.usage') || {}
  const renew = dig(b, 'result.subscriptionInfo.renewDate', '-')
  let stype = dig(b, 'result.subscriptionInfo.subscriptionType', '-')
  const s_rem = dig(u, 'search.remainingCount', '?')
  const s_lim = dig(u, 'search.limit', '?')
  if (parseInt(s_lim) >= 100 && stype === '-') stype = 'premium'
  return [
    '<b>📊 GTC Quota</b>',
    `🎫 Plan   : ${esc(stype)}`,
    `🔍 Search : ${esc(s_rem)} / ${esc(s_lim)}`,
    `🏷️ Tags   : ${esc(dig(u, 'numberDetail.remainingCount', '?'))} / ${esc(dig(u, 'numberDetail.limit', '?'))}`,
    `🔄 Reset  : ${esc(renew)}`
  ].join('\n')
}

export function fmtProfile(b) {
  const { store, deviceId } = getCreds()
  const info = dig(b, 'result.subscriptionInfo') || {}
  const prof = dig(b, 'result.profile') || {}
  const usage = info.usage || {}
  const s_rem = dig(usage, 'search.remainingCount', '?')
  const s_lim = dig(usage, 'search.limit', '?')
  const lim_i = parseInt(s_lim) || 0
  let is_prem, stype = info.subscriptionType || '-'
  if (lim_i >= 100) { is_prem = 'YES ✅'; if (stype === '-') stype = 'premium' }
  else if (lim_i > 0) is_prem = 'FREE'
  else is_prem = ['free', '-', ''].includes(stype.toLowerCase()) ? 'FREE ❌' : 'YES ✅'
  const name = (prof.displayName || prof.name || '-').trim()
  const phone = store.active || '?'
  return [
    '<b>👤 My Profile</b>',
    `📱 ${esc(maskPhone(phone))}`,
    `👤 ${esc(name)}`,
    '',
    `💎 Premium : ${esc(is_prem)}`,
    `🎫 Plan    : ${esc(stype)}`,
    `🔍 Search  : ${esc(s_rem)} / ${esc(s_lim)}`,
    `🔄 Renew   : ${esc(dig(info, 'renewDate', '-'))}`,
    `🆔 Device  : ${esc(deviceId.slice(0, 12))}…`
  ].join('\n')
}

export function fmtAdmin() {
  const s = loadStats(), users = s.users || {}
  let out = `<b>👑 Admin Panel</b>\n📊 Total lookup : ${s.total_lookups || 0}\n👥 Total user   : ${Object.keys(users).length}`
  const ranked = Object.values(users).sort((a,b)=>(b.count||0)-(a.count||0)).slice(0,25)
  if (!ranked.length) return out + '\n\nBelum ada data'
  out += '\n\n<b>Top users</b>\n'
  for (const u of ranked) {
    out += `• ${esc(u.name || '-')} ${u.username && u.username !== '-' ? '(' + esc(u.username) + ')' : ''}\n  ID <code>${esc(u.id)}</code> · ${u.count || 0}x · ${esc(u.last || '')}\n`
  }
  return out.trim()
}

export function fmtListLimit() {
  const l = loadLimits(), s = loadStats(), today = new Date().toISOString().slice(0, 10)
  const lines = Object.entries(l).map(([uid, lim]) => {
    const u = s.users[uid]
    const used = (u && u.date === today) ? u.daily || 0 : 0
    const disp = lim < 0 ? '∞' : String(lim)
    return `<code>${esc(uid)}</code> → ${used}/${disp}`
  })
  return lines.length ? lines.join('\n') : 'Belum ada limit custom'
}
