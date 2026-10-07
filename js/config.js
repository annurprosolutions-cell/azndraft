/* =========================================================
   CONFIG — SATU-SATUNYA FAIL YANG PERLU DIUBAH
   ========================================================= */
window.APP_CONFIG = {
  // 1) Tampal URL Web App Apps Script di sini (berakhir dengan /exec)
  API_URL: 'https://script.google.com/macros/s/AKfycbza8vxNArTdqKkhtWIeiuLmh8irctuQzfA60yrkrwk_QfS6CJFq6OS8-NdBdp4j_iaS/exec',

  // 2) Mesti SAMA dengan API_KEY dalam Code.gs
  API_KEY: 'AZN-2026-INVOICE',

  // Maklumat syarikat DEFAULT (pengirim invoice).
  // Lepas setup, tukar semua ni melalui tab "Admin" dalam app — tak perlu edit fail.
  COMPANY: {
    name: 'AZN POWER SOLUTION',
    regNo: 'LA0050194-P',
    address: 'NO 32 LORONG 12 TAMAN HALAMAN INDAH 14200 SUNGAI JAWI',
    email: 'aznpowersolution@gmail.com',
    tel: '019-5135033',
    prefix: 'AZN',            // Format no invoice: AZN/MMYY-001
    bankName: 'MAYBANK',
    bankAcc: '557102161049',
    signName: 'SITI FATIMAH BINTI JAMAL',
    signTitle: 'MANAGING DIRECTOR',
    note2: 'Goods sold are warranty within 3 days.',
    note3: 'There is NO MONEY BACK GUARANTEE.',
    // Quotation
    qPrefix: 'AZN-Q',         // Format no quotation: AZN-Q/MMYY-001
    qNote1: 'Payment terms: 50% deposit upon confirmation, balance upon completion.',
    qNote2: 'Delivery / completion: 2 - 3 weeks upon confirmation of order.',
    qNote3: 'Prices are subject to change after the validity period.',
    // Delivery Order
    doPrefix: 'AZN-DO',       // Format no DO: AZN-DO/MMYY-001
    doNote1: 'Please check all goods upon delivery. Any discrepancy must be reported within 24 hours.',
    doNote2: 'Goods received in good order and condition.',
    doSignName: '', doSignTitle: '', doSignTel: '',   // kosong = guna penandatangan utama
    // Kedudukan & saiz cop / tandatangan (px, dalam ruang tandatangan). Boleh drag dalam tab Admin.
    stampX: 36, stampY: 20, stampSize: 106,
    signX: 24, signY: 28, signW: 150
  },

  // Gambar default (fail dalam folder assets/)
  IMAGES: {
    logo: 'assets/logo.png',
    stamp: 'assets/stamp.png',
    signature: 'assets/signature.png',
    doSignature: ''           // kosong = guna tandatangan utama
  },

  // Nilai default borang — kosong (pengguna isi sendiri)
  DEFAULTS: {
    billName: '',
    billAddress: '',
    billTel: '',
    attn: '',
    ourRef: '',
    yourRef: '',
    terms: '',
    validity: '30 DAYS',      // default tempoh sah quotation
    items: [{ desc: '', qty: 1, unit: 'UNIT', price: '' }]
  },

  UNITS: ['UNIT', 'LOT', 'PCS', 'SET', 'JOB', 'DAY', 'HOUR', 'TRIP', 'METER', 'NOS']
};
