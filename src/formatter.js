import { getCreds } from './gtcApi.js'
import { loadStats, loadLimits } from './stats.js'
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
  const d = String(phone || '').replace(/\D/g, '')
  return d.length > 7 ? `+${d.slice(0, 4)} •••• ${d.slice(-3)}` : String(phone || '')
}

function quotaData(used, max) {
  if (max < 0) return { left: '∞', maxText: '∞', pct: 100, unlimited: true }
  const safeMax = Math.max(0, Number(max) || 0)
  const safeUsed = Math.max(0, Number(used) || 0)
  const left = Math.max(0, safeMax - safeUsed)
  const pct = safeMax > 0 ? Math.max(0, Math.min(100, Math.round((left / safeMax) * 100))) : 0
  return { left, maxText: safeMax, pct, unlimited: false }
}

function progressBar(pct, size = 10) {
  const fill = Math.max(0, Math.min(size, Math.round((pct / 100) * size)))
  return '▰'.repeat(fill) + '▱'.repeat(size - fill)
}

export function fmtStart(name, used, max, isAdmin = false) {
  const q = quotaData(used, max)

  if (isAdmin) {
    return [
      '╭──────────────────────╮',
      '   <b>⚡ GTC LOOKUP CENTER</b>',
      '╰──────────────────────╯',
      '',
      `Halo, <b>${esc(name || 'Admin')}</b> 👋`,
      'Status akun: <b>ADMINISTRATOR</b> 🛡️',
      '',
      '<b>🔎 QUICK LOOKUP</b>',
      'Kirim nomor langsung ke chat:',
      '<code>081234567890</code>',
      '<code>6281234567890</code>',
      '',
      'Gunakan tombol di bawah untuk dashboard & kuota GTC.'
    ].join('\n')
  }

  return [
    '╭──────────────────────╮',
    '   <b>✨ GTC LOOKUP</b>',
    '╰──────────────────────╯',
    '',
    `Halo, <b>${esc(name || 'kawan')}</b> 👋`,
    'Cek identitas nomor dengan cepat & praktis.',
    '',
    '<b>🎟 KUOTA HARI INI</b>',
    `<code>${progressBar(q.pct)}</code>  <b>${q.left}/${q.maxText}</b>`,
    q.unlimited ? 'Unlimited access aktif.' : q.left > 0 ? `Masih tersedia <b>${q.left} pencarian</b>.` : 'Kuota hari ini sudah habis.',
    '',
    '<b>🔎 CARA CEK</b>',
    'Kirim nomor langsung:',
    '<code>081234567890</code>',
    '<code>6281234567890</code>',
    '',
    '<i>Kuota otomatis diperbarui setelah setiap pencarian.</i>'
  ].join('\n')
}

export function fmtMyLimit(used, max) {
  const q = quotaData(used, max)
  return [
    '╭──────────────────────╮',
    '      <b>🎟 MY QUOTA</b>',
    '╰──────────────────────╯',
    '',
    `<code>${progressBar(q.pct, 12)}</code>`,
    '',
    `✅ <b>Sisa kuota</b>     ${q.left}`,
    `📤 <b>Terpakai</b>       ${used}`,
    `📦 <b>Total harian</b>   ${q.maxText}`,
    '',
    q.unlimited
      ? '<i>Unlimited access aktif.</i>'
      : q.left > 0
        ? `<i>Kamu masih bisa melakukan ${q.left} lookup hari ini.</i>`
        : '<i>Kuota akan tersedia kembali pada periode berikutnya.</i>'
  ].join('\n')
}

export function fmtError(msg) {
  return [
    '╭──────────────────────╮',
    '       <b>⚠️ ERROR</b>',
    '╰──────────────────────╯',
    '',
    esc(msg)
  ].join('\n')
}

export function fmtLoading(phone) {
  return [
    '╭──────────────────────╮',
    '      <b>🔎 SEARCHING</b>',
    '╰──────────────────────╯',
    '',
    `Nomor: <b>${esc(maskPhone(phone))}</b>`,
    '',
    '⏳ Mengambil profile...',
    '🏷️ Memuat tag...',
    '🛡️ Mengecek informasi spam...',
    '',
    '<i>Mohon tunggu sebentar.</i>'
  ].join('\n')
}

export function fmtResult(phone, pb, tb, limit = null) {
  const prof = dig(pb, 'result.profile') || {}
  const tags = dig(tb, 'result.tags') || []
  const name = (prof.displayName || prof.name || '?').trim()
  const tagcount = tags.length
  const spam = prof.isSpam
  const sptype = (prof.spamType || '').trim()
  const imageUrl = prof.profileImage || null

  const lines = [
    '╭──────────────────────╮',
    '     <b>✅ LOOKUP RESULT</b>',
    '╰──────────────────────╯',
    '',
    `📱 <b>Nomor</b>`,
    `<code>${esc(maskPhone(phone))}</code>`,
    '',
    `👤 <b>Nama</b>`,
    `<b>${esc(name)}</b>`,
    '',
    `🏷️ <b>Tags ditemukan</b>   ${tagcount}`,
    `🛡️ <b>Status</b>            ${spam ? `⚠️ SPAM${sptype ? ' · ' + esc(sptype) : ''}` : '✅ Normal'}`,
    '',
    '<b>TAG LIST</b>'
  ]

  if (!tags.length) {
    lines.push('<i>Belum ada tag untuk nomor ini.</i>')
  } else {
    const displayTags = tags.slice(0, 30)
    for (let i = 0; i < displayTags.length; i += 3) {
      lines.push('• ' + displayTags.slice(i, i + 3).map(t => esc((t.tag || '?').trim())).join('  ·  '))
    }
    if (tags.length > displayTags.length) {
      lines.push(`<i>+${tags.length - displayTags.length} tag lainnya</i>`)
    }
  }

  if (limit !== null) {
    const q = quotaData(limit.used, limit.max)
    lines.push(
      '',
      '━━━━━━━━━━━━━━━━━━━━━━',
      '<b>🎟 KUOTA KAMU</b>',
      `<code>${progressBar(q.pct)}</code>  <b>${q.left}/${q.maxText}</b>`
    )
  }

  lines.push('', '<i>GTC Lookup • Fast & simple</i>')
  return { text: lines.join('\n'), imageUrl }
}

