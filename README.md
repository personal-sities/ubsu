# AloqaPro - Supabase versiyasi

Loyiha haqiqiy Supabase bilan ishlaydi. Frontend `supabase.js` orqali `sb.from(...)`, auth, realtime va Edge Function chaqiriqlarini bevosita Supabase projectga yuboradi.

## Ishga tushirish

1. `.env.example` faylidan `.env` yarating va Supabase qiymatlarini yozing.
2. Serverni ishga tushiring:

```bash
npm start
```

3. Brauzerda oching:

```text
http://localhost:3000
```

Loginlar Supabase Auth orqali tekshiriladi. Admin va xodim ma'lumotlari Supabase jadvallarida bo'lishi kerak.

## OnlinePBX va amoCRM

Bu integratsiyalar majburiy emas. `.env` ichida `ENABLE_AMOCRM=false` va `ENABLE_ONLINEPBX=false` bo'lsa, tegishli bo'limlar yashiriladi yoki bo'sh natija qaytaradi; qolgan tizim Supabase orqali ishlaydi.

## Fayl strukturasi

Asosiy fayllar:

```text
index.html                         - HTML markup va script/link havolalari
server.js                          - statik server va /env.js konfiguratsiya endpointi
assets/css/style.css               - barcha CSS
assets/js/app.js                   - qisqa izoh/yo'naltiruvchi fayl
assets/js/app-parts/01-core.js     - config, theme, toast, PWA, sidebar
assets/js/app-parts/02-access-settings.js
assets/js/app-parts/03-translations.js
assets/js/app-parts/04-time-attendance-utils.js
assets/js/app-parts/05-notifications-feedback-login.js
assets/js/app-parts/06-admin-pbx.js
assets/js/app-parts/07-export-employee-state-actions.js
assets/js/app-parts/08-timers-prayer-autoend.js
assets/js/app-parts/09-face-detection.js
assets/js/app-parts/10-employee-ui-init.js
```

`app-parts` ichidagi fayllar `index.html`da berilgan tartibda yuklanishi kerak. Shu tartib saqlansa, eski bitta katta `app.js`dagi barcha funksiya va ishlash ketma-ketligi saqlanadi.

Quyidagi fayllar loyiha ishlashi uchun shu papkada bo'lishi kerak:

- `face-api.js`
- `xlsx.full.min.js`
- `jspdf.umd.min.js`
- `jspdf.plugin.autotable.min.js`
- `manifest.json`
- `sw.js`
- `model/`
- `images/logo2.png`
- `images/dd.png`

## Tekshirildi

- `app-parts` fayllari birlashtirilganda eski katta `assets/js/app.js` aynan qayta hosil bo'lishi tekshirildi.
- JS sintaksisi `node --check` orqali tekshirildi.
- Lokal serverda sahifa ochilishi va browser runtime xatolari tekshirildi.
