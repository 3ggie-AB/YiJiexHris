# HRIS Auto Analyzer

CLI Bun untuk:

- scan banyak repository Git
- rangkum aktivitas coding harian
- analisa produktivitas dengan Groq
- kirim hasil ke API HRIS

Zero-dependency. Semua request HTTP pakai `fetch` bawaan Bun.

## Web Dashboard

Sekarang ada mode web berbasis React + Tailwind dengan:

- Auth GitHub via Passport
- GitHub API via Octokit
- React dashboard untuk connect repository, filter selection, lalu analyze langsung dari state aktif
- Konfigurasi global dibaca dari environment
- Data per-user tetap disimpan di MongoDB
- Halaman detail run, commit, dan isi file perubahan dari GitHub

Command:

```bash
bun run web
```

Environment untuk mode web:

- `MONGODB_URI`
- `APP_BASE_URL`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `MONGODB_DB` opsional
- `SESSION_SECRET` opsional untuk session cookie
- `PORT` opsional
- `GITHUB_TIMEZONE` opsional
- `GITHUB_TIMEZONE_OFFSET` opsional
- `GITHUB_DEFAULT_REPOSITORIES` opsional untuk seed pilihan repo di dashboard

Tidak ada lagi halaman `/setup`. OAuth GitHub dan config global lain mengikuti `.env`, sedangkan user session, connected repositories, dan histori run tetap tersimpan di MongoDB.

## Alur

1. `collect`
   Scan repo dari `PROJECT_REPOS` dan/atau `PROJECTS_BASE_DIRS`.
2. `analyze`
   Pecah hasil scan menjadi unit commit/working-tree yang punya signal, analisa multi-pass ke Groq, lalu gabungkan jadi report terstruktur.
3. `send`
   Login ke HRIS, lalu buat card harian ke endpoint HRIS dengan `FormData`.
4. `schedule`
   Jalan otomatis tiap hari di jam yang ditentukan.

## Setup

Copy `.env.example` menjadi `.env`, lalu isi:

- `GROQ_API_KEY`
- `GROQ_ANALYSIS_MODEL` opsional, kalau model Groq untuk tahap analisa ingin dibedakan dari `GROQ_MODEL`
- `GROQ_ANALYSIS_MAX_REQUESTS` opsional, untuk membatasi budget request Groq di tahap analisa multi-pass
- `PROJECT_REPOS` atau `PROJECTS_BASE_DIRS`
- `PROJECT_PREVIEW_URLS_JSON` jika ingin screenshot halaman project
- `PROJECT_RUN_COMMANDS_JSON` jika project perlu dijalankan dulu sebelum di-screenshot
- `PROJECT_ALIASES_JSON` opsional, untuk mengganti nama repo/path jadi nama project yang lebih rapi di report & card HRIS
- `PROJECT_ROUTE_RULES_JSON` opsional, hanya kalau hasil analisa route otomatis mau dioverride manual
- `PROJECT_WEB_AUTH_JSON` opsional, kalau project Laravel/web harus login dulu sebelum screenshot halaman
- `HRIS_LOGIN_URL`
- `HRIS_CARDS_URL`
- `HRIS_EMAIL`
- `HRIS_PASSWORD`
- `HRIS_LIST_ID` atau `HRIS_BOARD_ID`

## Commands

```bash
bun run collect
bun run analyze
bun run send
bun run run
bun run activities --code 20260418-094338-ABC123
bun run delete-activity --code 20260418-094338-ABC123 2 ACT-005
bun run schedule
```

`bun run run` adalah full pipeline: collect -> analyze -> send.

Flow reuse package:

- `bun run analyze` sekarang otomatis membuat folder package reusable.
- `bun run activities --code <kode>` untuk lihat semua activity, `buktiPath`, repo, file relevan, dan status aktif/deleted.
- `bun run delete-activity --code <kode> <nomor|ACT-xxx>` untuk menghapus activity dari package tanpa analisa ulang.
- `bun run send --code <kode>` atau `bun run send --package <folder>` untuk kirim ulang package yang sudah disiapkan.

## Output

Secara default file JSON disimpan ke folder `reports/`:

- `raw-YYYY-MM-DD.json`
- `analysis-YYYY-MM-DD.json`
- `payload-YYYY-MM-DD.json`
- `packages/<kode-unik>/manifest.json`
- `packages/<kode-unik>/collection.json`
- `packages/<kode-unik>/analysis.json`
- `packages/<kode-unik>/cards.json`

Isi `cards.json` adalah payload card yang sudah siap pakai, termasuk `buktiPath` screenshot kalau evidence berhasil dibuat. `manifest.json` menyimpan `packageCode`, jumlah activity aktif, dan jumlah yang sudah dihapus dari terminal.

## Bentuk payload HRIS

Payload card HRIS dibuat di `src/services/hris-client.ts` lewat fungsi `buildHrisCardPayloads`.

Kalau schema HRIS kamu beda, ada dua opsi cepat:

1. Ubah langsung fungsi `buildHrisCardPayloads`
2. Tambahkan field statis lewat `HRIS_PAYLOAD_STATIC_JSON`

Contoh payload card default:

