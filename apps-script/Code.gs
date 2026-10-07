/**
 * =========================================================
 *  AZN INVOICE, QUOTATION & DELIVERY ORDER — BACKEND (Google Apps Script)
 *  Database : Google Sheet (fail ini mesti dibuka dari Sheet:
 *             Extensions > Apps Script)
 *  Storage  : Google Drive folder (PDF invoice)
 * =========================================================
 *  LANGKAH PERTAMA: pilih function "setupSystem" > tekan Run
 * =========================================================
 */

const CONFIG = {
  FOLDER_ID: '19QZOxTKbLaEyK8Qm8cVTJAKod4R8zDJm',   // Folder Google Drive untuk PDF
  API_KEY: 'AZN-2026-INVOICE',                        // Mesti sama dengan js/config.js
  PREFIX: 'AZN',                                      // Format: AZN/MMYY-001
  SHEET: 'Invoices',
  ITEM_SHEET: 'Invoice_Items',
  Q_SHEET: 'Quotations',
  Q_ITEM_SHEET: 'Quotation_Items',
  Q_FOLDER: 'Quotation',                              // subfolder PDF quotation
  DO_SHEET: 'Delivery_Orders',
  DO_ITEM_SHEET: 'DO_Items',
  DO_FOLDER: 'Delivery Order',                        // subfolder PDF DO
  SETTINGS_SHEET: 'Settings',
  SETTINGS_FOLDER: '_Tetapan (logo, cop, sign)',      // subfolder dalam folder invoice
  DEFAULT_PIN: '1234',                                // PIN admin pertama — TUKAR dalam app
  TZ: 'Asia/Kuala_Lumpur'
};

// 15 kolum pertama SAMA untuk Invoice & Quotation (kod dikongsi)
const HEADERS = [
  'Timestamp', 'Invoice No', 'Date', 'Bill To', 'Address', 'Tel', 'Attn',
  'Our Ref', 'Your Ref', 'Terms', 'Total (RM)', 'Amount in Words', 'Bil. Item', 'Invoice', 'File ID',
  'Quotation Ref', 'DO No'
];
const Q_HEADERS = [
  'Timestamp', 'Quotation No', 'Date', 'Bill To', 'Address', 'Tel', 'Attn',
  'Our Ref', 'Your Ref', 'Terms', 'Total (RM)', 'Amount in Words', 'Bil. Item', 'Quotation', 'File ID',
  'Validity', 'Status', 'Invoice No', 'DO No'
];
const DO_HEADERS = [
  'Timestamp', 'DO No', 'Date', 'Bill To', 'Address', 'Tel', 'Contact',
  'Ref No', 'PO No', 'Terms', 'Total Qty', 'Remarks', 'Bil. Item', 'Delivery Order', 'File ID',
  'Ship To', 'Ship Address', 'Ship Contact', 'Ship Tel', 'Source Type', 'Source No'
];
const DO_ITEM_HEADERS = ['DO No', 'No.', 'Description', 'Qty', 'Unit'];
const ITEM_HEADERS = ['Invoice No', 'No.', 'Description', 'Qty', 'Unit', 'Price/Unit (RM)', 'Amount (RM)'];
const Q_ITEM_HEADERS = ['Quotation No', 'No.', 'Description', 'Qty', 'Unit', 'Price/Unit (RM)', 'Amount (RM)'];

/** Definisi jenis dokumen */
function docDef_(type) {
  if (type === 'do') return { type: 'do', label: 'Delivery Order', sheet: CONFIG.DO_SHEET, items: CONFIG.DO_ITEM_SHEET,
    headers: DO_HEADERS, itemHeaders: DO_ITEM_HEADERS, prefixKey: 'doPrefix', color: '#065f46' };
  return type === 'quotation'
    ? { type: 'quotation', label: 'Quotation', sheet: CONFIG.Q_SHEET, items: CONFIG.Q_ITEM_SHEET, headers: Q_HEADERS,
        itemHeaders: Q_ITEM_HEADERS, prefixKey: 'qPrefix', color: '#7c2d12' }
    : { type: 'invoice', label: 'Invoice', sheet: CONFIG.SHEET, items: CONFIG.ITEM_SHEET, headers: HEADERS,
        itemHeaders: ITEM_HEADERS, prefixKey: 'prefix', color: '#0f172a' };
}

