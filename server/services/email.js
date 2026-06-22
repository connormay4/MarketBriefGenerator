const { Resend } = require('resend');

// `marked` is an ESM-only package. require()-ing it crashes Vercel's CommonJS
// function runtime (ERR_REQUIRE_ESM) — which took down the whole API. Load it
// lazily via dynamic import(), which works from CommonJS on every Node version.
let _markedPromise;
function getMarked() {
  if (!_markedPromise) _markedPromise = import('marked').then(m => m.marked);
  return _markedPromise;
}

// ─── Brand tokens (email-safe; inline styles only) ────────────────────────────
const C = {
  red: '#E4002B',        // Chick-fil-A red
  redDark: '#A30021',
  ink: '#1c1917',
  body: '#44403c',
  muted: '#78716c',
  line: '#e7e5e4',
  bg: '#faf9f7',
  card: '#ffffff',
  good: '#15803d',
  goodBg: '#dcfce7',
  warn: '#b45309',
  warnBg: '#fef3c7',
  gray: '#57534e',
  grayBg: '#f5f5f4',
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function confBadge(confidence, stale) {
  const map = {
    high: [C.good, C.goodBg, 'verified'],
    medium: [C.warn, C.warnBg, 'check'],
    low: [C.gray, C.grayBg, 'low conf.'],
    none: [C.gray, C.grayBg, 'not set'],
    unset: [C.gray, C.grayBg, 'not set'],
  };
  const [fg, bg, label] = map[confidence] || map.unset;
  const text = stale ? 'stale' : label;
  return `<span style="font:600 11px ${FONT};color:${fg};background:${bg};padding:2px 7px;border-radius:10px;white-space:nowrap;">${esc(text)}</span>`;
}

// Horizontal bar (email-safe: nested table, no SVG). pct 0..100. The bar gets
// its OWN full-width cell — never put a nowrap sibling beside the track or
// auto-layout collapses it.
function bar(pct, color) {
  const w = Math.max(3, Math.min(100, Math.round(pct)));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr>
    <td style="background:${C.grayBg};border-radius:5px;padding:0;font-size:0;line-height:0;">
      <table role="presentation" width="${w}%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;min-width:6px;"><tr>
        <td style="background:${color};border-radius:5px;height:10px;font-size:1px;line-height:1px;">&#8203;</td>
      </tr></table>
    </td>
  </tr></table>`;
}

function sectionTitle(kicker, title) {
  return `<tr><td style="padding:26px 28px 4px 28px;">
    <div style="font:700 11px ${FONT};letter-spacing:1.5px;text-transform:uppercase;color:${C.red};">${esc(kicker)}</div>
    <div style="font:700 19px ${FONT};color:${C.ink};margin-top:3px;">${esc(title)}</div>
  </td></tr>`;
}

// ─── Section renderers (each returns a <tr>… or '' if no data) ────────────────

function renderRankingHighlight(rankings) {
  if (!rankings || !Array.isArray(rankings.categories) || !rankings.categories.length) return '';
  const total = rankings.totalStores || 25;
  const rows = rankings.categories.map(cat => {
    const rank = cat.rank;
    const ranked = cat.rankedOf || total;
    const insufficient = rank == null;
    const pct = insufficient ? 0 : 100 * (1 - (rank - 1) / Math.max(1, ranked - 1));
    const color = insufficient ? C.gray : (rank <= 3 ? C.good : rank <= Math.ceil(ranked / 2) ? C.warn : C.muted);
    const rankLabel = insufficient ? 'n/a' : `#${rank} of ${ranked}`;
    return `<tr>
      <td style="padding:8px 10px 8px 0;font:600 13px ${FONT};color:${C.ink};width:38%;vertical-align:middle;">${esc(cat.label)}${cat.n != null ? `<span style="font:400 11px ${FONT};color:${C.muted};"> · ${cat.n} reviews</span>` : ''}</td>
      <td style="padding:8px 12px;width:44%;vertical-align:middle;">${bar(pct, color)}</td>
      <td style="padding:8px 0;width:18%;text-align:right;vertical-align:middle;font:700 13px ${FONT};color:${insufficient ? C.muted : C.ink};white-space:nowrap;">${esc(rankLabel)}</td>
    </tr>`;
  }).join('');
  return `${sectionTitle('You vs nearby Chick-fil-As', `Ranked against ${total - 1} closest CFAs`)}
    <tr><td style="padding:8px 28px 4px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
      ${rankings.note ? `<div style="font:400 12px ${FONT};color:${C.muted};margin-top:8px;">${esc(rankings.note)}</div>` : ''}
    </td></tr>`;
}

