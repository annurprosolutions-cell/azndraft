# Panduan Setup — AZN Invoice

Ikut langkah ni satu per satu. Anggaran masa: 15–20 minit.

Ada 3 bahagian:

- **Bahagian A** — Sediakan Google Sheet + Apps Script (backend)
- **Bahagian B** — Masukkan URL ke dalam app
- **Bahagian C** — Online-kan app (supaya boleh buka di phone & install)

---

## Bahagian A — Google Sheet + Apps Script

**A1.** Buka https://sheets.google.com → klik **Blank** (spreadsheet kosong).
Namakan: `AZN Invoice Database`.

**A2.** Kat menu atas, klik **Extensions → Apps Script**. Satu tab baru akan terbuka.

**A3.** Dalam editor tu, ada kod `function myFunction() {}`. **Padam semua.**

**A4.** Buka fail `apps-script/Code.gs` (dalam folder yang aku bagi), **copy semua**, dan **paste** dalam editor tu.

**A5.** Tekan ikon **Save** (gambar disket) atau `Ctrl + S`.

**A6.** Kat bar atas, ada dropdown nama function. Pilih **`setupSystem`** → tekan **▶ Run**.

**A7.** Akan keluar popup **"Authorization required"**:

1. Klik **Review permissions**
2. Pilih akaun Google kau (akaun yang ada akses ke folder Drive invoice)
3. Kalau keluar "Google hasn't verified this app" → klik **Advanced** → **Go to (nama projek) (unsafe)**
4. Klik **Allow**

> Ni normal untuk script yang kita tulis sendiri. "Unsafe" tu sebab Google tak review script peribadi.

**A8.** Tunggu sampai log tunjuk **SETUP BERJAYA ✅**. Balik ke tab Google Sheet — sekarang ada 3 tab: `Invoices`, `Invoice_Items` dan `Settings`.

> **Dah pernah setup versi lama?** Tampal Code.gs baru, run `setupSystem` sekali lagi (data lama selamat, dia cuma tambah tab `Settings`), lepas tu buat **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy**.

**A9.** Sekarang deploy jadi API. Klik butang biru **Deploy → New deployment**.

1. Klik ikon gear ⚙ sebelah "Select type" → pilih **Web app**
2. **Description**: `AZN Invoice API`
3. **Execute as**: **Me**
4. **Who has access**: **Anyone** ← penting
5. Klik **Deploy**

**A10.** Copy **Web app URL** (yang hujung dia `/exec`). Simpan dulu, kita guna kat Bahagian B.

---

## Bahagian B — Sambungkan app ke database

Ada 2 cara. Pilih satu.

**Cara 1 (disyorkan — sekali setup, semua device terus jalan):**
Buka fail `js/config.js` guna Notepad. Cari baris ni:

```
API_URL: 'PASTE_WEB_APP_URL_DI_SINI',
```

Ganti dengan URL tadi, contoh:

```
API_URL: 'https://script.google.com/macros/s/AKfycb.../exec',
```

Save fail.

**Cara 2 (tanpa edit fail):**
Buka app → tekan ikon **⚙ gear** (kanan atas) → paste URL → **Uji Sambungan** → **Simpan**.
Cara ni kena buat sekali di setiap phone/PC.

---

## Bahagian C — Online-kan app (paling mudah: Netlify Drop)

PWA wajib guna link `https://`, jadi kena upload ke hosting. Cara paling senang:

**C1.** Buka https://app.netlify.com/drop (daftar percuma guna Google kalau diminta).

**C2.** **Drag keseluruhan folder `azn-invoice`** ke dalam kotak upload tu.

**C3.** Tunggu 10–20 saat. Netlify akan bagi link macam `https://nama-rawak.netlify.app`. Itulah link app kau.

**C4.** (Pilihan) Tukar nama link: **Site configuration → Change site name** → contoh `azn-invoice` → jadi `https://azn-invoice.netlify.app`.

> Alternatif: GitHub Pages pun boleh, cuma langkah lebih banyak.

---

## Install app di phone

**Android (Chrome):** Buka link → tekan menu ⋮ → **Add to Home screen / Install app**.

**iPhone (Safari — mesti Safari, bukan Chrome):** Buka link → tekan butang **Share** (kotak dengan anak panah ke atas) → **Add to Home Screen** → **Add**.

**Desktop (Chrome/Edge):** Buka link → klik ikon install (⊕) kat hujung address bar.

---

## Bahagian Admin — tukar maklumat syarikat

Semua maklumat syarikat (pengirim invoice) boleh ditukar terus dalam app, tak perlu sentuh kod.

1. Buka app → tab **Admin** (ikon perisai)
2. Masukkan PIN. **PIN pertama: `1234`** — tukar terus kat bahagian **Keselamatan**.
3. Ubah apa yang perlu:
   - Nama syarikat, no. SSM, alamat, email, no. telefon, prefix no. invoice
   - Nama bank & no. akaun
   - Nama & jawatan penandatangan (contoh: Managing Director)
   - **Logo, cop & tandatangan** — tekan **Tukar**, pilih gambar. Tekan **Default** untuk kembali ke gambar asal.
   - Notes 2 & 3 (ayat warranty)
4. Preview kat sebelah berubah terus — semak dulu.
5. Tekan **Simpan Tetapan**. Semua phone & PC yang guna app ni akan dapat maklumat baru bila buka app.

**Susun kedudukan cop & tandatangan** (dalam kad Logo, Cop & Tandatangan):