// Maklumat syarikat default (sama macam invoice asal). Boleh ditukar melalui tab Admin dalam app.
const DEFAULT_SETTINGS = [
  ['name', 'AZN POWER SOLUTION', 'Nama syarikat'],
  ['regNo', 'LA0050194-P', 'No. pendaftaran'],
  ['address', 'NO 32 LORONG 12 TAMAN HALAMAN INDAH 14200 SUNGAI JAWI', 'Alamat'],
  ['email', 'aznpowersolution@gmail.com', 'Email'],
  ['tel', '019-5135033', 'No. telefon'],
  ['prefix', 'AZN', 'Prefix no. invoice (AZN/MMYY-001)'],
  ['bankName', 'MAYBANK', 'Nama bank'],
  ['bankAcc', '557102161049', 'No. akaun bank'],
  ['signName', 'SITI FATIMAH BINTI JAMAL', 'Nama penandatangan'],
  ['signTitle', 'MANAGING DIRECTOR', 'Jawatan penandatangan'],
  ['note2', 'Goods sold are warranty within 3 days.', 'Notes 2'],
  ['note3', 'There is NO MONEY BACK GUARANTEE.', 'Notes 3'],
  ['qPrefix', 'AZN-Q', 'Prefix no. quotation (AZN-Q/MMYY-001)'],
  ['qNote1', 'Payment terms: 50% deposit upon confirmation, balance upon completion.', 'Notes quotation 2'],
  ['qNote2', 'Delivery / completion: 2 - 3 weeks upon confirmation of order.', 'Notes quotation 3'],
  ['qNote3', 'Prices are subject to change after the validity period.', 'Notes quotation 4'],
  ['doPrefix', 'AZN-DO', 'Prefix no. DO (AZN-DO/MMYY-001)'],
  ['doNote1', 'Please check all goods upon delivery. Any discrepancy must be reported within 24 hours.', 'Notes DO 1'],
  ['doNote2', 'Goods received in good order and condition.', 'Notes DO 2'],
  ['doSignName', '', 'Nama penandatangan DO (kosong = sama macam invoice)'],
  ['doSignTitle', '', 'Jawatan penandatangan DO'],
  ['doSignTel', '', 'No. telefon penandatangan DO'],
  ['doSignatureFileId', '', 'ID fail tandatangan DO (kosong = guna tandatangan utama)'],
  ['stampX', '36', 'Kedudukan cop — kiri (px)'],
  ['stampY', '20', 'Kedudukan cop — atas (px)'],
  ['stampSize', '106', 'Saiz cop (px)'],
  ['signX', '24', 'Kedudukan tandatangan — kiri (px)'],
  ['signY', '28', 'Kedudukan tandatangan — atas (px)'],
  ['signW', '150', 'Lebar tandatangan (px)'],
  ['logoFileId', '', 'ID fail logo di Drive (kosong = logo default)'],
  ['stampFileId', '', 'ID fail cop di Drive (kosong = cop default)'],
  ['signatureFileId', '', 'ID fail tandatangan di Drive (kosong = default)'],
  ['ADMIN_PIN', '', 'PIN admin (default 1234 — tukar dalam app)'],
  ['updatedAt', '', 'Auto — jangan ubah']
];
const PUBLIC_KEYS = ['name', 'regNo', 'address', 'email', 'tel', 'prefix', 'bankName', 'bankAcc', 'signName', 'signTitle', 'note2', 'note3',
  'qPrefix', 'qNote1', 'qNote2', 'qNote3',
  'doPrefix', 'doNote1', 'doNote2', 'doSignName', 'doSignTitle', 'doSignTel',
  'stampX', 'stampY', 'stampSize', 'signX', 'signY', 'signW'];
const IMAGE_KEYS = { logo: 'logoFileId', stamp: 'stampFileId', signature: 'signatureFileId', doSignature: 'doSignatureFileId' };

/* =========================================================
   1) SETUP — RUN SEKALI SAHAJA
   ========================================================= */
function setupSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Script ini mesti dibuka dari Google Sheet (Extensions > Apps Script).');

  // --- Sheet Invoices / Quotations + item ---
  ['invoice', 'quotation', 'do'].forEach(t => setupDocSheets_(ss, docDef_(t)));

  // --- Sheet Settings (maklumat syarikat) — nilai sedia ada TIDAK ditimpa ---
  let st = ss.getSheetByName(CONFIG.SETTINGS_SHEET);
  if (!st) st = ss.insertSheet(CONFIG.SETTINGS_SHEET);
  st.getRange(1, 1, 1, 3).setValues([['Key', 'Value', 'Keterangan']])
    .setFontWeight('bold').setBackground('#b25a0b').setFontColor('#ffffff');
  st.setFrozenRows(1);
  st.getRange('A:B').setNumberFormat('@');
  [140, 380, 320].forEach((w, i) => st.setColumnWidth(i + 1, w));
  const existing = readSettingsRaw_(st);
  DEFAULT_SETTINGS.forEach(([k, v, note]) => {
    if (!(k in existing)) {
      let val = v;
      if (k === 'ADMIN_PIN') val = CONFIG.DEFAULT_PIN;
      if (k === 'updatedAt') val = new Date().toISOString();
      st.appendRow([k, val, note]);
    }
  });

  // Buang "Sheet1" kosong kalau ada
  const def = ss.getSheetByName('Sheet1');
  if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);

  // --- Uji akses folder Drive ---
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);

  const msg = 'SETUP BERJAYA ✅\n\n' +
    '• Sheet Invoices, Quotations, Delivery_Orders (+ item) siap\n' +
    '• Folder Drive: ' + folder.getName() + '\n' +
    '• Sheet "Settings" siap — PIN admin: ' + getSettings_().ADMIN_PIN + '\n\n' +
    'Langkah seterusnya: Deploy > New deployment > Web app';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* run dari editor — abaikan */ }
  return msg;
}

function setupDocSheets_(ss, def) {
  let sh = ss.getSheetByName(def.sheet);
  if (!sh) sh = ss.insertSheet(def.sheet, { invoice: 0, quotation: 1, do: 2 }[def.type]);
  sh.getRange(1, 1, 1, def.headers.length).setValues([def.headers])
    .setFontWeight('bold').setBackground(def.color).setFontColor('#ffffff').setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  sh.setRowHeight(1, 32);
  // Kolum teks (elak Sheet tukar tarikh / buang 0 depan no telefon)
  ['B:B', 'C:C', 'F:F', 'H:H', 'I:I', 'P:P', 'Q:Q', 'R:R', 'S:S', 'U:U'].forEach(a => sh.getRange(a).setNumberFormat('@'));
  sh.getRange('A:A').setNumberFormat('dd/mm/yyyy hh:mm');
  sh.getRange('K:K').setNumberFormat(def.type === 'do' ? '0.0' : '#,##0.00');
  [140, 130, 95, 230, 260, 110, 120, 90, 90, 80, 110, 300, 70, 320, 120, 160, 220, 130, 110, 100, 130]
    .slice(0, def.headers.length).forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange('N1').setBackground('#ef9a12').setFontColor('#111827'); // highlight kolum link PDF

  let it = ss.getSheetByName(def.items);
  if (!it) it = ss.insertSheet(def.items);
  it.getRange(1, 1, 1, def.itemHeaders.length).setValues([def.itemHeaders])
    .setFontWeight('bold').setBackground('#334155').setFontColor('#ffffff');
  it.setFrozenRows(1);
  it.getRange('A:A').setNumberFormat('@');
  if (def.type !== 'do') it.getRange('F:G').setNumberFormat('#,##0.00');
  [130, 50, 380, 60, 70, 120, 120].slice(0, def.itemHeaders.length).forEach((w, i) => it.setColumnWidth(i + 1, w));
}

