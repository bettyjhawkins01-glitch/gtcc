import fs from 'fs'
import path from 'path'
import { STATS_FILE, LIMITS_FILE, DEFAULT_LIMIT } from './config.js'

function mkDir(f) { fs.mkdirSync(path.dirname(f), { recursive: true }) }

export function loadStats() {
  try { return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) }
  catch { return { total_lookups: 0, users: {}, history: [] } }
}
export function saveStats(s) {
  mkDir(STATS_FILE)
  fs.writeFileSync(STATS_FILE, JSON.stringify(s, null, 2))
}

export function trackLookup(user) {
  const s = loadStats()
  const uid = String(user.id)
  const u = s.users[uid] || { id: uid, username: '', name: '', count: 0 }
  u.id = uid
  u.username = user.username ? '@' + user.username : '-'
  u.name = [user.first_name, user.last_name].filter(Boolean).join(' ') || '-'
  u.count = (u.count || 0) + 1
  u.last = new Date().toISOString().slice(0, 16).replace('T', ' ')
  s.users[uid] = u
  s.total_lookups = (s.total_lookups || 0) + 1
  s.history = s.history || []
  s.history.push({ uid, at: u.last })
  if (s.history.length > 1000) s.history = s.history.slice(-1000)
  saveStats(s)
}

export function loadLimits() {
  try { return JSON.parse(fs.readFileSync(LIMITS_FILE, 'utf8')) }
  catch { return {} }
}
export function saveLimits(l) {
  mkDir(LIMITS_FILE)
  fs.writeFileSync(LIMITS_FILE, JSON.stringify(l, null, 2))
}
export function getUserLimit(uid) {
  const l = loadLimits()
  return l[uid] !== undefined ? l[uid] : DEFAULT_LIMIT
}
export function setUserLimit(uid, val) {
  const l = loadLimits(); l[uid] = val; saveLimits(l)
}
export function getUserUsageToday(uid) {
  const s = loadStats(), today = new Date().toISOString().slice(0, 10)
  const u = s.users[uid]
  if (!u) return 0
  return u.date === today ? (u.daily || 0) : 0
}
export function incUserUsageToday(uid) {
  const s = loadStats(), today = new Date().toISOString().slice(0, 10)
  if (!s.users[uid]) s.users[uid] = { id: uid, count: 0, username: '-', name: '-' }
  if (s.users[uid].date !== today) { s.users[uid].date = today; s.users[uid].daily = 0 }
  s.users[uid].daily = (s.users[uid].daily || 0) + 1
  saveStats(s)
}