function renderOwnStore(own) {
  if (!own || !own.available) return '';
  const s = own.store, h = own.highlight || {};
  const praise = h.notablePraise;
  const concern = h.notableConcern;
  return `${sectionTitle('Your store this week', `${esc(s.name)} — ${s.rating}★`)}
    <tr><td style="padding:8px 28px 4px 28px;">
      <div style="font:400 13px ${FONT};color:${C.body};">${esc(s.reviewCount)} total Google reviews.${h.headline ? ' ' + esc(h.headline) : ''}</div>
      ${praise ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:12px;"><tr>
        <td style="border-left:3px solid ${C.good};background:${C.goodBg};padding:10px 14px;border-radius:0 6px 6px 0;">
          <div style="font:600 11px ${FONT};color:${C.good};text-transform:uppercase;letter-spacing:.5px;">Notable praise</div>
          <div style="font:400 13px ${FONT};color:${C.ink};margin-top:3px;font-style:italic;">“${esc(praise.quote)}”</div>
          <div style="font:400 11px ${FONT};color:${C.muted};margin-top:3px;">— ${esc(praise.author || 'Guest')}${praise.when ? ', ' + esc(praise.when) : ''}</div>
        </td></tr></table>` : ''}
      ${concern ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px;"><tr>
        <td style="border-left:3px solid ${C.warn};background:${C.warnBg};padding:10px 14px;border-radius:0 6px 6px 0;">
          <div style="font:600 11px ${FONT};color:${C.warn};text-transform:uppercase;letter-spacing:.5px;">Worth a look</div>
          <div style="font:400 13px ${FONT};color:${C.ink};margin-top:3px;font-style:italic;">“${esc(concern.quote)}”</div>
          <div style="font:400 11px ${FONT};color:${C.muted};margin-top:3px;">— ${esc(concern.author || 'Guest')}${concern.when ? ', ' + esc(concern.when) : ''}</div>
        </td></tr></table>` : ''}
      ${h.prompt ? `<div style="margin-top:12px;padding:12px 14px;background:${C.grayBg};border-radius:6px;font:400 13px ${FONT};color:${C.ink};"><strong style="color:${C.red};">This week:</strong> ${esc(h.prompt)}</div>` : ''}
    </td></tr>`;
}

function renderPricing(prices) {
  if (!prices || !prices.length) return '';
  const rows = prices.map(p => `<tr>
    <td style="padding:9px 0;border-bottom:1px solid ${C.line};font:600 13px ${FONT};color:${C.ink};">${esc(p.competitor)}<div style="font:400 11px ${FONT};color:${C.muted};">${esc(p.itemLabel)}</div></td>
    <td style="padding:9px 0;border-bottom:1px solid ${C.line};font:700 15px ${FONT};color:${C.ink};text-align:right;white-space:nowrap;">${p.priceDisplay || '<span style="color:#a8a29e;font-weight:400;font-size:13px;">— not set —</span>'}</td>
    <td style="padding:9px 0 9px 12px;border-bottom:1px solid ${C.line};text-align:right;white-space:nowrap;">${confBadge(p.confidence, p.stale)}${p.lastVerified ? `<div style="font:400 10px ${FONT};color:${C.muted};margin-top:2px;">${esc(p.lastVerified)}</div>` : ''}</td>
  </tr>`).join('');
  return `${sectionTitle('Local pricing', 'Competitor signature item — in Hanover')}
    <tr><td style="padding:8px 28px 4px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
      <div style="font:400 11px ${FONT};color:${C.muted};margin-top:8px;">Operator-verified prices are the source of truth; badges show confidence and last-verified date. “Not set” = needs your input in Settings.</div>
    </td></tr>`;
}