```json
{
  "list_id": 35127,
  "title": "ERP : Menambahkan Migrasi untuk Fitur Sertifikat di ERP",
  "description": "Tanggal: 2026-04-13\nAktivitas: Menambahkan migrasi sertifikat\nRingkasan: Hari ini fokus di ERP.",
  "checklists": [
    { "id": 487573, "title": "Progres", "checklist": "yes", "position": 1 },
    { "id": 487574, "title": "Bukti", "checklist": "yes", "position": 2 },
    { "id": 487575, "title": "Final", "checklist": "yes", "position": 3 }
  ],
  "bukti": "(binary image)"
}
```

## Scheduler

Command `bun run schedule` memakai jam lokal mesin dan environment:

- `SCHEDULE_TIME=22:00`
- `SCHEDULE_RUN_ON_START=true`

Untuk production Windows, kalau mau lebih stabil, jalankan command ini via Task Scheduler.

## Catatan

- Repo tanpa commit hari ini tetap ikut dianalisa kalau ada perubahan working tree.
- Kalau `PROJECT_REPOS` dan `PROJECTS_BASE_DIRS` kosong, CLI akan fallback ke folder saat ini.
- Analyzer memakai Groq Responses API dan structured JSON output supaya payload ke HRIS konsisten.
- Default model memakai `openai/gpt-oss-20b` karena mendukung strict structured outputs di Groq.
- `send` akan membuat beberapa card sekaligus, maksimum sesuai `HRIS_CARD_LIMIT`. Default sekarang `50`.
- `send --code <kode>` dan `send --package <folder>` akan skip collect/analyze, lalu langsung kirim dari package reusable yang sudah ada.
- Tahap `analyze` sekarang memecah commit dan working tree menjadi unit kecil supaya fitur besar tidak digabung sembarangan. Request ke Groq bisa lebih banyak, tetapi hasil task biasanya lebih deskriptif.
- Tahap `analyze` sekarang juga menyiapkan package reusable di `reports/packages/` supaya payload + screenshot path bisa dipakai lagi tanpa analisa ulang.
- Perubahan trivial seperti `composer`/lockfile/env/log/file dokumen dan perubahan yang terlalu kecil akan difilter supaya tidak ikut dihitung sebagai card.
- Atur `ANALYSIS_MIN_FILE_CHANGE_COUNT` dan `ANALYSIS_MIN_UNIT_CHANGE_COUNT` kalau mau memperketat atau melonggarkan filter signal kerja.
- Kalau `HRIS_BOARD_ID` diisi, tool akan ambil list harian dari endpoint `boards/{board_id}/generate-lists` dan memilih `date` yang sama dengan `reportDate` hari ini. `HRIS_BOARD_LISTS_URL` bisa dipakai kalau endpoint board list kamu berbeda.
- Kalau kamu sudah punya token HRIS, `HRIS_API_TOKEN` bisa dipakai untuk skip login.
- Request `cards` dikirim sebagai `FormData`, jadi jangan override `Content-Type` menjadi JSON di `HRIS_API_HEADERS_JSON`.
- Set `HRIS_SEND_DESCRIPTION=false` kalau kamu ingin card dikirim tanpa isi deskripsi.
- Set `HRIS_SEND_EVIDENCE=false` kalau kamu tidak ingin upload screenshot bukti.
- `HRIS_EVIDENCE_MODE=auto` akan memilih screenshot halaman untuk task view/UI jika `PROJECT_PREVIEW_URLS_JSON` tersedia, dan fallback ke screenshot kode untuk migration/bug/backend.
- Set `HRIS_EVIDENCE_MODE=code` kalau semua bukti ingin dipaksa berupa screenshot kode.
- `HRIS_CODE_SCREENSHOT_STYLE=ray` akan memakai renderer code screenshot bergaya editor/ray.so-like.
- `HRIS_CODE_SCREENSHOT_STRICT=true` akan menolak fallback ke renderer legacy. Kalau render browser gagal, bukti kode tidak dibuat.
- Checklist outgoing dipaksa `yes` semua dan akan mengirim `checklists[n][id]` kalau kamu isi `id` di `HRIS_CARD_CHECKLISTS_JSON`.
- Kalau `PROJECT_ROUTE_RULES_JSON` kosong, tool akan analisa route dari file yang berubah, struktur view/pages, dan file `routes/*.php`. Isi env itu hanya kalau kamu mau override manual.
- Kalau halaman preview butuh auth, isi `PROJECT_WEB_AUTH_JSON`. Tool akan buka login page, isi form, submit, lalu pindah ke route task sebelum ambil screenshot.
- Kalau nama project di card masih berupa nama folder/path mentah, isi `PROJECT_ALIASES_JSON`.

Contoh alias:

```json
{
  "D:/sci/erp_2023": "Dashboard ERP",
  "Smart-School-NEW": "Smart School",
  "Kodinggggggggggggg": "Backend Kompetiva",
  "api_erp": "API ERP GO"
}
```

Contoh:

```json
{
  "Smart-School-NEW": [
    { "match": "murid tabel", "path": "/murid" },
    { "match": "dashboard", "path": "/dashboard" }
  ],
  "erp_2023": [
    { "match": "sertifikat project", "url": "http://127.0.0.1:8001/projects/certificates" }
  ]
}
```

Contoh auth browser:

```json
{
  "Smart-School-NEW": {
    "loginPath": "/login",
    "email": "admin@example.com",
    "password": "secret",
    "emailSelector": "input[name='email']",
    "passwordSelector": "input[name='password']",
    "submitSelector": "button[type='submit']",
    "postLoginWaitMs": 2500
  }
}
```
