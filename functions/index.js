/**
 * Cloud Functions — acacia-sppn
 * generateReport : สร้าง PDF รายงานการติดตั้งครุภัณฑ์ (1 asset)
 * generateDailyZip : รวม PDF ทั้งหมดของวันนี้เป็น ZIP
 */

const { onRequest } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage }   = require('firebase-admin/storage');
const { initializeApp } = require('firebase-admin/app');
const chromium         = require('@sparticuz/chromium');
const puppeteer        = require('puppeteer-core');
const archiver         = require('archiver');

initializeApp();
const db      = getFirestore();
const storage = getStorage();

// CORS helper
function setCors(res, req) {
  const origin = req.headers.origin || '';
  res.set('Access-Control-Allow-Origin', origin || '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

const TEMPLATE_LABELS = {
  PC1: 'PC แบบที่ 1 + UPS 800VA',
  PC2: 'PC แบบที่ 2 + UPS 800VA',
  Notebook: 'Notebook',
  Tablet: 'Tablet (iPad)',
  UPS2k: 'UPS 2kVA',
};

const PHOTO_LABELS = {
  install: 'เครื่องเปิดพร้อมใช้งาน',
  msOffice: 'MS Office / iPadOS',
  snPc: 'S/N เครื่อง',
  stickerPc: 'Sticker เครื่อง',
  snMonitor: 'S/N จอภาพ',
  stickerMonitor: 'Sticker จอภาพ',
  snUps: 'S/N UPS',
  stickerUps: 'Sticker UPS',
  plug: 'ปลั๊ก ELECTON',
};

const TEMPLATE_PHOTOS = {
  PC1:      [['install','msOffice','snPc','stickerPc'],['snMonitor','stickerMonitor','snUps','stickerUps']],
  PC2:      [['install','msOffice','snPc','stickerPc'],['snMonitor','stickerMonitor']],
  Notebook: [['install','msOffice','snPc','stickerPc']],
  Tablet:   [['install','msOffice','snPc','stickerPc']],
  UPS2k:    [['snUps','stickerUps','plug']],
};

function formatDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('th-TH', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function buildHtml(doc) {
  const tKey = doc.deviceType || 'PC1';
  const pages = TEMPLATE_PHOTOS[tKey] || TEMPLATE_PHOTOS['PC1'];
  const location = doc.location || {};
  const sn = doc.serialNumbers || {};
  const installer = doc.installer || {};
  const siteName = location.region === 'central'
    ? (location.office || location.siteName || 'ส่วนกลาง')
    : (location.province || location.siteName || '');

  const snRows = Object.entries(sn)
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td>${k.toUpperCase()}</td><td>${v}</td></tr>`)
    .join('');

  let pagesHtml = '';
  pages.forEach((slots, pi) => {
    const photoGrid = slots.map(key => {
      const url = (doc.photos || {})[key] || '';
      const label = PHOTO_LABELS[key] || key;
      return `<div class="photo-slot">${url ? `<img src="${url}" alt="${label}" />` : `<div class="photo-empty">ไม่มีภาพ</div>`}<div class="photo-label">${label}</div></div>`;
    }).join('');

    pagesHtml += `
      <div class="page">
        <div class="header">
          <div class="header-left">
            <div class="project-title">รายงานการติดตั้งครุภัณฑ์</div>
            <div class="project-sub">สำนักงานปลัดกระทรวงพลังงาน (สป.พน.) ปีงบประมาณ 2569</div>
          </div>
          <div class="header-right">
            <div class="asset-id">${doc.assetId}</div>
            <div class="asset-type">${TEMPLATE_LABELS[tKey] || tKey}</div>
          </div>
        </div>
        <table class="info-table">
          <tr><td class="label">หน่วยงาน / จังหวัด</td><td>${siteName}</td><td class="label">เลขกล่อง</td><td>${doc.boxNumber || '-'}</td></tr>
          <tr><td class="label">ที่อยู่</td><td colspan="3">${location.address || '-'}</td></tr>
          <tr><td class="label">ช่างติดตั้ง</td><td>${installer.name || '-'}</td><td class="label">วันที่ติดตั้ง</td><td>${formatDate(doc.completedAt)}</td></tr>
          ${snRows ? `<tr><td class="label">Serial Numbers</td><td colspan="3"><table class="sn-table">${snRows}</table></td></tr>` : ''}
        </table>
        <div class="page-label">หน้า ${pi + 1} / ${pages.length}</div>
        <div class="photo-grid grid-${slots.length}">${photoGrid}</div>
        <div class="footer"><div>สัญญาเลขที่ 20/69 | Acacia Intertech Co., Ltd.</div><div>${doc.assetId} — หน้า ${pi + 1}/${pages.length}</div></div>
      </div>`;
  });

  return `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"/>
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Sarabun',sans-serif;font-size:13px;background:#fff;color:#1a1a1a}
.page{width:210mm;min-height:297mm;padding:12mm 14mm 10mm;page-break-after:always;display:flex;flex-direction:column;gap:8px}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #1B4F8A;padding-bottom:8px}
.project-title{font-size:16px;font-weight:700;color:#1B4F8A}
.project-sub{font-size:11px;color:#555;margin-top:2px}
.asset-id{font-size:20px;font-weight:700;color:#1B4F8A;text-align:right}
.asset-type{font-size:11px;color:#555;text-align:right}
.info-table{width:100%;border-collapse:collapse;font-size:12px}
.info-table td{padding:4px 6px;border:1px solid #ddd;vertical-align:top}
.info-table td.label{background:#EBF2FB;font-weight:600;width:110px;color:#1B4F8A;white-space:nowrap}
.sn-table{border-collapse:collapse}
.sn-table td{padding:1px 8px 1px 0;border:none}
.sn-table td:first-child{font-weight:600;min-width:50px}
.page-label{font-size:11px;font-weight:600;color:#888;text-align:center}
.photo-grid{flex:1;display:grid;gap:8px}
.grid-4{grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}
.grid-2{grid-template-columns:1fr 1fr;grid-template-rows:1fr}
.grid-1{grid-template-columns:1fr;grid-template-rows:1fr}
.photo-slot{border:1px solid #ddd;border-radius:6px;overflow:hidden;display:flex;flex-direction:column;background:#f9f9f9}
.photo-slot img{flex:1;width:100%;object-fit:cover;display:block}
.photo-empty{flex:1;display:flex;align-items:center;justify-content:center;color:#bbb;font-size:11px}
.photo-label{background:#1B4F8A;color:#fff;font-size:10px;font-weight:600;padding:3px 8px;text-align:center}
.footer{border-top:1px solid #ddd;padding-top:5px;display:flex;justify-content:space-between;font-size:10px;color:#888}
</style></head><body>${pagesHtml}</body></html>`;
}

// ============================================================
// FUNCTION 1: generateReport (onRequest + CORS)
// ============================================================
exports.generateReport = onRequest(
  { region: 'asia-southeast1', memory: '1GiB', timeoutSeconds: 120 },
  async (req, res) => {
    setCors(res, req);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    try {
      const body = req.body;
      const assetId = body?.data?.assetId || body?.assetId;
      if (!assetId) { res.status(400).json({ error: 'assetId is required' }); return; }

      const snap = await db.collection('installations').doc(assetId).get();
      if (!snap.exists) { res.status(404).json({ error: `Asset ${assetId} not found` }); return; }
      const data = snap.data();

      const html = buildHtml(data);

      const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath("/tmp/chromium"),
        headless: chromium.headless,
      });

      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
        const pdfBuffer = await page.pdf({
          format: 'A4', printBackground: true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
        });

        const bucket = storage.bucket();
        const filePath = `reports/${assetId}/report.pdf`;
        const file = bucket.file(filePath);
        await file.save(pdfBuffer, { contentType: 'application/pdf' });

        const [url] = await file.getSignedUrl({
          action: 'read',
          expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });

        res.status(200).json({ success: true, url, assetId });
      } finally {
        await browser.close();
      }
    } catch (err) {
      console.error('generateReport error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ============================================================
// FUNCTION 2: generateDailyZip (onRequest + CORS)
// ============================================================
exports.generateDailyZip = onRequest(
  { region: 'asia-southeast1', memory: '2GiB', timeoutSeconds: 300 },
  async (req, res) => {
    setCors(res, req);
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    try {
      const dateStr = req.body?.date || new Date().toISOString().slice(0, 10);
      const startOf = new Date(dateStr + 'T00:00:00+07:00');
      const endOf   = new Date(dateStr + 'T23:59:59+07:00');

      const snap = await db.collection('installations')
        .where('status', '==', 'completed')
        .where('completedAt', '>=', startOf)
        .where('completedAt', '<=', endOf)
        .get();

      if (snap.empty) { res.status(404).json({ error: 'ไม่มีรายการที่ติดตั้งในวันนี้' }); return; }

      const bucket = storage.bucket();
      const zipPath = `reports/daily/${dateStr}.zip`;
      const zipFile = bucket.file(zipPath);
      const zipStream = zipFile.createWriteStream({ contentType: 'application/zip' });
      const archive = archiver('zip', { zlib: { level: 6 } });
      archive.pipe(zipStream);

      const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath("/tmp/chromium"),
        headless: chromium.headless,
      });

      try {
        const page = await browser.newPage();
        for (const doc of snap.docs) {
          const data = doc.data();
          const html = buildHtml(data);
          await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
          const pdfBuffer = await page.pdf({
            format: 'A4', printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
          });
          archive.append(pdfBuffer, { name: `${data.assetId}/report.pdf` });
        }
        archive.finalize();
        await new Promise((resolve, reject) => {
          zipStream.on('finish', resolve);
          zipStream.on('error', reject);
        });
      } finally {
        await browser.close();
      }

      const [url] = await zipFile.getSignedUrl({
        action: 'read',
        expires: Date.now() + 24 * 60 * 60 * 1000,
      });

      res.status(200).json({ success: true, url, count: snap.size, date: dateStr });
    } catch (err) {
      console.error('generateDailyZip error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);
// Mon Jun 15 16:32:44 +07 2026
