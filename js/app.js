/* =========================================================
   AZN INVOICE — APP LOGIC
   ========================================================= */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG;
  const DEFAULT_CO = { ...CFG.COMPANY };
  const DEFAULT_IMG = { ...CFG.IMAGES };
  let CO = { ...DEFAULT_CO };          // maklumat syarikat yang sedang digunakan
  let IMG = { ...DEFAULT_IMG };        // logo / cop / sign (path atau data URI)
  let SAVED = { co: { ...CO }, img: { ...IMG } };   // versi tersimpan (untuk batal)
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ---------- Safe storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  const conn = () => {
    const o = store.get('azn_conn', {});
    return { url: (o.url || CFG.API_URL || '').trim(), key: o.key || CFG.API_KEY };
  };
  const apiReady = () => /^https:\/\/script\.google\.com\/.+\/exec$/.test(conn().url);

  // ---------- State ----------
  let items = [];
  let invNoTouched = false;
  let docType = 'invoice';      // 'invoice' | 'quotation' | 'do'
  let source = null;            // { type, no } — dokumen asal (quotation→invoice, invoice/quotation→DO)
  let adminPreviewDoc = '';     // pilihan preview dalam Admin (notes)
  const isQ = () => docType === 'quotation';
  const isDO = () => docType === 'do';
  const LABELS = { invoice: 'Invoice', quotation: 'Quotation', do: 'Delivery Order' };
  const docLabel = t => LABELS[t || docType] || 'Invoice';
  let lastPdf = null;        // { blob, name }
  let lastLink = '';
  let histCache = {};

  // ---------- Formatters ----------
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const fmtMoney = n => round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtQty = q => {
    q = Number(q) || 0;
    return Number.isInteger(q * 10) ? q.toFixed(1) : String(round2(q));
  };
  const toDMY = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
  const todayISO = () => {
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const parseNum = v => {
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v).replace(/,/g, '').trim());
    return isNaN(n) ? 0 : n;
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Number to words (English, RM) ----------
  const ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE',
    'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
  const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
  function below1000(n) {
    let s = '';
    if (n >= 100) { s += ONES[Math.floor(n / 100)] + ' HUNDRED'; n %= 100; if (n) s += ' '; }
    if (n >= 20) { s += TENS[Math.floor(n / 10)]; if (n % 10) s += '-' + ONES[n % 10]; }
    else if (n > 0) s += ONES[n];
    return s;
  }
  function intToWords(n) {
    if (n === 0) return 'ZERO';
    const scales = [[1e9, 'BILLION'], [1e6, 'MILLION'], [1e3, 'THOUSAND']];
    let out = [];
    for (const [v, w] of scales) {
      if (n >= v) { out.push(below1000(Math.floor(n / v)) + ' ' + w); n %= v; }
    }
    if (n > 0) out.push(below1000(n));
    return out.join(' ');
  }
  function amountToWords(amount) {
    const total = round2(amount);
    const ringgit = Math.floor(total);
    const sen = Math.round((total - ringgit) * 100);
    let s = intToWords(ringgit);
    if (sen > 0) s += ' AND CENTS ' + intToWords(sen);
    return s + ' ONLY.';
  }

  // ---------- Toast ----------
  let toastT;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg; t.classList.toggle('error', !!isErr); t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function loading(on, text, sub) {
    $('#loading').classList.toggle('hidden', !on);
    if (text) $('#loadingText').textContent = text;
    $('#loadingSub').textContent = sub || 'Jangan tutup aplikasi';
  }

  // ---------- Form data ----------
  const FIELDS = ['invoiceNo', 'date', 'terms', 'attn', 'ourRef', 'yourRef', 'billName', 'billAddress', 'billTel', 'validity',
    'shipName', 'shipAddress', 'shipAttn', 'shipTel'];
  function getForm() {
    const f = {};
    FIELDS.forEach(id => f[id] = $('#' + id).value.trim());
    ['billName', 'billAddress', 'attn', 'terms', 'validity', 'shipName', 'shipAddress', 'shipAttn'].forEach(k => f[k] = f[k].toUpperCase());
    f.docType = docType;
    if (!isQ()) delete f.validity;
    if (isDO()) {
      f.terms = '';
      if ($('#shipSame').checked) { f.shipName = f.billName; f.shipAddress = f.billAddress; f.shipAttn = f.attn; f.shipTel = f.billTel; }
      if (source) { f.sourceType = source.type; f.sourceNo = source.no; }
    } else {
      ['shipName', 'shipAddress', 'shipAttn', 'shipTel'].forEach(k => delete f[k]);
      if (source && source.type === 'quotation') f.quotationRef = source.no;
    }
    f.invoiceNo = f.invoiceNo.toUpperCase();
    f.dateDMY = toDMY(f.date);
    f.items = items.map(it => ({
      desc: it.desc.trim(), qty: parseNum(it.qty), unit: (it.unit || '').toUpperCase().trim(),
      price: parseNum(it.price), amount: round2(parseNum(it.qty) * parseNum(it.price))
    }));
    f.totalQty = round2(f.items.filter(it => it.desc || it.price).reduce((a, b) => a + (b.qty || 0), 0));
    f.total = isDO() ? f.totalQty : round2(f.items.reduce((a, b) => a + b.amount, 0));
    f.words = !isDO() && f.total > 0 ? amountToWords(f.total) : '';
    return f;
  }

  function fillForm(d) {
    $('#billName').value = d.billName || '';
    $('#billAddress').value = d.billAddress || '';
    $('#billTel').value = d.billTel || '';
    $('#attn').value = d.attn || '';
    $('#ourRef').value = d.ourRef || '';
    $('#yourRef').value = d.yourRef || '';
    $('#terms').value = d.terms ?? '';
    $('#validity').value = d.validity ?? CFG.DEFAULTS.validity ?? '';
    ['shipName', 'shipAddress', 'shipAttn', 'shipTel'].forEach(k => $('#' + k).value = d[k] || '');
    setShipSame(d.shipSame !== false && !d.shipName);
    $('#date').value = d.date || todayISO();
    if (d.invoiceNo) { $('#invoiceNo').value = d.invoiceNo; }
    items = (d.items || []).map(x => ({ desc: x.desc || '', qty: x.qty ?? 1, unit: x.unit || 'UNIT', price: x.price ?? '' }));
    if (!items.length) items.push(blankItem());
  }
  const blankItem = () => ({ desc: '', qty: 1, unit: 'UNIT', price: '' });
  function setShipSame(on) {
    $('#shipSame').checked = on;
    $('#shipFields').classList.toggle('hidden', on);
  }

  // ---------- Items UI ----------
  function renderItems() {
    const list = $('#itemList');
    list.innerHTML = items.map((it, i) => `
      <div class="item-card" data-i="${i}">
        <div class="flex items-center gap-2 mb-2">
          <span class="num">${i + 1}</span>
          <span class="text-xs font-medium text-slate-500">Item ${i + 1}</span>
          <div class="ml-auto flex items-center">
            <button type="button" class="icon-btn" data-act="dup" title="Salin item">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>
            </button>
            <button type="button" class="icon-btn del" data-act="del" title="Padam item" ${items.length === 1 ? 'disabled' : ''}>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4h6v3"/></svg>
            </button>
          </div>
        </div>
        <textarea class="inp resize-none text-sm" rows="2" data-f="desc" placeholder="Description (cth: To supply ...)">${esc(it.desc)}</textarea>
        <div class="grid grid-cols-12 gap-2 mt-2">
          <div class="${isDO() ? 'col-span-5' : 'col-span-3'}">
            <label class="lbl">Qty</label>
            <input class="inp text-center" inputmode="decimal" data-f="qty" value="${esc(it.qty)}" />
          </div>
          <div class="${isDO() ? 'col-span-7' : 'col-span-4'}">
            <label class="lbl">Unit</label>
            <input class="inp uppercase-input" list="unitList" data-f="unit" value="${esc(it.unit)}" />
          </div>
          <div class="col-span-5 no-do">
            <label class="lbl">Price/Unit (RM)</label>
            <input class="inp text-right" inputmode="decimal" data-f="price" value="${esc(it.price)}" placeholder="0.00" />
          </div>
        </div>
        <div class="flex justify-between items-center mt-2 pt-2 border-t border-slate-200 text-sm no-do">
          <span class="text-slate-500">Amount</span>
          <span class="font-semibold text-slate-900" data-amt>RM${fmtMoney(parseNum(it.qty) * parseNum(it.price))}</span>
        </div>
      </div>`).join('') +
      `<datalist id="unitList">${CFG.UNITS.map(u => `<option value="${u}"></option>`).join('')}</datalist>`;
    $('#itemCount').textContent = `${items.length} item`;
  }

  function onItemInput(e) {
    const el = e.target; const f = el.dataset.f; if (!f) return;
    const card = el.closest('.item-card'); const i = +card.dataset.i;
    items[i][f] = el.value;
    if (f === 'qty' || f === 'price') {
      $('[data-amt]', card).textContent = 'RM' + fmtMoney(parseNum(items[i].qty) * parseNum(items[i].price));
    }
    update();
  }
  function onItemClick(e) {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const i = +b.closest('.item-card').dataset.i;
    if (b.dataset.act === 'del' && items.length > 1) items.splice(i, 1);
    if (b.dataset.act === 'dup') items.splice(i + 1, 0, { ...items[i] });
    renderItems(); update();
  }
  function addItem() {
    items.push(blankItem()); renderItems(); update();
    const cards = $$('.item-card'); const last = cards[cards.length - 1];
    last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => $('textarea', last).focus({ preventScroll: true }), 300);
  }

  // ---------- Preview ----------
  function renderPreview(f) {
    const pt = currentView === 'admin' && adminPreviewDoc ? adminPreviewDoc : docType;
    const pq = pt === 'quotation', pd = pt === 'do';
    const bind = {
      coName: CO.name, coReg: CO.regNo, coAddr: CO.address, coEmail: CO.email, coTel: CO.tel,
      bankName: CO.bankName, bankAcc: CO.bankAcc,
      signName: pd ? (CO.doSignName || CO.signName) : CO.signName,
      signTitle: pd ? (CO.doSignName ? CO.doSignTitle : (CO.doSignTitle || CO.signTitle)) : CO.signTitle,
      signTel: CO.doSignTel || '',
      doNote1: CO.doNote1, doNote2: CO.doNote2,
      shipName: f.shipName ?? f.billName, shipAddress: f.shipAddress ?? f.billAddress,
      shipAttn: f.shipAttn ?? f.attn, shipTel: f.shipTel ?? f.billTel,
      note2: CO.note2, note3: CO.note3, qNote1: CO.qNote1, qNote2: CO.qNote2, qNote3: CO.qNote3,
      billName: f.billName, billAddress: f.billAddress, billTel: f.billTel, attn: f.attn,
      invoiceNo: f.invoiceNo, ourRef: f.ourRef, yourRef: f.yourRef, terms: f.terms, date: f.dateDMY,
      totalRM: 'RM' + fmtMoney(f.total), words: f.words,
      validity: f.validity || '',
      docTitle: pd ? 'DELIVERY ORDER' : pq ? 'QUOTATION' : 'INVOICE',
      noLabel: pq ? 'QUOTATION NO' : 'INVOICE NO',
      totalLabel: pd ? 'TOTAL QUANTITY' : pq ? 'TOTAL AMOUNT' : 'TOTAL AMOUNT FOR THIS CLAIM'
    };
    if (pd) bind.totalRM = fmtQty(f.totalQty);
    $('#invoicePage').classList.toggle('is-quote', pq);
    $('#invoicePage').classList.toggle('is-do', pd);
    $$('#invoicePage [data-bind]').forEach(el => { el.textContent = bind[el.dataset.bind] ?? ''; });
    $$('#invoicePage [data-img]').forEach(el => {
      let src = IMG[el.dataset.img];
      if (pd && el.dataset.img === 'signature' && IMG.doSignature) src = IMG.doSignature;
      if (el.getAttribute('src') !== src) el.src = src;
    });
    $('#appCoName').textContent = CO.name;
    applyPos();
    const rowsData = f.items.filter(it => it.desc || it.price);
    const colKey = pd ? 'do' : 'money';
    if ($('#invHead').dataset.k !== colKey) {
      $('#invHead').dataset.k = colKey;
      $('#invCols').innerHTML = pd
        ? '<col style="width:6.5%"/><col style="width:71.5%"/><col style="width:10%"/><col style="width:12%"/>'
        : '<col style="width:6.5%"/><col style="width:48%"/><col style="width:8%"/><col style="width:11%"/><col style="width:14%"/><col style="width:12.5%"/>';
      $('#invHead').innerHTML = pd
        ? '<tr><th class="l">No.</th><th>Description</th><th>Qty</th><th>Unit</th></tr>'
        : '<tr><th class="l">No.</th><th>Description</th><th>Qty</th><th>Unit</th><th class="r">Price/Unit</th><th class="r">Amount</th></tr>';
    }
    $('#invRows').innerHTML = rowsData.map((it, i) => `<tr>
        <td class="no">${i + 1}</td>
        <td class="desc">${esc(it.desc)}</td>
        <td class="c">${fmtQty(it.qty)}</td>
        <td class="c">${esc(it.unit)}</td>
        ${pd ? '' : `<td class="r">${fmtMoney(it.price)}</td><td class="r amt">${fmtMoney(it.amount)}</td>`}
      </tr>`).join('');
    compactPage($('#invoicePage'));
    fitPreview();
  }

  // Muatkan dalam 1 page A4: kurangkan ruang kosong bawah jadual item bila kandungan terlebih
  const PAGE_H = 1123, ITEMS_MIN = 273, ITEMS_FLOOR = 40;
  function compactPage(page) {
    const box = $('.inv-items', page);
    box.style.minHeight = ITEMS_MIN + 'px';
    const over = page.scrollHeight - PAGE_H;
    if (over > 0) box.style.minHeight = Math.max(ITEMS_FLOOR, ITEMS_MIN - over) + 'px';
  }

  function fitPreview() {
    const wrap = $('#previewWrap'), scaler = $('#previewScaler'), page = $('#invoicePage');
    const avail = wrap.clientWidth - 28;
    if (avail <= 0) return;
    const s = Math.min(1, avail / 794);
    page.style.transform = `scale(${s})`;
    scaler.style.width = (794 * s) + 'px';
    scaler.style.height = (page.offsetHeight * s) + 'px';
    previewScale = s;
  }
  let previewScale = 1;

  // ---------- Kedudukan cop & sign ----------
  const POS_KEYS = ['stampX', 'stampY', 'stampSize', 'signX', 'signY', 'signW'];
  const SIGN_RATIO = 86 / 150;               // tinggi : lebar kotak tandatangan
  const AREA = { minX: -28, maxX: 593, minY: -25, maxY: 140 };   // had ruang (px A4)
  const num = (k) => { const v = parseFloat(CO[k]); return isNaN(v) ? Number(DEFAULT_CO[k]) : v; };
  function applyPos() {
    const st = $('#invoicePage .inv-stamp'), sg = $('#invoicePage .inv-signature');
    const ss = num('stampSize'), sw = num('signW');
    Object.assign(st.style, { left: num('stampX') + 'px', top: num('stampY') + 'px', width: ss + 'px', height: ss + 'px' });
    Object.assign(sg.style, { left: num('signX') + 'px', top: num('signY') + 'px', width: sw + 'px', height: Math.round(sw * SIGN_RATIO) + 'px' });
  }
  function clampPos(which) {
    const w = which === 'stamp' ? num('stampSize') : num('signW');
    const h = which === 'stamp' ? w : w * SIGN_RATIO;
    const kx = which === 'stamp' ? 'stampX' : 'signX', ky = which === 'stamp' ? 'stampY' : 'signY';
    CO[kx] = Math.round(Math.min(AREA.maxX - w, Math.max(AREA.minX, num(kx))));
    CO[ky] = Math.round(Math.min(AREA.maxY - h, Math.max(AREA.minY, num(ky))));
  }

  let draftT;
  function update() {
    const f = getForm();
    renderPreview(f);
    const tTxt = isDO() ? fmtQty(f.totalQty) + ' qty' : 'RM' + fmtMoney(f.total);
    $('#totalDisplay').textContent = tTxt;
    $('#mTotal').textContent = tTxt;
    $('#totalCaption').textContent = isDO() ? 'Jumlah Kuantiti' : 'Jumlah Keseluruhan';
    $('#wordsDisplay').textContent = !isDO() && f.total ? 'Ringgit Malaysia: ' + f.words : '';
    clearTimeout(draftT);
    draftT = setTimeout(() => store.set('azn_draft', { ...collectRaw(), shipSame: $('#shipSame').checked, invNoTouched, docType, source }), 400);
  }
  function collectRaw() {
    const r = {}; FIELDS.forEach(id => r[id] = $('#' + id).value);
    r.items = items; return r;
  }

  // ---------- Invoice number ----------
  function localInvNo(dateISO) {
    const [y, m] = (dateISO || todayISO()).split('-');
    const pre = isDO() ? (CO.doPrefix || 'AZN-DO') : isQ() ? (CO.qPrefix || 'AZN-Q') : CO.prefix;
    return `${pre}/${m}${y.slice(2)}-001`;
  }
  let invReq = 0;
  async function refreshInvoiceNo(force) {
    if (invNoTouched && !force) return;
    const dateISO = $('#date').value || todayISO();
    const id = ++invReq;
    if (!apiReady()) {
      $('#invoiceNo').value = localInvNo(dateISO);
      $('#invNoHint').textContent = 'Belum sambung ke database — nombor sementara';
      update(); return;
    }
    $('#invNoHint').textContent = 'Mendapatkan nombor seterusnya...';
    try {
      const r = await apiGet({ action: 'nextNo', date: toDMY(dateISO), type: docType });
      if (id !== invReq) return;
      if (r.ok) { $('#invoiceNo').value = r.invoiceNo; $('#invNoHint').textContent = 'Auto ikut bulan & tahun tarikh'; }
      else throw new Error(r.error);
    } catch (e) {
      $('#invoiceNo').value = localInvNo(dateISO);
      $('#invNoHint').textContent = 'Gagal hubungi server — nombor sementara';
    }
    if (force) invNoTouched = false;
    update();
  }

  // ---------- API ----------
  async function apiGet(params) {
    const c = conn();
    const qs = new URLSearchParams({ ...params, key: c.key }).toString();
    const res = await fetch(c.url + '?' + qs, { method: 'GET', redirect: 'follow' });
    return res.json();
  }
  async function apiPost(body) {
    const c = conn();
    const res = await fetch(c.url, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...body, key: c.key })
    });
    return res.json();
  }

  // ---------- Validation ----------
  function validate(f) {
    $$('.inp.err').forEach(x => x.classList.remove('err'));
    const errs = [];
    const mark = (id, msg) => { $('#' + id).classList.add('err'); errs.push(msg); };
    if (!f.invoiceNo) mark('invoiceNo', 'No. ' + docLabel().toLowerCase() + ' kosong');
    if (!f.date) mark('date', 'Tarikh kosong');
    if (!f.billName) mark('billName', 'Nama syarikat kosong');
    if (!f.billAddress) mark('billAddress', 'Alamat kosong');
    const valid = f.items.filter(it => it.desc && it.qty > 0);
    if (!valid.length) errs.push('Sekurang-kurangnya 1 item dengan description & qty');
    f.items.forEach((it, i) => {
      if (!it.desc && !it.price) return;
      const card = $$('.item-card')[i];
      if (!it.desc) $('[data-f="desc"]', card).classList.add('err');
      if (!(it.qty > 0)) $('[data-f="qty"]', card).classList.add('err');
    });
    if (errs.length) {
      showPane('form');
      const first = $('.inp.err'); if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(errs[0], true); return false;
    }
    return true;
  }

  // ---------- PDF ----------
  const fileName = f => `${f.invoiceNo.replace(/[\\/:*?"<>|]/g, '-')} - ${f.billName}`.slice(0, 120) + '.pdf';

  async function buildPdf(f) {
    // Clone invoice tanpa transform supaya capture tepat 1:1
    let host = $('#captureHost');
    if (!host) { host = document.createElement('div'); host.id = 'captureHost'; document.body.appendChild(host); }
    host.innerHTML = '';
    const clone = $('#invoicePage').cloneNode(true);
    clone.removeAttribute('id'); clone.classList.remove('editing');
    $$('.sel, .dragging', clone).forEach(el => el.classList.remove('sel', 'dragging'));
    clone.style.transform = 'none'; clone.style.position = 'relative'; clone.style.boxShadow = 'none';
    host.appendChild(clone);
    compactPage(clone);
    await Promise.all($$('img', clone).map(img => img.complete ? Promise.resolve() : new Promise(r => { img.onload = img.onerror = r; })));
    if (document.fonts && document.fonts.ready) await document.fonts.ready;

    // Titik selamat untuk pecah page (atas setiap row item / blok total / notes / sign)
    const baseTop = clone.getBoundingClientRect().top;
    const breaks = $$('tbody tr, .inv-total, .inv-notes, .inv-sign', clone)
      .map(el => el.getBoundingClientRect().top - baseTop);

    // Fix bug html2canvas + Tailwind preflight (img display:block buat teks dalam PDF turun ke bawah)
    const fixStyle = document.createElement('style');
    fixStyle.textContent = 'img{display:inline-block !important}';
    document.head.appendChild(fixStyle);
    const canvas = await html2canvas(clone, {
      scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, windowWidth: 794,
      // Fix bug html2canvas + Tailwind preflight (teks jadi turun ke bawah)
      onclone: doc => { const st = doc.createElement('style'); st.textContent = 'img{display:inline-block !important}'; doc.head.appendChild(st); }
    }).finally(() => fixStyle.remove());
    host.innerHTML = '';

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const pageW = 210, pageH = 297;
    const pxPerPage = Math.floor(canvas.width * pageH / pageW);   // tinggi 1 page dalam px canvas

    if (canvas.height <= pxPerPage + 4) {
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, Math.min(pageH, canvas.height * pageW / canvas.width));
    } else if (canvas.height <= pxPerPage * 1.45) {
      // Terlebih sikit → kecilkan keseluruhan supaya muat 1 page (font mengecil sedikit)
      const k = pxPerPage / canvas.height;
      const w = pageW * k, x = (pageW - w) / 2;
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', x, 0, w, pageH);
    } else {
      // Invoice panjang (banyak item) → pecah ke beberapa page tanpa potong row/sign
      const k = canvas.width / 794;                      // px canvas per px CSS
      const cuts = breaks.map(b => Math.round(b * k)).sort((x, y) => x - y);
      const topPad = Math.round(40 * k);                 // margin atas page sambungan
      let y = 0, page = 0;
      while (y < canvas.height - 2) {
        const room = pxPerPage - (page > 0 ? topPad : 0);
        let end = Math.min(canvas.height, y + room);
        if (end < canvas.height) {
          const ok = cuts.filter(c => c > y + 20 && c <= end);
          if (ok.length) end = ok[ok.length - 1];
        }
        const h = end - y;
        const part = document.createElement('canvas');
        part.width = canvas.width; part.height = pxPerPage;
        const ctx = part.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, part.width, part.height);
        ctx.drawImage(canvas, 0, y, canvas.width, h, 0, page > 0 ? topPad : 0, canvas.width, h);
        if (page > 0) pdf.addPage();
        pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, pageH);
        pdf.setFontSize(8); pdf.setTextColor(120);
        pdf.text(`${f.invoiceNo}  •  Page ${page + 1}`, pageW - 12, pageH - 8, { align: 'right' });
        y = end; page++;
      }
    }
    pdf.setProperties({ title: f.invoiceNo, subject: 'Invoice ' + f.invoiceNo, author: CO.name, creator: 'AZN Invoice' });
    return pdf;
  }

  const isMobile = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  async function saveLocal(blob, name) {
    try {
      const file = new File([blob], name, { type: 'application/pdf' });
      if (isMobile() && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function downloadOnly() {
    const f = getForm();
    if (!validate(f)) return;
    loading(true, 'Menjana PDF...');
    try {
      const pdf = await buildPdf(f);
      const blob = pdf.output('blob');
      lastPdf = { blob, name: fileName(f) };
      loading(false);
      await saveLocal(blob, lastPdf.name);
    } catch (e) {
      loading(false); console.error(e); toast('Gagal jana PDF: ' + e.message, true);
    }
  }

  async function generate() {
    const f = getForm();
    if (!validate(f)) return;
    if (!apiReady()) {
      toast('Belum sambung ke Google Sheet. Isi Web App URL dalam Tetapan.', true);
      openSettings(); return;
    }
    loading(true, 'Menjana PDF...', 'Langkah 1 / 2');
    try {
      const pdf = await buildPdf(f);
      const blob = pdf.output('blob');
      lastPdf = { blob, name: fileName(f) };
      const b64 = pdf.output('datauristring').split(',')[1];

      loading(true, 'Menyimpan ke Google Drive...', 'Langkah 2 / 2');
      const data = { ...f, date: f.dateDMY, items: f.items.filter(it => it.desc || it.price) };
      delete data.dateDMY;
      const r = await apiPost({ action: 'save', data, fileName: lastPdf.name, pdfBase64: b64 });
      loading(false);
      if (!r.ok) {
        if (r.code === 'DUPLICATE') { $('#invoiceNo').classList.add('err'); showPane('form'); }
        throw new Error(r.error || 'Ralat tidak diketahui');
      }
      lastLink = r.url;
      store.del('azn_draft');
      histCache = {};
      if (source) setSource(null);
      $('#successTitle').textContent = docLabel() + ' Berjaya Disimpan';
      $('#successText').textContent = `${f.invoiceNo} • RM${fmtMoney(f.total)} • ${f.billName}`;
      $('#successOpen').href = r.url;
      $('#successModal').classList.remove('hidden');
    } catch (e) {
      loading(false); console.error(e);
      toast('Gagal simpan: ' + e.message, true);
    }
  }

  // ---------- History ----------
  let histType = 'invoice';
  async function loadHistory(force) {
    const list = $('#histList');
    if (!apiReady()) {
      list.innerHTML = emptyState('Belum sambung ke database', 'Buka Tetapan (ikon gear) dan tampal Web App URL.');
      $('#histStats').innerHTML = ''; return;
    }
    if (histCache[histType] && !force) return renderHistory();
    const t = histType;
    list.innerHTML = `<div class="text-center text-slate-500 py-10 text-sm">Memuatkan rekod...</div>`;
    try {
      const r = await apiGet({ action: 'list', type: t });
      if (!r.ok) throw new Error(r.error);
      histCache[t] = r.rows || [];
      if (t === histType) renderHistory();
    } catch (e) {
      list.innerHTML = emptyState('Gagal muat rekod', e.message);
    }
  }
  function renderHistory() {
    const all = histCache[histType] || [];
    const q = $('#searchHist').value.trim().toLowerCase();
    const rows = all.filter(r => !q || (r.invoiceNo + ' ' + r.billName + ' ' + (r.refNo || '')).toLowerCase().includes(q));
    const now = new Date(); const mmyy = String(now.getMonth() + 1).padStart(2, '0') + '/' + now.getFullYear();
    const thisMonth = all.filter(r => (r.date || '').slice(3) === mmyy);
    const lbl = docLabel(histType);
    const isQuote = histType === 'quotation', isD = histType === 'do';
    const pending = isQuote ? all.filter(r => (r.status || '').toUpperCase() !== 'CONVERTED').length : 0;
    const stat2 = isQuote ? ['Belum jadi invoice', pending]
      : isD ? ['Jumlah kuantiti bulan ini', fmtQty(thisMonth.reduce((a, b) => a + (+b.total || 0), 0))]
      : ['Jumlah bulan ini', 'RM' + fmtMoney(thisMonth.reduce((a, b) => a + (+b.total || 0), 0))];
    $('#histStats').innerHTML = `
      <div class="stat"><div class="text-xs text-slate-500">${lbl} bulan ini</div><div class="text-xl font-bold">${thisMonth.length}</div></div>
      <div class="stat"><div class="text-xs text-slate-500">${stat2[0]}</div><div class="text-xl font-bold">${stat2[1]}</div></div>`;
    if (!rows.length) { $('#histList').innerHTML = emptyState('Tiada rekod', q ? 'Cuba carian lain.' : `${lbl} yang disimpan akan muncul di sini.`); return; }
    const B = (cls, txt) => `<span class="badge ${cls}">${esc(txt)}</span>`;
    const iconCls = isD ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : isQuote ? 'bg-orange-50 text-orange-700 border-orange-100' : 'bg-brand-50 text-brand-700 border-brand-100';
    $('#histList').innerHTML = rows.map(r => {
      const done = (r.status || '').toUpperCase() === 'CONVERTED';
      const badges = [];
      if (isQuote) badges.push(done ? B('badge-done', 'INVOICE: ' + (r.invoiceRef || '')) : B('badge-pending', 'BELUM INVOICE'));
      if (!isQuote && !isD && r.quotationRef) badges.push(B('badge-q', 'DARI ' + r.quotationRef));
      if (!isD && r.doRef) badges.push(B('badge-do', 'DO: ' + r.doRef));
      if (isD && r.refNo) badges.push(B('badge-q', 'REF: ' + r.refNo));
      const btns = [];
      if (isQuote) btns.push(`<button type="button" class="btn-outline !py-2 !px-3 text-xs" data-convert="${esc(r.invoiceNo)}">${done ? 'Buat Invoice Lagi' : 'Tukar jadi Invoice →'}</button>`);
      if (!isD) btns.push(`<button type="button" class="btn-outline !py-2 !px-3 text-xs" data-mkdo="${esc(r.invoiceNo)}" data-from="${histType}">Buat DO →</button>`);
      return `
      <div class="hist-item flex-wrap sm:flex-nowrap">
        <div class="w-10 h-10 rounded-xl ${iconCls} grid place-items-center shrink-0 border">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M7 4h7l5 5v11a1 1 0 01-1 1H7a1 1 0 01-1-1V5a1 1 0 011-1z"/><path d="M14 4v5h5"/></svg>
        </div>
        <div class="min-w-0 flex-1">
          <div class="font-semibold text-slate-900 text-sm flex items-center gap-1.5 flex-wrap">${esc(r.invoiceNo)} ${badges.join(' ')}</div>
          <div class="text-xs text-slate-500 truncate">${esc(r.billName)} • ${esc(r.date)}${isQuote && r.validity ? ' • Sah: ' + esc(r.validity) : ''}${isD && r.shipName && r.shipName !== r.billName ? ' • Hantar: ' + esc(r.shipName) : ''}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="font-semibold text-sm">${isD ? fmtQty(r.total) + ' qty' : 'RM' + fmtMoney(r.total)}</div>
          ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" class="text-xs text-brand-700 font-medium hover:underline">Buka PDF</a>` : ''}
        </div>
        ${btns.length ? `<div class="flex gap-2 w-full sm:w-auto shrink-0 [&>button]:flex-1">${btns.join('')}</div>` : ''}
      </div>`;
    }).join('');
  }

  // ---------- Tukar dokumen: Quotation → Invoice, Invoice/Quotation → DO ----------
  function setSource(src) {
    source = src && src.no ? src : null;
    $('#convertBanner').classList.toggle('hidden', !source);
    $('#convertBanner').classList.toggle('flex', !!source);
    $('#convertType').textContent = source ? docLabel(source.type) : '';
    $('#convertRef').textContent = source ? source.no : '';
  }
  async function convertDoc(fromType, no, toType) {
    if (draftHasContent() && !window.confirm(`Borang sekarang ada maklumat. Ganti dengan data ${docLabel(fromType).toLowerCase()} ${no}?`)) return;
    loading(true, 'Mengambil data ' + docLabel(fromType).toLowerCase() + '...', no);
    try {
      const r = await apiGet({ action: 'getDoc', type: fromType, no });
      loading(false);
      if (!r.ok) throw new Error(r.error);
      const d = r.doc;
      if (toType === 'invoice' && (d.status || '').toUpperCase() === 'CONVERTED' &&
          !window.confirm(`Quotation ${no} sudah ditukar jadi invoice ${d.invoiceRef}.\nBuat invoice baru lagi dari quotation ini?`)) return;
      setDocType(toType, true);
      const its = (d.items || []).map(x => ({ desc: x.desc, qty: x.qty, unit: x.unit, price: Number(x.price || 0).toFixed(2) }));
      if (toType === 'invoice') {
        fillForm({ billName: d.billName, billAddress: d.billAddress, billTel: d.billTel, attn: d.attn,
          ourRef: d.ourRef, yourRef: no, terms: d.terms, date: todayISO(), items: its });
      } else {
        // DO: Ref No = dokumen asal; PO = Your Ref asal (kalau bukan no quotation kita)
        const qp = String(CO.qPrefix || 'AZN-Q').toUpperCase() + '/';
        const po = d.yourRef && !String(d.yourRef).toUpperCase().startsWith(qp) ? d.yourRef : '';
        fillForm({ billName: d.billName, billAddress: d.billAddress, billTel: d.billTel, attn: d.attn,
          ourRef: no, yourRef: po, date: todayISO(), items: its });
      }
      setSource({ type: fromType, no });
      invNoTouched = false;
      renderItems(); update(); refreshInvoiceNo();
      showView('create'); showPane('form');
      toast(`Data ${docLabel(fromType).toLowerCase()} dimasukkan. Semak & tekan Jana PDF & Simpan.`);
    } catch (e) {
      loading(false); toast('Gagal ambil data: ' + e.message, true);
    }
  }
  function draftHasContent() {
    return !!($('#billName').value.trim() || items.some(it => (it.desc || '').trim() || it.price));
  }

  // ---------- Jenis dokumen ----------
  function setDocType(t, silent) {
    if (t === docType && !silent) return;
    docType = t;
    document.body.dataset.doc = t;
    $$('#docSeg [data-doc]').forEach(b => b.classList.toggle('active', b.dataset.doc === t));
    const L = docLabel();
    $('#docCardTitle').textContent = 'Maklumat ' + L;
    $('#noLabelForm').textContent = 'No. ' + (isDO() ? 'DO' : L);
    $('#ourRefLabel').textContent = isDO() ? 'Ref No. (Invoice / Quotation)' : 'Our Ref.';
    $('#yourRefLabel').textContent = isDO() ? 'PO No.' : 'Your Ref.';
    $('#attnLabel').textContent = isDO() ? 'Contact Person' : 'Attn';
    $('#validityWrap').classList.toggle('hidden', !isQ());
    if (isQ() && !$('#validity').value) $('#validity').value = CFG.DEFAULTS.validity || '30 DAYS';
    // Pautan sumber hanya sah untuk: quotation→invoice, invoice/quotation→DO
    if (source && !((t === 'invoice' && source.type === 'quotation') || t === 'do')) setSource(null);
    renderItems();
    if (!silent) { invNoTouched = false; refreshInvoiceNo(); }
    update();
  }

  const emptyState = (t, s) => `<div class="text-center py-14 bg-white rounded-2xl border border-dashed border-slate-300">
      <div class="font-semibold text-slate-700">${esc(t)}</div><div class="text-sm text-slate-500 mt-1">${esc(s)}</div></div>`;

  // ---------- Views & panes ----------
  let currentView = 'create', currentPane = 'form';
  const previewEl = () => $('#pane-preview');
  let previewHome = null;
  function showView(v) {
    if (currentView === 'admin' && v !== 'admin' && adminDirty()) {
      if (!window.confirm('Perubahan admin belum disimpan. Buang perubahan?')) return;
      revertAdmin();
    }
    currentView = v;
    if (v !== 'admin') adminPreviewDoc = '';
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    ['create', 'history', 'admin'].forEach(x => $('#view-' + x).classList.toggle('hidden', x !== v));
    $('#mobileBar').classList.toggle('hidden', v !== 'create');
    $('#adminBar').classList.toggle('hidden', !(v === 'admin' && adminPin));
    // Preview dikongsi antara "Invoice Baru" dan "Admin"
    if (!previewHome) previewHome = previewEl().parentNode;
    if (v === 'admin') {
      $('#adminPreviewSlot').appendChild(previewEl());
      const nb = $(`#notesSeg [data-ndoc="${docType}"]`); if (nb) nb.click();
      previewEl().classList.remove('hidden');
      if (adminPin) fillAdminForm();
    } else if (v === 'create') {
      previewHome.appendChild(previewEl());
      showPane(currentPane, true);
    }
    if (v === 'history') loadHistory();
    setEditing(v === 'admin' && !!adminPin);
    requestAnimationFrame(fitPreview);
    window.scrollTo({ top: 0 });
  }
  function showPane(p, keepScroll) {
    currentPane = p;
    if (window.innerWidth >= 1024) { $('#pane-form').classList.remove('hidden'); previewEl().classList.toggle('hidden', p !== 'preview'); return; }
    $$('.pane-btn').forEach(b => b.classList.toggle('active', b.dataset.pane === p));
    $('#pane-form').classList.toggle('hidden', p !== 'form');
    $('#pane-preview').classList.toggle('hidden', p !== 'preview');
    if (p === 'preview') requestAnimationFrame(fitPreview);
    if (!keepScroll) window.scrollTo({ top: 0 });
  }

  // ---------- Settings ----------
  function openSettings() {
    const c = conn();
    $('#setApi').value = c.url.includes('PASTE') ? '' : c.url;
    $('#setKey').value = c.key;
    $('#pingResult').textContent = '';
    $('#settingsModal').classList.remove('hidden');
  }
  async function testConn() {
    const url = $('#setApi').value.trim(), key = $('#setKey').value.trim();
    const out = $('#pingResult');
    out.className = 'text-sm mt-3 text-slate-500'; out.textContent = 'Menguji...';
    try {
      const res = await fetch(url + '?' + new URLSearchParams({ action: 'ping', key }), { redirect: 'follow' });
      const r = await res.json();
      if (r.ok) { out.className = 'text-sm mt-3 text-emerald-600 font-medium'; out.textContent = '✓ Bersambung: ' + (r.sheet || 'OK'); }
      else throw new Error(r.error);
    } catch (e) { out.className = 'text-sm mt-3 text-red-600'; out.textContent = '✗ Gagal: ' + e.message; }
  }

  function resetForm() {
    if (!confirmReset()) return;
    store.del('azn_draft');
    fillForm({ ...CFG.DEFAULTS, billName: '', billAddress: '', billTel: '', items: [] }); setSource(null);
    invNoTouched = false; renderItems(); refreshInvoiceNo(); update();
    toast('Borang dikosongkan');
  }
  const confirmReset = () => window.confirm('Kosongkan semua maklumat dalam borang?');


  // =========================================================
  //  SETTINGS SYARIKAT (disimpan dalam Google Sheet "Settings")
  // =========================================================
  const CO_KEYS = ['name', 'regNo', 'address', 'email', 'tel', 'prefix', 'bankName', 'bankAcc', 'signName', 'signTitle', 'note2', 'note3',
    'qPrefix', 'qNote1', 'qNote2', 'qNote3',
    'doPrefix', 'doNote1', 'doNote2', 'doSignName', 'doSignTitle', 'doSignTel',
    'stampX', 'stampY', 'stampSize', 'signX', 'signY', 'signW'];
  const IMG_KEYS = ['logo', 'stamp', 'signature', 'doSignature'];
  let settingsVersion = '';

  function applySettings(cache) {
    if (!cache) return;
    settingsVersion = cache.updatedAt || '';
    CO = { ...DEFAULT_CO };
    CO_KEYS.forEach(k => { if (cache.co && cache.co[k] != null && cache.co[k] !== '') CO[k] = cache.co[k]; });
    IMG = { ...DEFAULT_IMG };
    IMG_KEYS.forEach(k => { if (cache.img && cache.img[k]) IMG[k] = cache.img[k]; });
    SAVED = { co: { ...CO }, img: { ...IMG } };
  }

  async function loadSettings(force) {
    if (!apiReady()) return;
    try {
      const r = await apiGet({ action: 'settings', since: force ? '' : settingsVersion });
      if (!r.ok || r.unchanged) return;
      const cache = { updatedAt: r.updatedAt, co: r.settings || {}, img: r.images || {} };
      store.set('azn_settings', cache);
      if (currentView === 'admin' && adminDirty()) return;   // jangan ganggu admin yang sedang edit
      applySettings(cache);
      if (currentView === 'admin' && adminPin) fillAdminForm();
      if (!invNoTouched) refreshInvoiceNo();
      update();
    } catch (e) { /* offline — guna cache */ }
  }

  // ---------- Admin ----------
  let adminPin = '';
  let imgChanges = {};   // { logo: 'data:...' | 'RESET' }

  const adminDirty = () =>
    !!adminPin && (Object.keys(imgChanges).length > 0 || CO_KEYS.some(k => String(CO[k] ?? '') !== String(SAVED.co[k] ?? '')) || !!$('#newPin').value);

  function fillAdminForm() {
    $$('[data-co]').forEach(el => { el.value = CO[el.dataset.co] || ''; });
    $$('.img-tile').forEach(t => { $('img', t).src = IMG[t.dataset.key] || (t.dataset.key === 'doSignature' ? IMG.signature : ''); });
    syncPosUI();
  }

  // ---------- Drag & susun cop / sign ----------
  let posSel = 'stamp';
  function setEditing(on) {
    $('#invoicePage').classList.toggle('editing', on);
    $$('#invoicePage .inv-sign-img img').forEach(i => i.classList.toggle('sel', on && i.dataset.img === posSel));
  }
  function selectPos(which) {
    posSel = which;
    $$('#posSeg [data-sel]').forEach(b => b.classList.toggle('active', b.dataset.sel === which));
    setEditing($('#invoicePage').classList.contains('editing'));
    syncPosUI();
  }
  function syncPosUI() {
    const r = $('#posSize'); if (!r) return;
    if (posSel === 'stamp') { r.min = 50; r.max = 180; r.value = num('stampSize'); }
    else { r.min = 70; r.max = 260; r.value = num('signW'); }
    $('#sizeVal').textContent = r.value + 'px';
  }
  function movePos(which, dx, dy) {
    const kx = which === 'stamp' ? 'stampX' : 'signX', ky = which === 'stamp' ? 'stampY' : 'signY';
    CO[kx] = num(kx) + dx; CO[ky] = num(ky) + dy;
    clampPos(which); applyPos();
  }
  function initDrag() {
    const box = $('#invoicePage .inv-sign-img');
    $$('img', box).forEach(img => img.addEventListener('dragstart', e => e.preventDefault()));
    box.addEventListener('pointerdown', e => {
      if (!$('#invoicePage').classList.contains('editing')) return;
      // Item yang sedang dipilih dapat keutamaan bila cop & sign bertindih
      const selEl = $(`img[data-img="${posSel}"]`, box);
      const r = selEl.getBoundingClientRect();
      const inSel = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      const img = inSel ? selEl : (e.target.tagName === 'IMG' ? e.target : null);
      if (!img) return;
      e.preventDefault();
      const which = img.dataset.img; if (which !== posSel) selectPos(which);
      const kx = which === 'stamp' ? 'stampX' : 'signX', ky = which === 'stamp' ? 'stampY' : 'signY';
      const sx = e.clientX, sy = e.clientY, ox = num(kx), oy = num(ky);
      box.setPointerCapture(e.pointerId); img.classList.add('dragging');
      const onMove = ev => {
        CO[kx] = ox + (ev.clientX - sx) / previewScale;
        CO[ky] = oy + (ev.clientY - sy) / previewScale;
        clampPos(which); applyPos();
      };
      const onUp = () => {
        img.classList.remove('dragging');
        box.removeEventListener('pointermove', onMove);
        box.removeEventListener('pointerup', onUp); box.removeEventListener('pointercancel', onUp);
      };
      box.addEventListener('pointermove', onMove);
      box.addEventListener('pointerup', onUp); box.addEventListener('pointercancel', onUp);
    });
    $$('#posSeg [data-sel]').forEach(b => b.addEventListener('click', () => selectPos(b.dataset.sel)));
    // Butang anak panah: tekan = 1px, tekan lama = laju
    $$('#nudge [data-d]').forEach(b => {
      let t, iv;
      const [dx, dy] = b.dataset.d.split(',').map(Number);
      const stop = () => { clearTimeout(t); clearInterval(iv); };
      b.addEventListener('pointerdown', e => {
        e.preventDefault(); movePos(posSel, dx, dy);
        t = setTimeout(() => { iv = setInterval(() => movePos(posSel, dx * 3, dy * 3), 50); }, 350);
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, stop));
    });
    $('#posSize').addEventListener('input', e => {
      const v = Number(e.target.value);
      const kx = posSel === 'stamp' ? 'stampX' : 'signX', ky = posSel === 'stamp' ? 'stampY' : 'signY';
      const kS = posSel === 'stamp' ? 'stampSize' : 'signW';
      const old = num(kS), ratio = posSel === 'stamp' ? 1 : SIGN_RATIO;
      // Besar/kecil dari tengah supaya kedudukan tak lari
      CO[kx] = num(kx) - (v - old) / 2; CO[ky] = num(ky) - (v - old) * ratio / 2; CO[kS] = v;
      clampPos(posSel); applyPos();
      $('#sizeVal').textContent = v + 'px';
    });
    $('#btnPosReset').addEventListener('click', () => {
      POS_KEYS.forEach(k => CO[k] = DEFAULT_CO[k]); applyPos(); syncPosUI();
    });
    // Anak panah keyboard (desktop)
    document.addEventListener('keydown', e => {
      if (!$('#invoicePage').classList.contains('editing')) return;
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
      const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!map[e.key]) return;
      e.preventDefault(); const m = e.shiftKey ? 10 : 1;
      movePos(posSel, map[e.key][0] * m, map[e.key][1] * m);
    });
  }
  function revertAdmin() {
    CO = { ...SAVED.co }; IMG = { ...SAVED.img }; imgChanges = {};
    $('#newPin').value = '';
    fillAdminForm(); update();
  }
  function lockAdmin() {
    if (adminDirty() && !window.confirm('Perubahan belum disimpan. Buang dan kunci?')) return;
    revertAdmin(); adminPin = '';
    $('#adminPanel').classList.add('hidden'); $('#adminLock').classList.remove('hidden');
    $('#adminBar').classList.add('hidden'); $('#adminPin').value = '';
    setEditing(false);
  }

  async function unlockAdmin() {
    const pin = $('#adminPin').value.trim();
    const msg = $('#adminLockMsg');
    if (!pin) { msg.className = 'text-sm mt-2 text-red-600'; msg.textContent = 'Sila masukkan PIN'; return; }
    if (!apiReady()) {
      msg.className = 'text-sm mt-2 text-red-600';
      msg.textContent = 'Belum sambung ke database. Isi Web App URL dulu (ikon gear).';
      return;
    }
    msg.className = 'text-sm mt-2 text-slate-500'; msg.textContent = 'Menyemak...';
    $('#btnUnlock').disabled = true;
    try {
      const r = await apiPost({ action: 'verifyPin', pin });
      if (!r.ok) throw new Error(r.error || 'PIN salah');
      adminPin = pin; msg.textContent = '';
      $('#adminLock').classList.add('hidden'); $('#adminPanel').classList.remove('hidden');
      $('#adminBar').classList.remove('hidden');
      fillAdminForm(); setEditing(true); requestAnimationFrame(fitPreview);
    } catch (e) {
      msg.className = 'text-sm mt-2 text-red-600'; msg.textContent = e.message;
    } finally { $('#btnUnlock').disabled = false; }
  }

  // Proses gambar: resize + (pilihan) buang background putih → PNG data URI
  function processImage(file, removeBg, kind) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('Gagal baca fail'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Format gambar tidak disokong'));
        img.onload = () => {
          const MAX = 700;
          const sc = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.round(img.width * sc), h = Math.round(img.height * sc);
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          if (removeBg) {
            const d = ctx.getImageData(0, 0, w, h), px = d.data;
            for (let i = 0; i < px.length; i += 4) {
              const r = px[i], g = px[i + 1], b = px[i + 2];
              let a;
              if (kind === 'logo') a = Math.min(255, (255 - Math.min(r, g, b)) * 3);           // logo berwarna
              else a = Math.min(255, Math.max(0, (255 - (0.299 * r + 0.587 * g + 0.114 * b) - 20) * 1.5)); // dakwat
              px[i + 3] = Math.min(px[i + 3], a);
            }
            ctx.putImageData(d, 0, 0);
          }
          // Crop ruang kosong keliling
          const out = trimCanvas(c);
          resolve(out.toDataURL('image/png'));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function trimCanvas(c) {
    const ctx = c.getContext('2d'); const { width: w, height: h } = c;
    const px = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ink = px[i + 3] > 20 && !(px[i] > 245 && px[i + 1] > 245 && px[i + 2] > 245);
      if (ink) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return c;
    const pad = 6; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    const o = document.createElement('canvas'); o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
    o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    return o;
  }

  async function saveAdmin() {
    const newPin = $('#newPin').value.trim();
    if (newPin && !/^\d{4,8}$/.test(newPin)) { toast('PIN baru mesti 4–8 digit nombor', true); return; }
    if (!CO.name.trim()) { toast('Nama syarikat tak boleh kosong', true); return; }
    if (!adminDirty()) { toast('Tiada perubahan'); return; }
    loading(true, 'Menyimpan tetapan...', 'Memuat naik gambar ke Google Drive');
    try {
      const settings = {}; CO_KEYS.forEach(k => settings[k] = String(CO[k] ?? '').trim());
      ['name', 'regNo', 'prefix', 'qPrefix', 'doPrefix', 'address', 'bankName', 'signName', 'signTitle', 'doSignName', 'doSignTitle'].forEach(k => settings[k] = settings[k].toUpperCase());
      const images = {};
      Object.entries(imgChanges).forEach(([k, v]) => { images[k] = v === 'RESET' ? 'RESET' : v.split(',')[1]; });
      const r = await apiPost({ action: 'saveSettings', pin: adminPin, settings, images, newPin });
      loading(false);
      if (!r.ok) throw new Error(r.error);
      if (newPin) adminPin = newPin;
      CO = { ...DEFAULT_CO, ...Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== '')) };
      const img = {}; IMG_KEYS.forEach(k => { if (IMG[k] && IMG[k].startsWith('data:')) img[k] = IMG[k]; });
      store.set('azn_settings', { updatedAt: r.updatedAt, co: settings, img });
      applySettings(store.get('azn_settings', null) || { updatedAt: r.updatedAt, co: settings, img });
      imgChanges = {}; $('#newPin').value = '';
      fillAdminForm(); update();
      if (!invNoTouched) refreshInvoiceNo();
      toast('Tetapan berjaya disimpan');
    } catch (e) {
      loading(false); toast('Gagal simpan: ' + e.message, true);
    }
  }

  function initAdmin() {
    initDrag();
    $$('#notesSeg [data-ndoc]').forEach(b => b.addEventListener('click', () => {
      adminPreviewDoc = b.dataset.ndoc;
      $$('#notesSeg [data-ndoc]').forEach(x => x.classList.toggle('active', x === b));
      $('#notesInv').classList.toggle('hidden', adminPreviewDoc !== 'invoice');
      $('#notesQ').classList.toggle('hidden', adminPreviewDoc !== 'quotation');
      $('#notesDO').classList.toggle('hidden', adminPreviewDoc !== 'do');
      update();
    }));
    $('#btnUnlock').addEventListener('click', unlockAdmin);
    $('#adminPin').addEventListener('keydown', e => { if (e.key === 'Enter') unlockAdmin(); });
    $('#btnLock').addEventListener('click', lockAdmin);
    $$('[data-co]').forEach(el => el.addEventListener('input', () => { CO[el.dataset.co] = el.value; update(); }));
    $$('.img-tile').forEach(tile => {
      const key = tile.dataset.key;
      $('[data-file]', tile).addEventListener('change', async e => {
        const f = e.target.files[0]; e.target.value = '';
        if (!f) return;
        if (f.size > 15 * 1024 * 1024) { toast('Gambar terlalu besar (max 15MB)', true); return; }
        try {
          const uri = await processImage(f, $('[data-bg]', tile).checked, key);
          IMG[key] = uri; imgChanges[key] = uri;
          $('img', tile).src = uri; update();
        } catch (err) { toast(err.message, true); }
      });
      $('[data-reset]', tile).addEventListener('click', () => {
        IMG[key] = DEFAULT_IMG[key];
        if (SAVED.img[key] === DEFAULT_IMG[key]) delete imgChanges[key]; else imgChanges[key] = 'RESET';
        $('img', tile).src = IMG[key] || IMG.signature; update();
      });
    });
    ['#btnAdminSave', '#mAdminSave'].forEach(id => $(id).addEventListener('click', saveAdmin));
    ['#btnAdminCancel', '#mAdminCancel'].forEach(id => $(id).addEventListener('click', () => { revertAdmin(); toast('Perubahan dibatalkan'); }));
  }

  // ---------- Init ----------
  function init() {
    const draft = store.get('azn_draft', null);
    if (draft && draft.items) {
      fillForm({ ...draft, invoiceNo: draft.invoiceNo });
      invNoTouched = !!draft.invNoTouched;
    } else {
      fillForm(CFG.DEFAULTS);
    }
    applySettings(store.get('azn_settings', null));
    setDocType('invoice', true);
    const dt = draft && ['invoice', 'quotation', 'do'].includes(draft.docType) ? draft.docType : 'invoice';
    if (dt !== docType) setDocType(dt, true);
    if (draft && draft.source) setSource(draft.source);
    renderItems(); update();
    refreshInvoiceNo();
    loadSettings();
    initAdmin();

    // Field events
    FIELDS.forEach(id => $('#' + id).addEventListener('input', e => { e.target.classList.remove('err'); update(); }));
    $('#invoiceNo').addEventListener('input', () => { invNoTouched = true; });
    $('#date').addEventListener('change', () => refreshInvoiceNo());
    $('#btnRegen').addEventListener('click', () => refreshInvoiceNo(true));

    $('#itemList').addEventListener('input', e => { e.target.classList.remove('err'); onItemInput(e); });
    $('#itemList').addEventListener('click', onItemClick);
    $('#itemList').addEventListener('focusout', e => {
      if (e.target.dataset.f === 'price' && e.target.value !== '') {
        const n = parseNum(e.target.value); e.target.value = n.toFixed(2);
        items[+e.target.closest('.item-card').dataset.i].price = e.target.value;
      }
    });
    $('#btnAddItem').addEventListener('click', addItem);

    // Invoice / Quotation
    $$('#docSeg [data-doc]').forEach(b => b.addEventListener('click', () => {
      const t = b.dataset.doc;
      if (source && !((t === 'invoice' && source.type === 'quotation') || t === 'do') &&
          !window.confirm(`Dokumen ini dipautkan ke ${docLabel(source.type)} ${source.no}. Tukar & buang pautan?`)) return;
      setDocType(b.dataset.doc);
    }));
    $('#convertClear').addEventListener('click', () => { setSource(null); update(); });
    $('#shipSame').addEventListener('change', e => { setShipSame(e.target.checked); update(); });
    $$('#histSeg [data-hist]').forEach(b => b.addEventListener('click', () => {
      histType = b.dataset.hist;
      $$('#histSeg [data-hist]').forEach(x => x.classList.toggle('active', x === b));
      loadHistory();
    }));
    $('#histList').addEventListener('click', e => {
      const b = e.target.closest('[data-convert]'); if (b) return convertDoc('quotation', b.dataset.convert, 'invoice');
      const d = e.target.closest('[data-mkdo]'); if (d) return convertDoc(d.dataset.from, d.dataset.mkdo, 'do');
    });

    // Actions
    $('#btnGenerate').addEventListener('click', generate);
    $('#mGenerate').addEventListener('click', generate);
    $('#btnDownload').addEventListener('click', downloadOnly);
    $('#mDownload').addEventListener('click', downloadOnly);
    $('#btnReset').addEventListener('click', resetForm);

    // Nav
    $$('.nav-btn').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));
    $$('.pane-btn').forEach(b => b.addEventListener('click', () => showPane(b.dataset.pane)));
    $('#searchHist').addEventListener('input', renderHistory);
    $('#btnRefresh').addEventListener('click', () => loadHistory(true));

    // Success modal
    $('#successDownload').addEventListener('click', () => lastPdf && saveLocal(lastPdf.blob, lastPdf.name));
    $('#successShare').addEventListener('click', async () => {
      try {
        if (navigator.share) await navigator.share({ title: docLabel(), url: lastLink });
        else { await navigator.clipboard.writeText(lastLink); toast('Link disalin'); }
      } catch (e) {}
    });
    $('#successNew').addEventListener('click', () => {
      $('#successModal').classList.add('hidden');
      fillForm(CFG.DEFAULTS); setSource(null);
      invNoTouched = false; renderItems(); update(); refreshInvoiceNo(); showPane('form');
    });

    // Settings
    $('#btnSettings').addEventListener('click', openSettings);
    $('#setClose').addEventListener('click', () => $('#settingsModal').classList.add('hidden'));
    $('#setTest').addEventListener('click', testConn);
    $('#setSave').addEventListener('click', () => {
      store.set('azn_conn', { url: $('#setApi').value.trim(), key: $('#setKey').value.trim() });
      $('#settingsModal').classList.add('hidden');
      toast('Tetapan disimpan'); histCache = {}; refreshInvoiceNo(true); loadSettings(true);
    });

    // Resize preview
    if (window.ResizeObserver) new ResizeObserver(fitPreview).observe($('#previewWrap'));
    window.addEventListener('resize', () => { if (currentView === 'create') showPane(currentPane, true); });
    if (document.fonts) document.fonts.ready.then(fitPreview);

    // Service worker
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
  window.__azn = { amountToWords, getForm, buildPdf }; // untuk debug/test
})();