export function fmtQuota(b) {
  const u = dig(b, 'result.subscriptionInfo.usage') || {}
  const renew = dig(b, 'result.subscriptionInfo.renewDate', '-')
  let stype = dig(b, 'result.subscriptionInfo.subscriptionType', '-')
  const sRem = dig(u, 'search.remainingCount', '?')
  const sLim = dig(u, 'search.limit', '?')
  const tRem = dig(u, 'numberDetail.remainingCount', '?')
  const tLim = dig(u, 'numberDetail.limit', '?')
  if (parseInt(sLim) >= 100 && stype === '-') stype = 'premium'

  const pct = Number.isFinite(Number(sRem)) && Number(sLim) > 0
    ? Math.round((Number(sRem) / Number(sLim)) * 100)
    : 0

  return [
    '╭──────────────────────╮',
    '     <b>💎 GTC QUOTA</b>',
    '╰──────────────────────╯',
    '',
    `🎫 <b>Plan</b>       ${esc(stype)}`,
    '',
    '<b>🔎 SEARCH QUOTA</b>',
    `<code>${progressBar(pct, 12)}</code>`,
    `<b>${esc(sRem)}</b> tersisa dari ${esc(sLim)}`,
    '',
    '<b>🏷️ DETAIL/TAGS</b>',
    `<b>${esc(tRem)}</b> tersisa dari ${esc(tLim)}`,
    '',
    `🔄 <b>Reset</b>      ${esc(renew)}`
  ].join('\n')
}

export function fmtProfile(b) {
  const { store, deviceId } = getCreds()
  const info = dig(b, 'result.subscriptionInfo') || {}
  const prof = dig(b, 'result.profile') || {}
  const usage = info.usage || {}
  const sRem = dig(usage, 'search.remainingCount', '?')
  const sLim = dig(usage, 'search.limit', '?')
  const limI = parseInt(sLim) || 0
  let isPrem, stype = info.subscriptionType || '-'

  if (limI >= 100) {
    isPrem = 'ACTIVE ✅'
    if (stype === '-') stype = 'premium'
  } else if (limI > 0) {
    isPrem = 'FREE'
  } else {
    isPrem = ['free', '-', ''].includes(stype.toLowerCase()) ? 'FREE ❌' : 'ACTIVE ✅'
  }

  const name = (prof.displayName || prof.name || '-').trim()
  const phone = store.active || '?'

  return [
    '╭──────────────────────╮',
    '      <b>👤 GTC PROFILE</b>',
    '╰──────────────────────╯',
    '',
    `👤 <b>${esc(name)}</b>`,
    `📱 ${esc(maskPhone(phone))}`,
    '',
    `💎 <b>Premium</b>    ${esc(isPrem)}`,
    `🎫 <b>Plan</b>       ${esc(stype)}`,
    `🔎 <b>Search</b>     ${esc(sRem)} / ${esc(sLim)}`,
    `🔄 <b>Renew</b>      ${esc(dig(info, 'renewDate', '-'))}`,
    '',
    `🆔 <b>Device</b>`,
    `<code>${esc(deviceId.slice(0, 12))}…</code>`
  ].join('\n')
}

export function fmtAdmin() {
  const s = loadStats()
  const users = s.users || {}
  const ranked = Object.values(users).sort((a,b)=>(b.count||0)-(a.count||0)).slice(0,10)

  const lines = [
    '╭──────────────────────╮',
    '    <b>👑 ADMIN DASHBOARD</b>',
    '╰──────────────────────╯',
    '',
    '📊 <b>OVERVIEW</b>',
    `├ Total lookup    <b>${s.total_lookups || 0}</b>`,
    `└ Total users     <b>${Object.keys(users).length}</b>`,
    '',
    '<b>🏆 TOP USERS</b>'
  ]

  if (!ranked.length) {
    lines.push('<i>Belum ada aktivitas.</i>')
  } else {
    ranked.forEach((u, i) => {
      lines.push(`${i + 1}. <b>${esc(u.name || '-')}</b> · ${u.count || 0}x`)
      lines.push(`   <code>${esc(u.id)}</code>${u.username && u.username !== '-' ? ' · ' + esc(u.username) : ''}`)
    })
  }

  lines.push('', '<i>Admin tools tersedia melalui tombol di bawah.</i>')
  return lines.join('\n')
}

export function fmtListLimit() {
  const l = loadLimits()
  const s = loadStats()
  const today = new Date().toISOString().slice(0, 10)
  const lines = Object.entries(l).map(([uid, lim]) => {
    const u = s.users[uid]
    const used = (u && u.date === today) ? u.daily || 0 : 0
    const disp = lim < 0 ? '∞' : String(lim)
    return `• <code>${esc(uid)}</code>  <b>${used}/${disp}</b>`
  })
  return lines.length ? lines.join('\n') : '<i>Belum ada limit custom.</i>'
}