function renderBreakfast(breakfast) {
  const ideas = breakfast?.ideas;
  if (!ideas || !ideas.length) return '';
  const cards = ideas.map(i => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:10px;"><tr>
    <td style="border:1px solid ${C.line};border-radius:8px;padding:14px 16px;">
      <div style="font:700 14px ${FONT};color:${C.ink};">${esc(i.title)}</div>
      <div style="font:400 13px ${FONT};color:${C.body};margin-top:5px;">${esc(i.how)}</div>
      <div style="margin-top:8px;">
        ${i.reward && i.reward !== 'none' ? `<span style="font:600 11px ${FONT};color:${C.red};background:#fdecef;padding:3px 8px;border-radius:10px;">🎁 ${esc(i.reward)}</span> ` : ''}
        ${i.effort ? `<span style="font:600 11px ${FONT};color:${C.gray};background:${C.grayBg};padding:3px 8px;border-radius:10px;">${esc(i.effort)} effort</span>` : ''}
      </div>
      ${i.metric ? `<div style="font:400 11px ${FONT};color:${C.muted};margin-top:7px;">📈 Watch: ${esc(i.metric)}</div>` : ''}
    </td></tr></table>`).join('');
  return `${sectionTitle('Breakfast hub', 'Ways to grow the morning daypart this week')}
    <tr><td style="padding:4px 28px 4px 28px;">${cards}</td></tr>`;
}

async function renderMarkdownCore(markdown) {
  if (!markdown) return '';
  const marked = await getMarked();
  // Strip the "## SECTION N —" prefixes for cleaner email headings.
  const cleaned = markdown.replace(/^##\s*SECTION\s*\d+\s*[—-]\s*/gim, '## ');
  const html = marked.parse(cleaned);
  // Wrap with email-safe typographic styles.
  const styled = html
    .replace(/<h2>/g, `<h2 style="font:700 17px ${FONT};color:${C.ink};margin:18px 0 8px;">`)
    .replace(/<h3>/g, `<h3 style="font:700 14px ${FONT};color:${C.ink};margin:14px 0 6px;">`)
    .replace(/<p>/g, `<p style="font:400 13px ${FONT};color:${C.body};line-height:1.55;margin:0 0 10px;">`)
    .replace(/<li>/g, `<li style="font:400 13px ${FONT};color:${C.body};line-height:1.5;margin:0 0 4px;">`)
    .replace(/<table>/g, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font:400 12px ${FONT};margin:8px 0;">`)
    .replace(/<th>/g, `<th style="background:${C.grayBg};border:1px solid ${C.line};padding:6px 8px;text-align:left;font-weight:700;color:${C.ink};">`)
    .replace(/<td>/g, `<td style="border:1px solid ${C.line};padding:6px 8px;color:${C.body};">`)
    .replace(/<strong>/g, `<strong style="color:${C.ink};">`);
  return `${sectionTitle('The brief', "What's happening & what to do")}
    <tr><td style="padding:4px 28px 8px 28px;">${styled}</td></tr>`;
}

// ─── Shell ────────────────────────────────────────────────────────────────────
async function renderBriefEmail(data = {}) {
  const { location = 'Hanover, PA', dateLabel = '', markdown = '', pricing, ownStore, breakfast, rankings } = data;
  const markdownHtml = await renderMarkdownCore(markdown);
  const body = [
    renderRankingHighlight(rankings),
    renderOwnStore(ownStore),
    renderPricing(pricing),
    renderBreakfast(breakfast),
    markdownHtml,
  ].filter(Boolean).join('\n');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:${C.bg};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};padding:24px 12px;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${C.card};border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);">
      <tr><td style="background:${C.red};padding:22px 28px;">
        <div style="font:700 12px ${FONT};letter-spacing:2px;text-transform:uppercase;color:#ffd9e0;">Chick-fil-A · Market Intel</div>
        <div style="font:800 24px ${FONT};color:#ffffff;margin-top:4px;">Weekly Market Brief</div>
        <div style="font:400 13px ${FONT};color:#ffd9e0;margin-top:4px;">${esc(location)}${dateLabel ? ' · ' + esc(dateLabel) : ''}</div>
      </td></tr>
      ${body}
      <tr><td style="padding:22px 28px;border-top:1px solid ${C.line};">
        <div style="font:400 11px ${FONT};color:${C.muted};line-height:1.5;">Generated by CFA Market Intel. Review aspects are inferred from public Google reviews and are directional, not audited. Prices are operator-verified where shown.</div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

// ─── Send ─────────────────────────────────────────────────────────────────────
async function sendBriefEmail({ html, subject, to, from } = {}) {
  const apiKey = process.env.RESEND_API_KEY;
  const recipient = to || process.env.EMAIL_TO;
  const sender = from || process.env.EMAIL_FROM || 'CFA Market Intel <onboarding@resend.dev>';
  if (!recipient) throw new Error('No recipient (set EMAIL_TO or pass `to`)');

  if (!apiKey || apiKey.startsWith('your_')) {
    console.warn('[email] RESEND_API_KEY not set — dry run (not sending)');
    return { sent: false, dryRun: true, to: recipient, from: sender };
  }
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: sender,
    to: recipient,
    subject: subject || 'Your Weekly Market Brief',
    html,
  });
  if (error) throw new Error(`Resend: ${error.message || JSON.stringify(error)}`);
  return { sent: true, id: data?.id, to: recipient, from: sender };
}

module.exports = { renderBriefEmail, sendBriefEmail };