- **Tarik (drag)** cop atau tandatangan terus dalam preview, guna mouse atau jari. Boleh bertindih atau diasingkan.
- Pilih **Cop** atau **Tandatangan**, kemudian guna butang **↑ ↓ ← →** untuk gerak halus 1px (tekan lama untuk laju). Kat PC, kekunci anak panah pun boleh; tahan Shift untuk gerak 10px.
- **Slider Saiz** untuk besar/kecilkan.
- **Reset kedudukan & saiz asal** untuk balik ke susunan asal.
- Masa susun, item yang dipilih naik ke atas supaya senang ditarik. Dalam PDF sebenar, tandatangan sentiasa di atas cop.

Tips gambar cop & tandatangan: tangkap gambar atas kertas putih, cahaya terang. Kotak **"Buang background putih"** akan buang latar putih supaya cop bertindih cantik dengan tandatangan.

> Lupa PIN? Buka Google Sheet → tab `Settings` → baris `ADMIN_PIN` → taip PIN baru.

---

## Quotation & tukar jadi Invoice

**Buat quotation**

1. Tab **Buat Baru** → tekan **Quotation** (butang kat atas borang).
2. No. quotation keluar auto: `AZN-Q/MMYY-001` (turutan berasingan dari invoice).
3. Isi **Validity** (default 30 DAYS), Bill To dan item.
4. Tekan **Jana PDF & Simpan**. PDF masuk subfolder **Quotation** dalam folder Drive; data masuk tab `Quotations` dalam Google Sheet dengan status `PENDING`.

**Bila client setuju (hari yang sama atau seminggu kemudian)**

1. Tab **Rekod** → pilih **Quotation**.
2. Cari quotation tu → tekan **Tukar jadi Invoice →**.
3. Semua maklumat Bill To & item masuk ke borang Invoice. Nombor invoice baru dijana, tarikh hari ini, dan **Your Ref** diisi nombor quotation.
4. Semak (boleh ubah harga/item kalau ada perubahan) → **Jana PDF & Simpan**.
5. Quotation tu automatik bertukar status `CONVERTED` dan tercatat nombor invoicenya. Dalam Rekod akan nampak lencana hijau "INVOICE: AZN/...".

> Notes quotation (payment terms, delivery, validity) boleh ditukar dalam **Admin → Notes → Quotation**. Prefix `AZN-Q` boleh ditukar dalam Admin → Profil Syarikat.

---

## Delivery Order (DO)

**Buat DO dari invoice / quotation (cara paling cepat)**

1. Tab **Rekod** → pilih **Invoice** atau **Quotation**.
2. Tekan **Buat DO →** pada rekod tu.
3. Bill To & item masuk auto (tanpa harga). **Ref No** diisi nombor invoice/quotation, **PO No** diisi kalau ada.
4. **Ship To**: biar tanda "Sama dengan Bill To", atau buang tanda dan isi alamat hantar lain (tapak projek, gudang dll).
5. Tekan **Jana PDF & Simpan**. PDF masuk subfolder **Delivery Order**, data masuk tab `Delivery_Orders`, dan nombor DO dicatat dalam kolum **DO No** pada invoice/quotation asal.

**Buat DO kosong**: tab **Buat Baru** → tekan **DO** → isi macam biasa.

**Penandatangan DO** (Authorised By) boleh berbeza dari invoice — set dalam **Admin → Penandatangan DO**: nama, jawatan, no. telefon & gambar tandatangan. Kalau dibiar kosong, DO guna penandatangan utama. Ruang **Received By** dibiar kosong untuk client tandatangan masa terima barang.

---

## Cara guna harian

1. Buka app → tab **Invoice Baru**
2. **No. Invoice** keluar auto (format `AZN/MMYY-001`, ikut bulan & tahun tarikh). Tekan ⟳ kalau nak jana semula.
3. Isi **Bill To**, kemudian **Item**. Tekan **+ Tambah Item** untuk tambah baris. Jumlah dikira auto.
4. Tengok **Preview** (desktop: sebelah kanan; phone: tekan tab "Preview").
5. Tekan **Jana PDF & Simpan** → PDF masuk folder Google Drive, link PDF masuk kolum **Invoice** dalam Google Sheet.
6. Tab **Rekod** — senarai semua invoice + link PDF.

Butang **⬇ (Muat Turun Sahaja)** = jana PDF terus ke phone/PC tanpa simpan ke database (sesuai untuk draf).

---

## Bila nak ubah sesuatu

| Nak ubah | Fail | Lepas ubah |
|---|---|---|
| Nama syarikat, alamat, bank, penandatangan, logo, cop, sign | Tab **Admin** dalam app | Tekan Simpan Tetapan — siap |
| Nilai default borang | `js/config.js` → `DEFAULTS` | Upload semula folder ke Netlify |
| Folder Drive / API key | `Code.gs` → `CONFIG` | **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy** |

> Setiap kali update app, tukar `VERSION` dalam `sw.js` (contoh `v1.0.1`) supaya phone yang dah install dapat versi baru.

---

## Masalah biasa

| Masalah | Punca & penyelesaian |
|---|---|
| "Belum sambung ke database" | URL belum diisi. Ikut Bahagian B. |
| "API key tidak sah" | `API_KEY` dalam `config.js` dan `Code.gs` tak sama. |
| "No. invoice sudah wujud" | Tekan ⟳ sebelah No. Invoice untuk dapat nombor baru. |
| Ubah Code.gs tapi tak berkesan | Kena **deploy New version** (lihat jadual atas). URL kekal sama. |
| Link PDF tak boleh dibuka orang lain | Akaun Google Workspace tertentu sekat share public. Share folder Drive secara manual. |
| iPhone tak keluar "Add to Home Screen" | Mesti guna **Safari**. |
| "PIN salah" di Admin | Semak/tukar PIN dalam Google Sheet → tab `Settings` → `ADMIN_PIN`. |
| Tab Admin kata "Belum sambung ke database" | Isi Web App URL dulu (Bahagian B). |