/* =========================================================
   2) API — GET
   ?action=ping | nextNo&date=DD/MM/YYYY | list
   ========================================================= */
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (p.key !== CONFIG.API_KEY) return json_({ ok: false, error: 'API key tidak sah' });

    switch (p.action) {
      case 'ping':
        return json_({ ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName() });
      case 'nextNo':
        return json_({ ok: true, invoiceNo: nextInvoiceNo_(p.date, p.type) });
      case 'getDoc':
        return json_(getDoc_(p.type, p.no));
      case 'settings': {
        const s = getSettings_();
        if (p.since && p.since === s.updatedAt) return json_({ ok: true, unchanged: true, updatedAt: s.updatedAt });
        const pub = {}; PUBLIC_KEYS.forEach(k => pub[k] = s[k] || '');
        const images = {};
        Object.keys(IMAGE_KEYS).forEach(k => { images[k] = imageDataUri_(s[IMAGE_KEYS[k]]); });
        return json_({ ok: true, updatedAt: s.updatedAt, settings: pub, images: images });
      }
      case 'list':
        return json_({ ok: true, rows: listInvoices_(Number(p.limit) || 300, p.type) });
      default:
        return json_({ ok: true, app: 'AZN Invoice API', time: new Date().toISOString() });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

/* =========================================================
   3) API — POST  (simpan invoice + PDF)
   body: { action:'save', key, data:{...}, fileName, pdfBase64 }
   ========================================================= */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.key !== CONFIG.API_KEY) return json_({ ok: false, error: 'API key tidak sah' });
    if (body.action === 'verifyPin') {
      return json_(checkPin_(body.pin) ? { ok: true } : { ok: false, error: 'PIN salah' });
    }
    if (body.action === 'saveSettings') {
      if (!checkPin_(body.pin)) return json_({ ok: false, error: 'PIN salah — sila kunci & masuk semula' });
      lock.waitLock(20000);
      return json_(saveSettings_(body));
    }
    if (body.action !== 'save') return json_({ ok: false, error: 'Action tidak dikenali' });

    const d = body.data || {};
    const def = docDef_(d.docType);
    if (!d.invoiceNo || !d.billName) return json_({ ok: false, error: 'Data tidak lengkap' });
    if (!body.pdfBase64) return json_({ ok: false, error: 'PDF tiada' });

    lock.waitLock(20000);
    const sh = getSheet_(def);

    // Elak no berulang
    if (findRow_(sh, d.invoiceNo) > 0) {
      return json_({ ok: false, code: 'DUPLICATE',
        error: 'No. ' + def.label.toLowerCase() + ' ' + d.invoiceNo + ' sudah wujud. Tekan butang ⟳ untuk nombor baru.' });
    }

    // Simpan PDF ke Drive (invoice → folder utama, quotation → subfolder Quotation)
    let folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
    if (def.type === 'quotation') folder = getSubFolder_(CONFIG.Q_FOLDER);
    if (def.type === 'do') folder = getSubFolder_(CONFIG.DO_FOLDER);
    const name = (body.fileName || (d.invoiceNo.replace(/\//g, '-') + '.pdf')).replace(/[\\/:*?"<>|]/g, '-');
    const blob = Utilities.newBlob(Utilities.base64Decode(body.pdfBase64), 'application/pdf', name);
    const file = folder.createFile(blob);
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      // Sesetengah akaun Workspace tak benarkan share public — fail tetap disimpan
    }
    const url = file.getUrl();

    // Rekod ke Sheet
    const items = Array.isArray(d.items) ? d.items : [];
    const row = [
      new Date(), d.invoiceNo, d.date || '', d.billName, d.billAddress || '', d.billTel || '',
      d.attn || '', d.ourRef || '', d.yourRef || '', d.terms || '',
      Number(d.total) || 0, d.words || '', items.length, url, file.getId()
    ];
    if (def.type === 'quotation') row.push(d.validity || '', 'PENDING', '', '');
    else if (def.type === 'do') row.push(d.shipName || '', d.shipAddress || '', d.shipAttn || '', d.shipTel || '',
      d.sourceType || '', d.sourceNo || '');
    else row.push(d.quotationRef || '', '');
    sh.appendRow(row);

    // Rekod item
    if (items.length) {
      const it = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.items);
      if (it) {
        const rows = items.map((x, i) => [d.invoiceNo, i + 1, x.desc, Number(x.qty) || 0, x.unit || '',
          Number(x.price) || 0, Number(x.amount) || 0].slice(0, def.itemHeaders.length));
        it.getRange(it.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      }
    }

    // Invoice dari quotation → tanda quotation sebagai CONVERTED
    if (def.type === 'invoice' && d.quotationRef) {
      const qs = getSheet_(docDef_('quotation'));
      const qr = findRow_(qs, d.quotationRef);
      if (qr > 0) {
        const prev = String(qs.getRange(qr, 18).getDisplayValue() || '').trim();
        qs.getRange(qr, 17, 1, 2).setValues([['CONVERTED', prev ? prev + ', ' + d.invoiceNo : d.invoiceNo]]);
      }
    }

    // DO dari invoice/quotation → catat no DO pada dokumen asal
    if (def.type === 'do' && d.sourceNo && (d.sourceType === 'invoice' || d.sourceType === 'quotation')) {
      const sdef = docDef_(d.sourceType);
      const ss2 = getSheet_(sdef);
      const sr = findRow_(ss2, d.sourceNo);
      const col = sdef.headers.indexOf('DO No') + 1;
      if (sr > 0 && col > 0) {
        const prev = String(ss2.getRange(sr, col).getDisplayValue() || '').trim();
        ss2.getRange(sr, col).setValue(prev ? prev + ', ' + d.invoiceNo : d.invoiceNo);
      }
    }

    return json_({ ok: true, url: url, fileId: file.getId(), invoiceNo: d.invoiceNo });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/* =========================================================
   HELPERS
   ========================================================= */
function getSheet_(def) {
  def = def || docDef_('invoice');
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.sheet);
  if (!sh) throw new Error('Sheet "' + def.sheet + '" tiada. Run setupSystem dulu.');
  return sh;
}

function getSubFolder_(name) {
  const parent = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** Ambil dokumen penuh (untuk "Tukar jadi Invoice") */
function getDoc_(type, no) {
  const def = docDef_(type);
  const sh = getSheet_(def);
  const r = findRow_(sh, no);
  if (r < 0) return { ok: false, error: def.label + ' ' + no + ' tidak dijumpai' };
  const v = sh.getRange(r, 1, 1, def.headers.length).getDisplayValues()[0];
  const doc = {
    invoiceNo: v[1], date: v[2], billName: v[3], billAddress: v[4], billTel: v[5], attn: v[6],
    ourRef: v[7], yourRef: v[8], terms: v[9], url: v[13]
  };
  if (def.type === 'quotation') { doc.validity = v[15]; doc.status = v[16]; doc.invoiceRef = v[17]; }
  const it = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(def.items);
  doc.items = [];
  if (it && it.getLastRow() > 1) {
    const target = String(no).trim().toUpperCase();
    it.getRange(2, 1, it.getLastRow() - 1, 7).getValues().forEach(x => {
      if (String(x[0]).trim().toUpperCase() === target)
        doc.items.push({ n: Number(x[1]) || 0, desc: String(x[2]), qty: Number(x[3]) || 0, unit: String(x[4]), price: Number(x[5]) || 0 });
    });
    doc.items.sort((a, b) => a.n - b.n);
  }
  return { ok: true, doc: doc };
}

function findRow_(sh, invoiceNo) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const vals = sh.getRange(2, 2, last - 1, 1).getDisplayValues();
  const target = String(invoiceNo).trim().toUpperCase();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim().toUpperCase() === target) return i + 2;
  }
  return -1;
}

