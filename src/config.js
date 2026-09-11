import 'dotenv/config'
import path from 'path'

export const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN || ''
export const TG_ADMIN_IDS = new Set(
  (process.env.TG_ADMIN_IDS || process.env.TG_OWNER_ID || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
)

export function isAdminId(id) {
  return TG_ADMIN_IDS.has(String(id))
}

export const COOLDOWN = parseInt(process.env.COOLDOWN_MS || '3000', 10)
export const DEFAULT_LIMIT = parseInt(process.env.DEFAULT_LIMIT || '5', 10)

export const GTC_BASE  = 'https://pbssrv-centralevents.com'
export const HMAC_KEY  = '31426764382a642f3a6665497235466f3d236d5d785b722b4c657457442a495b494524324866782a2364292478587a78662d7a7b7578593f71703e2b7e365762'

export const VFK_BASE       = 'https://api.verifykit.com'
export const VFK_HMAC_KEY   = '3452235d713252604a35562d325f765238695738485863672a705e6841544d3c7e6e45463028266f372b544e596f3829236b392825262e534a7e774f37653932'
export const VFK_CLIENT_KEY = 'bhvbd7ced119dc6ad6a0b35bd3cf836555d6f71930d9e5a405f32105c790d'
export const VFK_FINAL_KEY  = 'bd48d8c25293cfb537619cc93ae3d6e372eb2ddfffff4ab0eb000777144c7bfa'

const HOME = process.env.HOME || '.'
export const CRED_FILE   = process.env.CRED_FILE   || path.join(HOME, '.config/gtc/credentials.json')
export const STATS_FILE  = process.env.STATS_FILE  || path.join(HOME, '.config/gtc/bot_stats.json')
export const LIMITS_FILE = process.env.LIMITS_FILE || path.join(path.dirname(STATS_FILE), 'user_limits.json')
