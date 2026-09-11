import 'dotenv/config'
import fs from 'fs'
import path from 'path'

import { CRED_FILE } from './src/config.js'
import { loadCreds } from './src/gtcApi.js'
import { startTelegramBot } from './src/telegramBot.js'

function ensureCredFile() {
  if (fs.existsSync(CRED_FILE)) return
  fs.mkdirSync(path.dirname(CRED_FILE), { recursive: true })
  fs.writeFileSync(CRED_FILE, JSON.stringify({ active: null, credentials: {} }, null, 2))
  console.log('[INFO] credentials.json dibuat kosong — admin gunakan /relogin di Telegram')
}

async function main() {
  ensureCredFile()
  try {
    loadCreds()
    console.log('[GTC] Credentials aktif berhasil dimuat')
  } catch {
    console.log('[GTC] Belum ada credentials aktif — admin gunakan /relogin')
  }
  await startTelegramBot()
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