/** No invoice seterusnya ikut bulan/tahun: AZN/MMYY-001 */
function nextInvoiceNo_(dateDMY, type) {
  const def = docDef_(type);
  let mm, yy;
  const m = String(dateDMY || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) { mm = m[2]; yy = m[3].slice(2); }
  else {
    const now = new Date();
    mm = Utilities.formatDate(now, CONFIG.TZ, 'MM');
    yy = Utilities.formatDate(now, CONFIG.TZ, 'yy');
  }
  const st = getSettings_();
  const prefix = String(st[def.prefixKey] || ({ quotation: 'AZN-Q', do: 'AZN-DO' }[def.type] || CONFIG.PREFIX)).toUpperCase();
  const base = prefix + '/' + mm + yy + '-';
  const sh = getSheet_(def);
  const last = sh.getLastRow();
  let max = 0;
  if (last >= 2) {
    sh.getRange(2, 2, last - 1, 1).getDisplayValues().forEach(r => {
      const v = String(r[0]).toUpperCase();
      if (v.indexOf(base) === 0) {
        const n = parseInt(v.slice(base.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
  }
  return base + String(max + 1).padStart(3, '0');
}

function listInvoices_(limit, type) {
  const def = docDef_(type);
  const sh = getSheet_(def);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const start = Math.max(2, last - limit + 1);
  const n = def.headers.length;
  const vals = sh.getRange(start, 1, last - start + 1, n).getValues();
  const disp = sh.getRange(start, 1, last - start + 1, n).getDisplayValues();
  return vals.map((r, i) => {
    const o = {
      timestamp: disp[i][0], invoiceNo: disp[i][1], date: disp[i][2], billName: disp[i][3],
      total: Number(r[10]) || 0, url: disp[i][13]
    };
    if (def.type === 'quotation') { o.validity = disp[i][15]; o.status = disp[i][16]; o.invoiceRef = disp[i][17]; o.doRef = disp[i][18] || ''; }
    else if (def.type === 'do') { o.refNo = disp[i][7]; o.po = disp[i][8]; o.shipName = disp[i][15]; o.sourceType = disp[i][19]; o.sourceNo = disp[i][20]; }
    else { o.quotationRef = disp[i][15] || ''; o.doRef = disp[i][16] || ''; }
    return o;
  }).reverse();
}

/* ---------- Settings helpers ---------- */
function readSettingsRaw_(sh) {
  const out = {};
  const last = sh.getLastRow();
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, 2).getDisplayValues().forEach(r => { if (r[0]) out[String(r[0]).trim()] = { value: r[1] }; });
  return out;
}

function getSettings_() {
  const s = {};
  DEFAULT_SETTINGS.forEach(([k, v]) => s[k] = v);
  s.ADMIN_PIN = CONFIG.DEFAULT_PIN;
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SETTINGS_SHEET);
  if (!sh) return s;
  const raw = readSettingsRaw_(sh);
  Object.keys(raw).forEach(k => { if (raw[k].value !== '' || k.indexOf('FileId') > 0) s[k] = raw[k].value; });
  return s;
}

function setSettings_(obj) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SETTINGS_SHEET);
  if (!sh) throw new Error('Sheet Settings tiada. Run setupSystem dulu.');
  const last = sh.getLastRow();
  const keys = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getDisplayValues().map(r => String(r[0]).trim()) : [];
  Object.keys(obj).forEach(k => {
    const idx = keys.indexOf(k);
    if (idx >= 0) sh.getRange(idx + 2, 2).setValue(String(obj[k]));
    else { sh.appendRow([k, String(obj[k]), '']); keys.push(k); }
  });
}

function checkPin_(pin) {
  return String(pin || '').trim() !== '' && String(pin).trim() === String(getSettings_().ADMIN_PIN).trim();
}

function saveSettings_(body) {
  const cur = getSettings_();
  const upd = {};
  const s = body.settings || {};
  PUBLIC_KEYS.forEach(k => { if (k in s) upd[k] = String(s[k] == null ? '' : s[k]).trim(); });
  if (!upd.name) return { ok: false, error: 'Nama syarikat tak boleh kosong' };
  if (body.newPin) {
    if (!/^\d{4,8}$/.test(String(body.newPin))) return { ok: false, error: 'PIN baru mesti 4–8 digit' };
    upd.ADMIN_PIN = String(body.newPin);
  }

  // Gambar: base64 PNG → simpan dalam subfolder Drive; 'RESET' → guna default
  const imgs = body.images || {};
  Object.keys(IMAGE_KEYS).forEach(k => {
    if (!(k in imgs)) return;
    const idKey = IMAGE_KEYS[k];
    const oldId = cur[idKey];
    if (imgs[k] === 'RESET') {
      upd[idKey] = '';
    } else if (imgs[k]) {
      const folder = getSettingsFolder_();
      const blob = Utilities.newBlob(Utilities.base64Decode(imgs[k]), 'image/png', k + '_' + Date.now() + '.png');
      upd[idKey] = folder.createFile(blob).getId();
    } else return;
    if (oldId) { try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) {} }
  });

  upd.updatedAt = new Date().toISOString();
  setSettings_(upd);
  return { ok: true, updatedAt: upd.updatedAt };
}

function getSettingsFolder_() {
  return getSubFolder_(CONFIG.SETTINGS_FOLDER);
}

function imageDataUri_(fileId) {
  if (!fileId) return null;
  try {
    const blob = DriveApp.getFileById(fileId).getBlob();
    return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
  } catch (e) { return null; }
}

/** Bila sheet Settings diedit terus dalam Google Sheet, tandakan versi baru supaya app ambil perubahan */
function onEdit(e) {
  try {
    const sh = e.range.getSheet();
    if (sh.getName() !== CONFIG.SETTINGS_SHEET || e.range.getRow() < 2) return;
    setSettings_({ updatedAt: new Date().toISOString() });
  } catch (err) {}
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* =========================================================
   UJIAN (pilihan) — run untuk test nombor invoice
   ========================================================= */
function testNextNo() {
  const today = Utilities.formatDate(new Date(), CONFIG.TZ, 'dd/MM/yyyy');
  Logger.log('Invoice: ' + nextInvoiceNo_(today, 'invoice') + '   Quotation: ' + nextInvoiceNo_(today, 'quotation') + '   DO: ' + nextInvoiceNo_(today, 'do'));
}
