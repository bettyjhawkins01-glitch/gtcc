# GTC Telegram Bot

Versi Telegram-only dari project GTC WA Bot. WhatsApp/Baileys untuk audience sudah dihapus. User cukup membuka Telegram bot dan mengirim nomor HP.

## Fitur

- Audience Telegram: kirim nomor langsung untuk lookup
- Limit harian per Telegram user
- Cooldown non-admin
- Admin panel dan ranking user
- Admin: `/quota`, `/profile`, `/setlimit`, `/resetlimit`, `/listlimit`
- Login/refresh GTC via Telegram: `/relogin 628xxx` lalu `sudahrlogin`
- Foto profile GTC dikirim sebagai photo + caption jika tersedia
- Data stats, limits, dan credentials bisa disimpan di Railway Volume `/data`

## Railway Variables

```env
TG_BOT_TOKEN=...
TG_ADMIN_IDS=123456789
COOLDOWN_MS=3000
DEFAULT_LIMIT=5
CRED_FILE=/data/credentials.json
STATS_FILE=/data/bot_stats.json
LIMITS_FILE=/data/user_limits.json
```

Mount Railway Volume ke `/data` agar session/stats tidak hilang ketika redeploy.

## Commands Audience

- `/start` atau `/help`
- `/mylimit`
- Kirim nomor: `0812...`, `628...`, atau `+628...`

## Commands Admin

- `/admin`
- `/quota`
- `/profile`
- `/setlimit TELEGRAM_ID N`
- `/resetlimit TELEGRAM_ID`
- `/listlimit`
- `/relogin 628xxxxxxxxxx`
- `sudahrlogin`

## Run

```bash
npm install
npm start
```
