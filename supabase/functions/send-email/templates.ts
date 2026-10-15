// The guest emails: request received, confirmed, before arrival, cancelled, offer, and the
// rejected / expired notes. Greek and English, one look. Every email is built as HTML and as plain text.
// Property details come from public.email_settings (filled in by the owners in admin Settings); anything
// left empty simply does not appear, so no email ever carries invented facts.

export type Settings = Record<string, any>;
export type Guest = {
  name: string; lang: string; unit_type: string; unit: string | null;
  check_in: string; check_out: string; guests: number;
  ref_no?: number | null; price_total?: number | string | null; price_paid?: number | string | null;
};
export type Offer = { discount_pct: number; code?: string | null; stay_from: string; stay_to: string; book_by?: string | null };
export type Mail = { subject: string; html: string; text: string };
export const GUEST_KINDS = ['received', 'confirmed', 'prearrival', 'cancelled', 'rejected', 'expired'] as const;
export type GuestKind = typeof GUEST_KINDS[number];

const C = { page: '#eaf1f8', brand: '#1f5fa8', deep: '#163f73', ink: '#2b3a4a', body: '#4b5d70', mute: '#7a98b8', faint: '#8aa1b8', panel: '#f4f8fc', line: '#d9e6f3', line2: '#e6eef6' };
const SANS = "'Segoe UI',Helvetica,Arial,sans-serif";
const SERIF = "'Piazzolla',Georgia,'Times New Roman',serif";

// ---------- small helpers ----------
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const nl = (s: string) => esc(s).replace(/\n/g, '<br>');
const lines = (s: unknown) => String(s ?? '').replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean);
const clean = (s: unknown) => String(s ?? '').trim();

const dateOf = (iso: string) => new Date(iso + 'T12:00:00Z');
const loc = (lang: string) => (lang === 'en' ? 'en-GB' : 'el-GR');
export const fmtLong = (iso: string, lang: string) => dateOf(iso).toLocaleDateString(loc(lang), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtDay = (iso: string, lang: string) => dateOf(iso).toLocaleDateString(loc(lang), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const fmtShort = (iso: string, lang: string) => dateOf(iso).toLocaleDateString(loc(lang), { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(/[.,]/g, '');
const fmtMonthDay = (iso: string, lang: string) => dateOf(iso).toLocaleDateString(loc(lang), { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(/[.,]/g, '');
const nightsOf = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const euro = (n: number, lang: string) => '€' + n.toLocaleString(lang === 'en' ? 'en-GB' : 'el-GR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v: unknown): number | null => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

function unitName(g: Guest, lang: string): string {
  const m = /^r(\d+)$/.exec(g.unit ?? '');
  if (m) return (lang === 'en' ? 'Room ' : 'Δωμάτιο ') + m[1];
  return g.unit_type === 'apt' ? (lang === 'en' ? 'Apartment' : 'Διαμέρισμα') : (lang === 'en' ? 'Room' : 'Δωμάτιο');
}
function guestsText(n: number, lang: string) {
  return lang === 'en' ? n + (n === 1 ? ' guest' : ' guests') : n + (n === 1 ? ' άτομο' : ' άτομα');
}
/** "6978499347" -> "697 849 9347" for reading, and a +30 link for tapping. */
function phoneOf(raw: unknown): { show: string; tel: string } | null {
  const p = clean(raw);
  if (!p) return null;
  const digits = p.replace(/[^\d+]/g, '');
  let show = p;
  if (/^\d{10}$/.test(digits)) show = digits.replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3');
  let tel = digits.replace(/^00/, '+');
  if (/^(69|2)\d{8,9}$/.test(tel)) tel = '+30' + tel;
  return { show, tel };
}
const refText = (g: Guest) => (g.ref_no ? 'LM-' + g.ref_no : '');
const firstName = (name: string) => clean(name).split(/\s+/)[0] || clean(name);
const oneLine = (s: unknown) => clean(s).split('\n').map((x) => x.trim()).filter(Boolean).join(', ');

// ---------- a document that is written as HTML and as plain text at the same time ----------
class Doc {
  h: string[] = [];
  t: string[] = [];
  lang: string;
  s: Settings;
  constructor(lang: string, s: Settings) { this.lang = lang; this.s = s; }
  tr = (el: string, en: string) => (this.lang === 'en' ? en : el);
  raw(html: string, text = '') { this.h.push(html); if (text) this.t.push(text); }

  greeting(name: string, intro: string) {
    this.raw(
      `<tr><td class="px" style="padding:36px 40px 8px 40px;font-family:${SANS};font-size:16px;line-height:26px;color:${C.ink};">${this.tr('Γεια σου', 'Hello')} <strong>${esc(firstName(name))}</strong>,<br><br>${esc(intro)}</td></tr>`,
      `${this.tr('Γεια σου', 'Hello')} ${firstName(name)},\n\n${intro}`
    );
  }
  paragraph(text: string) {
    this.raw(`<tr><td class="px" style="padding:20px 40px 0 40px;font-family:${SANS};font-size:15px;line-height:24px;color:${C.body};">${esc(text)}</td></tr>`, text);
  }
  heading(text: string, top = 34) {
    this.raw(`<tr><td class="px" style="padding:${top}px 40px 0 40px;"><div style="font-family:${SERIF};font-size:24px;line-height:30px;color:${C.deep};font-weight:600;">${esc(text)}</div></td></tr>`);
    this.t.push(text);
  }

  /** Dates and stay facts in one box. */
  card(o: { label: string; g: Guest; times?: boolean; center?: boolean; stayOnly?: boolean }) {
    const g = o.g, s = this.s;
    const lang = this.lang;
    const nights = nightsOf(g.check_in, g.check_out);
    const ref = refText(g);
    const cin = o.times && clean(s.checkin_time) ? this.tr('από τις ', 'from ') + clean(s.checkin_time) : '';
    const cout = o.times && clean(s.checkout_time) ? this.tr('έως τις ', 'by ') + clean(s.checkout_time) : '';
    const al = o.center ? 'center' : 'left';
    const date = (label: string, iso: string, note: string, pad: string) =>
      `<div style="font-family:${SANS};font-size:12px;color:${C.mute};padding-bottom:4px;">${esc(label)}</div>` +
      `<div class="date" style="font-family:${SERIF};font-size:24px;line-height:30px;color:${C.deep};font-weight:600;">${esc(fmtShort(iso, lang))}</div>` +
      (note ? `<div style="font-family:${SANS};font-size:14px;color:${C.body};padding-top:2px;">${esc(note)}</div>` : '');
    const fact = (w: string, label: string, v: string) =>
      `<td width="${w}" valign="top" align="${al}" style="font-family:${SANS};text-align:${al};"><div style="font-size:12px;color:${C.mute};">${esc(label)}</div><div style="font-size:15px;color:${C.ink};font-weight:600;padding-top:3px;">${esc(v)}</div></td>`;
    this.raw(
      `<tr><td class="px" style="padding:24px 40px 8px 40px;">` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel};border:1px solid ${C.line};border-radius:14px;">` +
      `<tr><td style="padding:22px 24px 6px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td style="font-family:${SANS};font-size:11px;letter-spacing:2px;color:${C.mute};">${esc(o.label)}</td>` +
      (ref ? `<td align="right" style="font-family:${SANS};font-size:13px;color:${C.brand};font-weight:600;">${this.tr('Αρ. ', 'No. ')}${esc(ref)}</td>` : '') +
      `</tr></table></td></tr>` +
      `<tr><td style="padding:10px 24px 4px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td class="stack stack-gap" width="48%" valign="top" align="${al}" style="text-align:${al};padding-right:8px;">${date(this.tr('ΑΦΙΞΗ', 'ARRIVAL'), g.check_in, cin, '')}</td>` +
      `<td class="stack" width="4%" align="center" valign="middle" style="font-family:Georgia,serif;font-size:22px;color:#9bb8d6;">&rarr;</td>` +
      `<td class="stack" width="48%" valign="top" align="${al}" style="text-align:${al};padding-left:8px;">${date(this.tr('ΑΝΑΧΩΡΗΣΗ', 'DEPARTURE'), g.check_out, cout, '')}</td>` +
      `</tr></table></td></tr>` +
      `<tr><td style="padding:14px 24px 0 24px;"><div style="border-top:1px solid ${C.line};font-size:0;line-height:0;">&nbsp;</div></td></tr>` +
      `<tr><td style="padding:0 24px 22px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      fact('34%', this.tr('ΚΑΤΑΛΥΜΑ', 'ACCOMMODATION'), unitName(g, lang)) +
      fact('33%', this.tr('ΔΙΑΝΥΚΤΕΡΕΥΣΕΙΣ', 'NIGHTS'), String(nights)) +
      fact('33%', this.tr('ΑΤΟΜΑ', 'GUESTS'), String(g.guests)) +
      `</tr></table></td></tr></table></td></tr>`,
      `${o.label}${ref ? ' (' + this.tr('Αρ. ', 'No. ') + ref + ')' : ''}\n` +
      `${this.tr('Άφιξη', 'Arrival')}: ${fmtDay(g.check_in, lang)}${cin ? ', ' + cin : ''}\n` +
      `${this.tr('Αναχώρηση', 'Departure')}: ${fmtDay(g.check_out, lang)}${cout ? ', ' + cout : ''}\n` +
      `${this.tr('Κατάλυμα', 'Accommodation')}: ${unitName(g, lang)} · ${this.tr('Διανυκτερεύσεις', 'Nights')}: ${nights} · ${this.tr('Άτομα', 'Guests')}: ${g.guests}`
    );
  }

  /** A small strip with three facts (used before arrival). */
  strip(items: [string, string][]) {
    const w = Math.floor(100 / items.length);
    this.raw(
      `<tr><td class="px" style="padding:24px 40px 8px 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel};border:1px solid ${C.line};border-radius:14px;"><tr><td style="padding:20px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      items.map(([l, v]) => `<td width="${w}%" align="center" valign="top" style="font-family:${SANS};text-align:center;"><div style="font-size:12px;color:${C.mute};">${esc(l)}</div><div style="font-size:15px;color:${C.ink};font-weight:600;padding-top:3px;">${esc(v)}</div></td>`).join('') +
      `</tr></table></td></tr></table></td></tr>`,
      items.map(([l, v]) => `${l}: ${v}`).join(' · ')
    );
  }

  rows(rows: { label: string; value: string; strong?: boolean }[], title: string) {
    this.raw(
      `<tr><td class="px" style="padding:16px 40px 8px 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${SANS};font-size:15px;color:${C.ink};">` +
      rows.map((r, i) => {
        const last = i === rows.length - 1;
        const st = `padding:${r.strong ? 10 : 8}px 0;${last ? '' : `border-bottom:1px solid ${C.line2};`}${r.strong ? `color:${C.deep};font-weight:600;` : ''}`;
        return `<tr><td style="${st}">${esc(r.label)}</td><td align="right" style="${st}${r.strong ? '' : 'font-weight:600;'}">${esc(r.value)}</td></tr>`;
      }).join('') + `</table></td></tr>`,
      '\n' + title + '\n' + rows.map((r) => `${r.label}: ${r.value}`).join('\n')
    );
  }

  steps(items: { title: string; desc: string; mark: string; state: 'done' | 'active' | 'todo' }[]) {
    const dot = (mark: string, state: string) => state === 'done'
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" width="32" height="32" bgcolor="${C.brand}" style="border-radius:16px;width:32px;height:32px;color:#ffffff;font-size:15px;font-weight:700;line-height:32px;">&#10003;</td></tr></table>`
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" width="28" height="28" bgcolor="#ffffff" style="border-radius:16px;width:28px;height:28px;border:2px solid ${state === 'todo' ? '#b9cfe6' : C.brand};color:${state === 'todo' ? C.mute : C.brand};font-size:14px;font-weight:700;line-height:28px;">${esc(mark)}</td></tr></table>`;
    this.raw(
      `<tr><td class="px" style="padding:14px 40px 0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${SANS};">` +
      items.map((it, i) => `<tr><td width="44" valign="top" style="padding:0 0 ${i === items.length - 1 ? 0 : 18}px 0;">${dot(it.mark, it.state)}</td><td valign="top" style="padding:0 0 ${i === items.length - 1 ? 0 : 18}px 0;font-size:15px;line-height:23px;color:${C.body};"><strong style="color:${C.ink};">${esc(it.title)}</strong><br>${esc(it.desc)}</td></tr>`).join('') +
      `</table></td></tr>`,
      items.map((it, i) => `${i + 1}. ${it.title}. ${it.desc}`).join('\n')
    );
  }

  bullets(items: { bold?: string; text: string }[], text = true) {
    this.raw(
      `<tr><td class="px" style="padding:10px 40px 0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${SANS};font-size:15px;line-height:23px;color:${C.body};">` +
      items.map((it) => `<tr><td width="28" valign="top" style="padding:6px 0;color:${C.brand};">&#9679;</td><td style="padding:6px 0;">${it.bold ? `<strong style="color:${C.ink};">${esc(it.bold)}</strong> ` : ''}${esc(it.text)}</td></tr>`).join('') +
      `</table></td></tr>`,
      text ? items.map((it) => '- ' + (it.bold ? it.bold + ' ' : '') + it.text).join('\n') : ''
    );
  }

  callout(bold: string, rest: string) {
    this.raw(
      `<tr><td class="px" style="padding:30px 40px 0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel};border-radius:14px;"><tr><td style="padding:20px 24px;font-family:${SANS};font-size:14px;line-height:22px;color:${C.body};"><strong style="color:${C.deep};">${esc(bold)}</strong> ${esc(rest)}</td></tr></table></td></tr>`,
      '\n' + bold + ' ' + rest
    );
  }

  note(text: string, top = 22) {
    this.raw(`<tr><td class="px" align="center" style="padding:${top}px 40px 0 40px;font-family:${SANS};font-size:13px;line-height:20px;color:${C.faint};">${esc(text)}</td></tr>`, '\n' + text);
  }

  button(label: string, href: string, o: { top?: number; solid?: boolean; align?: string; textLine?: string } = {}) {
    const solid = o.solid !== false;
    const a = o.align ?? 'center';
    this.raw(
      `<tr><td class="px" align="${a}" style="padding:${o.top ?? 24}px 40px 8px 40px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="${solid ? C.brand : '#ffffff'}" style="border-radius:999px;${solid ? '' : `border:1.5px solid ${C.brand};`}"><a href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:15px;font-weight:600;color:${solid ? '#ffffff' : C.brand};text-decoration:none;border-radius:999px;">${esc(label)}</a></td></tr></table></td></tr>`,
      o.textLine ?? `${label}: ${href}`
    );
  }

  contact(title: string, sub: string) {
    const p = phoneOf(this.s.phone);
    if (!p) return;
    this.raw(
      `<tr><td class="px" style="padding:32px 40px 0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel};border-radius:14px;"><tr><td align="center" style="padding:26px 24px;">` +
      `<div style="font-family:${SERIF};font-size:21px;line-height:28px;color:${C.deep};font-weight:600;">${esc(title)}</div>` +
      `<div style="font-family:${SANS};font-size:14px;line-height:22px;color:${C.body};padding:6px 0 16px 0;">${esc(sub)}</div>` +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#ffffff" style="border-radius:999px;border:1.5px solid ${C.brand};"><a href="tel:${esc(p.tel)}" style="display:inline-block;padding:11px 26px;font-family:${SANS};font-size:14px;font-weight:600;color:${C.brand};text-decoration:none;border-radius:999px;">${this.tr('Κάλεσέ μας', 'Call us')} · ${esc(p.show)}</a></td></tr></table>` +
      `</td></tr></table></td></tr>`,
      `\n${title} ${sub} ${this.tr('Τηλέφωνο', 'Phone')}: ${p.show}`
    );
  }

  signoff(tagline: string, line: string) {
    this.raw(
      `<tr><td align="center" class="px" style="padding:40px 40px 36px 40px;"><div style="font-family:${SERIF};font-size:22px;line-height:30px;color:${C.brand};font-style:italic;">${esc(tagline)}</div><div style="font-family:${SANS};font-size:15px;line-height:24px;color:${C.body};padding-top:10px;">${esc(line)}<br><strong style="color:${C.ink};">${this.tr('η ομάδα του Life’s Moments', 'the Life’s Moments team')}</strong></div></td></tr>`,
      `\n${tagline}\n${line}\n${this.tr('η ομάδα του Life’s Moments', 'the Life’s Moments team')}`
    );
  }
}

function page(lang: string, o: { title: string; preheader: string; eyebrow: string; h1: string[]; sub?: string; body: string; footer: string }): string {
  return `<!doctype html>
<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(o.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Piazzolla:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  body{margin:0;padding:0;background:${C.page};}
  a{color:${C.brand};}
  @media (max-width:620px){
    .container{width:100%!important;}
    .px{padding-left:20px!important;padding-right:20px!important;}
    .stack{display:block!important;width:100%!important;}
    .stack-gap{padding-bottom:12px!important;}
    .h1{font-size:30px!important;line-height:36px!important;}
    .date{font-size:22px!important;}
    .big{font-size:60px!important;line-height:64px!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.page};font-size:1px;line-height:1px;">${esc(o.preheader)}&#8199;&#847; &#8199;&#847; &#8199;&#847; &#8199;&#847; &#8199;&#847; &#8199;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;">
  <tr><td align="center" style="padding:30px 32px 22px 32px;background:#ffffff;">
    <div style="font-family:${SERIF};font-size:28px;line-height:32px;font-weight:600;color:${C.brand};letter-spacing:0.5px;">Life&#8217;s Moments</div>
    <div style="font-family:${SANS};font-size:11px;letter-spacing:4px;color:${C.mute};padding-top:6px;">${lang === 'en' ? 'THASOS' : 'ΘΑΣΟΣ'}</div>
  </td></tr>
  <tr><td align="center" class="px" style="padding:56px 32px 52px 32px;background-color:${C.brand};background-image:linear-gradient(160deg,#4a8fd6 0%,${C.brand} 55%,${C.deep} 100%);">
    <div style="font-family:${SANS};font-size:12px;letter-spacing:3px;color:#cfe3f7;padding-bottom:14px;">${esc(o.eyebrow)}</div>
    <div class="h1" style="font-family:${SERIF};font-size:38px;line-height:44px;font-weight:500;color:#ffffff;">${o.h1.map(esc).join('<br>')}</div>
    ${o.sub ? `<div style="font-family:${SANS};font-size:15px;line-height:24px;color:#e3effb;padding-top:16px;">${esc(o.sub)}</div>` : ''}
  </td></tr>
${o.body}
  <tr><td align="center" style="padding:22px 32px;background:${C.panel};border-top:1px solid #e1ebf5;font-family:${SANS};font-size:12px;line-height:19px;color:${C.faint};">${o.footer}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function footerFor(d: Doc, g?: Guest): { html: string; text: string } {
  const addr = oneLine(d.s.address);
  const ref = g ? refText(g) : '';
  const l1 = 'Life&#8217;s Moments' + (addr ? ' · ' + esc(addr) : '');
  const l2 = ref ? d.tr(`Αυτό το μήνυμα στάλθηκε αυτόματα για την κράτηση ${ref}.`, `This message was sent automatically for booking ${ref}.`) : d.tr('Αυτό το μήνυμα στάλθηκε αυτόματα.', 'This message was sent automatically.');
  return { html: l1 + '<br>' + esc(l2), text: `\n--\nLife’s Moments${addr ? ' · ' + addr : ''}\n${l2}` };
}
function finish(d: Doc, o: { subject: string; title: string; preheader: string; eyebrow: string; h1: string[]; sub?: string; footerHtml?: string; footerText?: string }, g?: Guest): Mail {
  const f = footerFor(d, g);
  const html = page(d.lang, { title: o.title, preheader: o.preheader, eyebrow: o.eyebrow, h1: o.h1, sub: o.sub, body: d.h.join('\n'), footer: o.footerHtml ?? f.html });
  const text = d.t.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + (o.footerText ?? f.text);
  return { subject: o.subject, html, text };
}

// ---------- the "good to know" lines and the tips ----------
function infoBullets(raw: unknown): { bold?: string; text: string }[] {
  return lines(raw).map((l) => {
    const t = l.replace(/^[-•*]\s*/, '');
    const m = /^([^:]{2,40}):\s*(.+)$/.exec(t);
    return m ? { bold: m[1] + ':', text: m[2] } : { text: t };
  });
}

const DEFAULT_TIPS_EL = `# Κοντά μας
Πευκάρι [ΠΑΡΑΛΙΑ]: Δύο παραλίες, μία οργανωμένη και μία άγρια. Ιδανικές για κολύμπι και κατάδυση.
Πότος [ΧΩΡΙΟ]: Ζωντανό παραθαλάσσιο χωριό. Βόλτα στο λιμανάκι και φαγητό δίπλα στη θάλασσα.
Ψιλή Άμμος [ΠΑΡΑΛΙΑ]: Λεπτή άμμος, καφέ και ταβέρνα δίπλα στο κύμα. Πολύ δημοφιλής, οπότε πήγαινε νωρίς.
# Αξίζει μια διαδρομή
Θεολόγος [ΧΩΡΙΟ]: Ορεινό χωριό με παραδοσιακά αρχοντικά και ταβέρνες. Δοκίμασε το ψητό αρνί.
Σαλιάρα [ΠΑΡΑΛΙΑ]: Η γνωστή «Μαρμαρένια» παραλία. Η πρόσβαση γίνεται από χωματόδρομο, αλλά αξίζει τον κόπο.
Χρυσή Αμμουδιά [ΠΑΡΑΛΙΑ]: Οι διάσημες χρυσές αμμουδιές του νησιού, για μια ολόκληρη μέρα στη θάλασσα.
Λιμένας [ΠΟΛΙΤΙΣΜΟΣ]: Η πρωτεύουσα του νησιού, με το Αρχαιολογικό Μουσείο και το Θασίτικο Σπίτι. Ιδανική για μέρα με συννεφιά.`;
const DEFAULT_TIPS_EN = `# Close to us
Pefkari [BEACH]: Two beaches, one organised and one wild. Great for swimming and snorkelling.
Potos [VILLAGE]: A lively seaside village. Stroll the little harbour and eat by the water.
Psili Ammos [BEACH]: Fine sand, a café and a taverna by the waves. Very popular, so go early.
# Worth the drive
Theologos [VILLAGE]: A mountain village with traditional mansions and tavernas. Try the roast lamb.
Saliara [BEACH]: The well-known "Marble Beach". Reached by a dirt road, but worth the effort.
Golden Beach [BEACH]: The island's famous golden sands, for a whole day by the sea.
Limenas [CULTURE]: The island's capital, with the Archaeological Museum and the Thasian House. Perfect for a cloudy day.`;

type Tip = { title: string; tag?: string; desc: string };
function parseTips(raw: string): { title: string; items: Tip[] }[] {
  const groups: { title: string; items: Tip[] }[] = [];
  for (const l of lines(raw)) {
    if (l.startsWith('#')) { groups.push({ title: l.replace(/^#+\s*/, ''), items: [] }); continue; }
    if (!groups.length) groups.push({ title: '', items: [] });
    const m = /^([^:]{1,60}):\s*(.+)$/.exec(l);
    const head = m ? m[1] : l;
    const tg = /^(.*?)\s*\[([^\]]{1,16})\]\s*$/.exec(head);
    groups[groups.length - 1].items.push({ title: (tg ? tg[1] : head).trim(), tag: tg ? tg[2].toUpperCase() : undefined, desc: m ? m[2] : '' });
  }
  return groups.filter((g) => g.items.length);
}

// ---------- the emails about one booking request ----------
export function buildGuestMail(kind: GuestKind, g: Guest, s: Settings): Mail {
  const lang = g.lang === 'en' ? 'en' : 'el';
  const d = new Doc(lang, s);
  const { tr } = d;
  const site = clean(s.site_url);
  const nights = nightsOf(g.check_in, g.check_out);
  const range = fmtMonthDay(g.check_in, lang) + ' – ' + fmtMonthDay(g.check_out, lang);
  const total = num(g.price_total), paid = num(g.price_paid) ?? 0;

  if (kind === 'received') {
    d.greeting(g.name, tr('Λάβαμε το αίτημά σου και οι ιδιοκτήτες το εξετάζουν. Θα σου στείλουμε απάντηση το αργότερο μέσα σε 24 ώρες.', 'We received your request and the owners are looking at it. We will reply within 24 hours at the latest.'));
    d.card({ label: tr('ΤΟ ΑΙΤΗΜΑ ΣΟΥ', 'YOUR REQUEST'), g });
    d.heading(tr('Τι θα γίνει στη συνέχεια', 'What happens next'));
    d.steps([
      { title: tr('Λάβαμε το αίτημά σου', 'We received your request'), desc: tr('Το έχουμε καταγράψει και είναι στα χέρια των ιδιοκτητών.', 'It is recorded and with the owners.'), mark: '✓', state: 'done' },
      { title: tr('Ελέγχουμε τη διαθεσιμότητα', 'We check availability'), desc: tr('Θα σου απαντήσουμε εντός 24 ωρών.', 'You will hear from us within 24 hours.'), mark: '2', state: 'active' },
      { title: tr('Επιβεβαίωση και οδηγίες άφιξης', 'Confirmation and arrival details'), desc: tr('Μόλις εγκριθεί, θα λάβεις email με όλα τα στοιχεία για να φτάσεις.', 'Once approved, you will get an email with everything you need to get here.'), mark: '3', state: 'todo' }
    ]);
    d.callout(tr('Καμία ανησυχία.', 'No need to worry.'), tr('Αν δεν μπορέσουμε να σε φιλοξενήσουμε εκείνες τις ημερομηνίες, δεν θα χρεωθείς.', 'If we cannot host you on those dates, you will not be charged.'));
    d.contact(tr('Έχεις μια ερώτηση;', 'Have a question?'), tr('Θέλεις να αλλάξεις κάτι στο αίτημά σου; Απάντησε σε αυτό το email ή κάλεσέ μας.', 'Want to change something in your request? Reply to this email or call us.'));
    d.signoff(tr('Ήσυχα, δίπλα στη θάλασσα.', 'Quiet, by the sea.'), tr('Σε ευχαριστούμε,', 'Thank you,'));
    return finish(d, {
      subject: tr('Λάβαμε το αίτημά σου – θα σου απαντήσουμε εντός 24 ωρών', 'We received your request – we will reply within 24 hours'),
      title: tr('Λάβαμε το αίτημά σου – Life’s Moments', 'We received your request – Life’s Moments'),
      preheader: tr(`Λάβαμε το αίτημά σου για ${range} και θα σου απαντήσουμε εντός 24 ωρών.`, `We received your request for ${range} and will reply within 24 hours.`),
      eyebrow: tr('ΛΑΒΑΜΕ ΤΟ ΑΙΤΗΜΑ ΣΟΥ', 'WE RECEIVED YOUR REQUEST'),
      h1: tr('Σου απαντάμε|εντός 24 ωρών', 'We will reply|within 24 hours').split('|'),
      sub: tr('Ευχαριστούμε που μας επέλεξες.', 'Thank you for choosing us.')
    }, g);
  }

  if (kind === 'confirmed') {
    d.greeting(g.name, tr('Με μεγάλη χαρά επιβεβαιώνουμε την κράτησή σου. Παρακάτω θα βρεις όλα όσα χρειάζεσαι για να φτάσεις και να νιώσεις σαν στο σπίτι σου από την πρώτη στιγμή.', 'We are delighted to confirm your booking. Below is everything you need to get here and feel at home from the first moment.'));
    d.card({ label: tr('Η ΚΡΑΤΗΣΗ ΣΟΥ', 'YOUR BOOKING'), g, times: true });
    if (total != null) {
      const rows = [{ label: tr('Συνολικό κόστος διαμονής', 'Total for the stay'), value: euro(total, lang) }];
      if (paid > 0) rows.push({ label: tr('Προκαταβολή (εξοφλημένη)', 'Deposit (paid)'), value: euro(paid, lang) });
      if (total - paid > 0.004) rows.push({ label: paid > 0 ? tr('Υπόλοιπο κατά την άφιξη', 'Balance on arrival') : tr('Πληρωμή κατά την άφιξη', 'To pay on arrival'), value: euro(total - paid, lang), strong: true } as any);
      d.rows(rows, tr('Πληρωμή', 'Payment'));
    }
    const addr = clean(s.address), arrival = clean(lang === 'en' ? s.arrival_en || s.arrival_el : s.arrival_el), maps = clean(s.maps_url);
    if (addr || arrival || maps) {
      d.heading(tr('Πώς θα φτάσεις', 'How to get here'), 32);
      d.raw(
        `<tr><td class="px" style="padding:10px 40px 0 40px;font-family:${SANS};font-size:15px;line-height:24px;color:${C.body};">${addr ? `<strong style="color:${C.ink};">${nl(addr)}</strong>${arrival ? '<br>' : ''}` : ''}${arrival ? nl(arrival) : ''}</td></tr>`,
        [addr, arrival].filter(Boolean).join('\n')
      );
      if (maps) d.button(tr('Άνοιγμα στον χάρτη', 'Open in maps'), maps, { align: 'left', top: 20, textLine: tr('Χάρτης: ', 'Map: ') + maps });
    }
    const extra = infoBullets(lang === 'en' ? s.extra_en || s.extra_el : s.extra_el);
    if (extra.length) { d.heading(tr('Καλό είναι να ξέρεις', 'Good to know'), 32); d.bullets(extra); }
    d.contact(tr('Χρειάζεσαι κάτι;', 'Need anything?'), tr('Είμαστε δίπλα σου πριν και κατά τη διάρκεια της διαμονής.', 'We are here for you before and during your stay.'));
    d.signoff(tr('Ήσυχα, δίπλα στη θάλασσα.', 'Quiet, by the sea.'), tr('Με αγάπη,', 'With love,'));
    return finish(d, {
      subject: tr('Η κράτησή σου επιβεβαιώθηκε – Life’s Moments', 'Your booking is confirmed – Life’s Moments'),
      title: tr('Η κράτησή σου επιβεβαιώθηκε – Life’s Moments', 'Your booking is confirmed – Life’s Moments'),
      preheader: tr(`Άφιξη ${fmtDay(g.check_in, lang)} · ${unitName(g, lang)}${refText(g) ? ' · Αριθμός κράτησης ' + refText(g) : ''} — σε περιμένουμε!`, `Arrival ${fmtDay(g.check_in, lang)} · ${unitName(g, lang)}${refText(g) ? ' · Booking ' + refText(g) : ''} — we look forward to seeing you!`),
      eyebrow: tr('ΕΠΙΒΕΒΑΙΩΣΗ ΚΡΑΤΗΣΗΣ', 'BOOKING CONFIRMED'),
      h1: tr('Σε περιμένουμε|δίπλα στη θάλασσα', 'We are waiting for you|by the sea').split('|'),
      sub: tr('Η κράτησή σου είναι επιβεβαιωμένη.', 'Your booking is confirmed.')
    }, g);
  }

  if (kind === 'prearrival') {
    d.greeting(g.name, tr('Σε λίγες μέρες είσαι εδώ και χαιρόμαστε πολύ! Για να αξιοποιήσεις τον χρόνο σου, μαζέψαμε μερικά από τα αγαπημένα μας μέρη. Άλλα είναι κοντά μας και άλλα αξίζουν μια μικρή διαδρομή.', 'You will be here in a few days and we are really looking forward to it! To help you make the most of your time, here are some of our favourite places. Some are close by and some are worth a short drive.'));
    d.strip([[tr('ΑΦΙΞΗ', 'ARRIVAL'), fmtShort(g.check_in, lang)], ...(clean(s.checkin_time) ? [['CHECK-IN', tr('από ', 'from ') + clean(s.checkin_time)] as [string, string]] : []), [tr('ΚΑΤΑΛΥΜΑ', 'ACCOMMODATION'), unitName(g, lang)]]);
    const custom = clean(lang === 'en' ? s.tips_en || s.tips_el : s.tips_el);
    const groups = parseTips(custom || (lang === 'en' ? DEFAULT_TIPS_EN : DEFAULT_TIPS_EL));
    for (const grp of groups) {
      if (grp.title) d.heading(grp.title, 30);
      d.raw(
        `<tr><td class="px" style="padding:6px 40px 0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
        grp.items.map((it, i) => `<tr><td style="padding:14px 0;${i === grp.items.length - 1 ? '' : `border-bottom:1px solid ${C.line2};`}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top"><div style="font-family:${SERIF};font-size:18px;line-height:24px;color:${C.deep};font-weight:600;">${esc(it.title)}</div>${it.desc ? `<div style="font-family:${SANS};font-size:14px;line-height:22px;color:${C.body};padding-top:3px;">${esc(it.desc)}</div>` : ''}</td>${it.tag ? `<td valign="top" align="right" width="96" style="padding-left:12px;"><span style="display:inline-block;background:${C.page};color:${C.brand};font-family:${SANS};font-size:11px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap;">${esc(it.tag)}</span></td>` : ''}</tr></table></td></tr>`).join('') +
        `</table></td></tr>`,
        grp.items.map((it) => `- ${it.title}${it.desc ? ': ' + it.desc : ''}`).join('\n')
      );
    }
    d.callout(tr('Πάρε μια γεύση μαζί σου.', 'Take a taste home.'), tr('Η Θάσος φημίζεται για το μέλι, το ελαιόλαδο, τη ρίγανη και τα γλυκά με καρύδι.', 'Thasos is famous for its honey, olive oil, oregano and walnut sweets.'));
    d.note(tr('Οι ώρες λειτουργίας αλλάζουν ανά εποχή. Αν θες να βεβαιωθείς ότι κάτι είναι ανοιχτό, ρώτησέ μας.', 'Opening hours change with the season. If you want to be sure something is open, just ask us.'));
    d.contact(tr('Χρειάζεσαι κάτι;', 'Need anything?'), tr('Είμαστε δίπλα σου πριν και κατά τη διάρκεια της διαμονής.', 'We are here for you before and during your stay.'));
    d.signoff(tr('Ήσυχα, δίπλα στη θάλασσα.', 'Quiet, by the sea.'), tr('Καλό ταξίδι,', 'Safe travels,'));
    return finish(d, {
      subject: tr('Σε λίγες μέρες είσαι εδώ – ιδέες για τη Θάσο', 'A few days to go – ideas for your stay on Thasos'),
      title: tr('Σε λίγες μέρες είσαι εδώ – Life’s Moments', 'A few days to go – Life’s Moments'),
      preheader: tr('Σε λίγες μέρες είσαι στη Θάσο. Παραλίες, χωριά και μικρές βόλτες που αξίζει να κάνεις.', 'In a few days you are on Thasos. Beaches, villages and little trips worth making.'),
      eyebrow: tr('ΣΕ ΛΙΓΕΣ ΜΕΡΕΣ', 'IN A FEW DAYS'),
      h1: tr('Η Θάσος|σε περιμένει', 'Thasos|is waiting for you').split('|')
    }, g);
  }

  if (kind === 'cancelled') {
    d.greeting(g.name, tr('Δυστυχώς δεν θα μπορέσουμε να σε φιλοξενήσουμε στις ημερομηνίες της κράτησής σου και ζητούμε ειλικρινά συγγνώμη για την αναστάτωση. Θα κάνουμε ό,τι μπορούμε για να τη διορθώσουμε.', 'Unfortunately we will not be able to host you on the dates of your booking, and we are sincerely sorry for the upset. We will do everything we can to put it right.'));
    d.card({ label: tr('Η ΚΡΑΤΗΣΗ ΣΟΥ', 'YOUR BOOKING'), g, center: true });
    d.heading(tr('Τι θα γίνει τώρα', 'What happens now'));
    d.steps([
      { title: tr('Θα επικοινωνήσουμε μαζί σου', 'We will contact you'), desc: tr('Θα σε καλέσουμε ή θα σου γράψουμε το συντομότερο, για να βρούμε λύση που θα σου ταιριάζει, π.χ. άλλες ημερομηνίες ή άλλο κατάλυμα.', 'We will call or write to you as soon as we can, to find a solution that suits you, for example other dates or another room.'), mark: '1', state: 'active' },
      { title: tr('Επιστρέφουμε το ποσό', 'We refund the amount'), desc: tr('Ό,τι έχεις καταβάλει επιστρέφεται ολόκληρο, χωρίς καμία επιβάρυνση.', 'Anything you have paid is refunded in full, with no charge.'), mark: '2', state: 'active' }
    ]);
    if (paid > 0) {
      d.raw(
        `<tr><td class="px" style="padding:30px 40px 0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel};border-radius:14px;"><tr><td align="center" style="padding:26px 24px;"><div style="font-family:${SANS};font-size:11px;letter-spacing:2px;color:${C.mute};">${tr('ΠΟΣΟ ΠΟΥ ΕΠΙΣΤΡΕΦΕΤΑΙ', 'AMOUNT REFUNDED')}</div><div style="font-family:${SERIF};font-size:36px;line-height:44px;color:${C.deep};font-weight:600;padding:6px 0 8px 0;">${esc(euro(paid, lang))}</div><div style="font-family:${SANS};font-size:14px;line-height:22px;color:${C.body};">${tr('Επιστρέφεται με τον ίδιο τρόπο που πληρώθηκε.', 'It is returned the same way it was paid.')}</div></td></tr></table></td></tr>`,
        `\n${tr('Ποσό που επιστρέφεται', 'Amount refunded')}: ${euro(paid, lang)}`
      );
    }
    d.contact(tr('Θέλεις να μας μιλήσεις τώρα;', 'Want to talk to us now?'), tr('Μπορείς να μας καλέσεις όποτε θέλεις ή να απαντήσεις σε αυτό το email.', 'You can call us any time, or reply to this email.'));
    d.signoff(tr('Θα χαρούμε να σε φιλοξενήσουμε σύντομα.', 'We would be glad to host you soon.'), tr('Ευχαριστούμε για την κατανόηση,', 'Thank you for your understanding,'));
    return finish(d, {
      subject: tr('Για την κράτησή σου – θα βρούμε μαζί λύση', 'About your booking – we will find a solution together'),
      title: tr('Για την κράτησή σου – Life’s Moments', 'About your booking – Life’s Moments'),
      preheader: tr('Λυπούμαστε, δεν μπορούμε να σε φιλοξενήσουμε. Θα επικοινωνήσουμε μαζί σου για να βρούμε λύση, και το ποσό επιστρέφεται ολόκληρο.', 'We are sorry, we cannot host you. We will contact you to find a solution, and any amount paid is refunded in full.'),
      eyebrow: tr('ΕΝΗΜΕΡΩΣΗ ΓΙΑ ΤΗΝ ΚΡΑΤΗΣΗ ΣΟΥ', 'UPDATE ON YOUR BOOKING'),
      h1: tr('Λυπούμαστε,|θα βρούμε μαζί λύση', 'We are sorry,|we will find a solution together').split('|')
    }, g);
  }

  if (kind === 'rejected') {
    d.greeting(g.name, tr('Σε ευχαριστούμε για το ενδιαφέρον σου. Δυστυχώς δεν μπορούμε να δεχτούμε το αίτημά σου για αυτές τις ημερομηνίες. Δεν έχεις χρεωθεί τίποτα.', 'Thank you for your interest. Unfortunately we cannot accept your request for these dates. You have not been charged anything.'));
    d.card({ label: tr('ΤΟ ΑΙΤΗΜΑ ΣΟΥ', 'YOUR REQUEST'), g, center: true });
    if (site) d.button(tr('Δες άλλες ημερομηνίες', 'See other dates'), site, { top: 28 });
    d.contact(tr('Θες να το συζητήσουμε;', 'Would you like to talk it over?'), tr('Θα χαρούμε να σε βοηθήσουμε να βρεις ημερομηνίες που σου ταιριάζουν.', 'We would be happy to help you find dates that suit you.'));
    d.signoff(tr('Θα χαρούμε να σε δούμε στη Θάσο.', 'We hope to see you on Thasos.'), tr('Με εκτίμηση,', 'Kind regards,'));
    return finish(d, {
      subject: tr('Σχετικά με το αίτημά σου – Life’s Moments', 'About your request – Life’s Moments'),
      title: tr('Σχετικά με το αίτημά σου – Life’s Moments', 'About your request – Life’s Moments'),
      preheader: tr(`Δυστυχώς δεν μπορούμε να δεχτούμε το αίτημά σου για ${range}.`, `Unfortunately we cannot accept your request for ${range}.`),
      eyebrow: tr('ΣΧΕΤΙΚΑ ΜΕ ΤΟ ΑΙΤΗΜΑ ΣΟΥ', 'ABOUT YOUR REQUEST'),
      h1: tr('Λυπούμαστε,|δεν μπορούμε αυτή τη φορά', 'We are sorry,|we cannot this time').split('|')
    }, g);
  }

  // expired
  d.greeting(g.name, tr('Λυπούμαστε, δεν προλάβαμε να επιβεβαιώσουμε το αίτημά σου και έληξε. Δεν έχεις χρεωθεί τίποτα.', 'We are sorry, we could not confirm your request in time and it has expired. You have not been charged anything.'));
  d.card({ label: tr('ΤΟ ΑΙΤΗΜΑ ΣΟΥ', 'YOUR REQUEST'), g, center: true });
  if (site) d.button(tr('Στείλε νέο αίτημα', 'Send a new request'), site, { top: 28 });
  d.contact(tr('Προτιμάς να μιλήσουμε;', 'Prefer to talk?'), tr('Κάλεσέ μας και θα βρούμε μαζί τις ημερομηνίες που σου ταιριάζουν.', 'Call us and we will find the dates that suit you together.'));
  d.signoff(tr('Θα χαρούμε να σε δούμε στη Θάσο.', 'We hope to see you on Thasos.'), tr('Με εκτίμηση,', 'Kind regards,'));
  return finish(d, {
    subject: tr('Το αίτημά σου έληξε – Life’s Moments', 'Your request has expired – Life’s Moments'),
    title: tr('Το αίτημά σου έληξε – Life’s Moments', 'Your request has expired – Life’s Moments'),
    preheader: tr(`Δεν προλάβαμε να επιβεβαιώσουμε το αίτημά σου για ${range}.`, `We could not confirm your request for ${range} in time.`),
    eyebrow: tr('ΤΟ ΑΙΤΗΜΑ ΕΛΗΞΕ', 'REQUEST EXPIRED'),
    h1: tr('Δεν προλάβαμε|να σου απαντήσουμε', 'We did not manage|to reply in time').split('|')
  }, g);
}

// ---------- the offer ----------
const QUIET = new Set([10, 11, 12, 1, 2, 3, 4]); // months when the island is quiet

export function buildOfferMail(o: Offer, to: { name: string; lang: string }, s: Settings, unsubUrl: string): Mail {
  const lang = to.lang === 'en' ? 'en' : 'el';
  const d = new Doc(lang, s);
  const { tr } = d;
  const pct = Math.round(Number(o.discount_pct));
  const code = clean(o.code);
  const stays = fmtMonthDay(o.stay_from, lang) + ' – ' + fmtMonthDay(o.stay_to, lang);
  const bookBy = o.book_by ? fmtMonthDay(o.book_by, lang) : '';
  let link = clean(s.site_url);
  if (link) { try { const u = new URL(link); if (code) u.searchParams.set('promo', code); link = u.toString(); } catch { /* keep as is */ } }
  const quiet = QUIET.has(dateOf(o.stay_from).getUTCMonth() + 1) && QUIET.has(dateOf(o.stay_to).getUTCMonth() + 1);

  d.greeting(to.name, tr('Πέρασε λίγος καιρός από την τελευταία φορά που μας επισκέφτηκες και θα χαρούμε να σε δούμε ξανά. Γι’ αυτό ετοιμάσαμε μια προσφορά μόνο για τους επισκέπτες μας.', 'It has been a little while since your last visit and we would love to see you again. So we have prepared an offer just for our guests.'));
  d.raw(
    `<tr><td class="px" style="padding:24px 40px 8px 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel};border:1px solid ${C.line};border-radius:14px;">` +
    `<tr><td align="center" style="padding:30px 24px 10px 24px;"><div style="font-family:${SANS};font-size:11px;letter-spacing:2px;color:${C.mute};">${tr('Η ΕΚΠΤΩΣΗ ΣΟΥ', 'YOUR DISCOUNT')}</div><div class="big" style="font-family:${SERIF};font-size:72px;line-height:76px;color:${C.brand};font-weight:600;padding:8px 0 4px 0;">&minus;${pct}%</div><div style="font-family:${SANS};font-size:15px;line-height:22px;color:${C.body};">${tr('σε όλες τις διανυκτερεύσεις', 'on every night')}</div></td></tr>` +
    `<tr><td style="padding:16px 24px 0 24px;"><div style="border-top:1px solid ${C.line};font-size:0;line-height:0;">&nbsp;</div></td></tr>` +
    `<tr><td style="padding:0 24px 24px 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td width="${bookBy ? 50 : 100}%" align="center" valign="top" style="font-family:${SANS};text-align:center;"><div style="font-size:12px;color:${C.mute};">${tr('ΙΣΧΥΕΙ ΓΙΑ ΔΙΑΜΟΝΕΣ', 'VALID FOR STAYS')}</div><div style="font-size:15px;color:${C.ink};font-weight:600;padding-top:3px;">${esc(stays)}</div></td>` +
    (bookBy ? `<td width="50%" align="center" valign="top" style="font-family:${SANS};text-align:center;"><div style="font-size:12px;color:${C.mute};">${tr('ΚΡΑΤΗΣΕ ΕΩΣ', 'BOOK BY')}</div><div style="font-size:15px;color:${C.ink};font-weight:600;padding-top:3px;">${esc(bookBy)}</div></td>` : '') +
    `</tr></table></td></tr></table></td></tr>`,
    `${tr('ΕΚΠΤΩΣΗ', 'DISCOUNT')} −${pct}% ${tr('σε όλες τις διανυκτερεύσεις', 'on every night')}\n${tr('Ισχύει για διαμονές', 'Valid for stays')}: ${stays}${bookBy ? `\n${tr('Κράτησε έως', 'Book by')}: ${bookBy}` : ''}`
  );
  if (code) {
    d.raw(
      `<tr><td class="px" align="center" style="padding:20px 40px 0 40px;"><div style="font-family:${SANS};font-size:13px;line-height:20px;color:${C.mute};padding-bottom:8px;">${tr('Ο κωδικός μπαίνει αυτόματα όταν πατήσεις το κουμπί:', 'The code is added automatically when you press the button:')}</div><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#ffffff" style="border:1.5px dashed ${C.brand};border-radius:10px;padding:12px 28px;font-family:${SANS};font-size:20px;letter-spacing:4px;font-weight:700;color:${C.deep};">${esc(code)}</td></tr></table></td></tr>`,
      `${tr('Κωδικός', 'Code')}: ${code}`
    );
  }
  if (link) d.button(tr('Κάνε κράτηση τώρα', 'Book now'), link, { top: 28, textLine: `${tr('Κάνε κράτηση', 'Book')}: ${link}` });
  d.heading(tr('Γιατί να έρθεις τώρα', 'Why come now'), 38);
  d.bullets([
    quiet
      ? { bold: tr('Ηρεμία:', 'Peace:'), text: tr('η Θάσος είναι πιο ήσυχη και χωρίς το πλήθος του καλοκαιριού.', 'Thasos is quieter, without the summer crowds.') }
      : { bold: tr('Ξεκούραση:', 'Rest:'), text: tr('μέρες δίπλα στη θάλασσα, χωρίς βιασύνη.', 'unhurried days by the sea.') },
    { bold: tr('Δίπλα στη θάλασσα:', 'By the sea:'), text: tr('το ίδιο μέρος που ήδη αγάπησες, σε καλύτερη τιμή.', 'the same place you already loved, at a better price.') },
    { bold: tr('Απλά και άμεσα:', 'Simple and quick:'), text: tr('στέλνεις το αίτημά σου και σου απαντάμε εντός 24 ωρών.', 'you send your request and we reply within 24 hours.') }
  ]);
  d.note(tr('Η προσφορά ισχύει για περιορισμένο χρονικό διάστημα, με βάση τη διαθεσιμότητα, και δεν συνδυάζεται με άλλες εκπτώσεις.', 'The offer is for a limited time, subject to availability, and cannot be combined with other discounts.'), 24);
  d.contact(tr('Χρειάζεσαι κάτι;', 'Need anything?'), tr('Θα χαρούμε να σε βοηθήσουμε να βρεις τις ημερομηνίες που σου ταιριάζουν.', 'We would be glad to help you find the dates that suit you.'));
  d.signoff(tr('Ήσυχα, δίπλα στη θάλασσα.', 'Quiet, by the sea.'), tr('Ανυπομονούμε να σε δούμε ξανά,', 'We look forward to seeing you again,'));

  const addr = oneLine(s.address);
  const reason = tr('Λαμβάνεις αυτό το μήνυμα επειδή έχεις μείνει σε εμάς και είχες δηλώσει ότι θέλεις να λαμβάνεις προσφορές. Αν δεν θες άλλες, ', 'You are receiving this because you stayed with us and said you would like to hear about offers. If you do not want more, ');
  const unsubLabel = tr('διαγράψου από τη λίστα', 'unsubscribe');
  return finish(d, {
    subject: tr(`Σου λείπει η Θάσος; Ειδική προσφορά −${pct}% για σένα`, `Missing Thasos? A special −${pct}% offer for you`),
    title: tr('Σου λείπει η Θάσος; – Life’s Moments', 'Missing Thasos? – Life’s Moments'),
    preheader: tr(`Ειδική προσφορά −${pct}% για διαμονές στο Life’s Moments. Ισχύει για περιορισμένο χρονικό διάστημα.`, `A special −${pct}% offer for stays at Life’s Moments. Valid for a limited time.`),
    eyebrow: tr('ΕΙΔΙΚΗ ΠΡΟΣΦΟΡΑ', 'SPECIAL OFFER'),
    h1: tr('Σου λείπει|η Θάσος;', 'Missing|Thasos?').split('|'),
    footerHtml: `Life&#8217;s Moments${addr ? ' · ' + esc(addr) : ''}<br>${esc(reason)}<a href="${esc(unsubUrl)}" style="color:${C.faint};text-decoration:underline;">${esc(unsubLabel)}</a>.`,
    footerText: `\n--\nLife’s Moments${addr ? ' · ' + addr : ''}\n${reason}${unsubLabel}: ${unsubUrl}`
  });
}

// ---------- a message an owner writes to a guest in the admin (Μηνύματα) ----------
// Sent by the guest-message function. Same look as the other guest emails: the owner's words in a letter
// block, a reply button (when there is a reply-to address), the booking card and the phone line.
export function buildMessageMail(g: Guest, body: string, s: Settings): Mail {
  const lang = g.lang === 'en' ? 'en' : 'el';
  const d = new Doc(lang, s);
  const { tr } = d;
  const text = String(body ?? '').replace(/\r/g, '').trim();
  const ref = refText(g);
  const subject = tr('Μήνυμα για την κράτησή σου – Life’s Moments', 'A message about your booking – Life’s Moments');
  const replyTo = clean(s.reply_to);

  d.raw(
    `<tr><td class="px" style="padding:36px 40px 0 40px;font-family:${SANS};font-size:16px;line-height:26px;color:${C.ink};">${tr('Γεια σου', 'Hello')} <strong>${esc(firstName(g.name))}</strong>,<br>${esc(tr('οι οικοδεσπότες σου στο Life’s Moments σού έγραψαν:', 'your hosts at Life’s Moments wrote to you:'))}</td></tr>`,
    `${tr('Γεια σου', 'Hello')} ${firstName(g.name)},\n${tr('οι οικοδεσπότες σου στο Life’s Moments σού έγραψαν:', 'your hosts at Life’s Moments wrote to you:')}`
  );
  d.raw(
    `<tr><td class="px" style="padding:20px 40px 0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.panel};border-radius:14px;"><tr>` +
    `<td width="4" bgcolor="${C.brand}" style="width:4px;background:${C.brand};border-radius:14px 0 0 14px;font-size:0;line-height:0;">&nbsp;</td>` +
    `<td style="padding:24px 26px 22px 24px;">` +
    `<div style="font-family:${SERIF};font-size:40px;line-height:22px;color:#9bb8d6;height:22px;">&ldquo;</div>` +
    `<div style="font-family:${SANS};font-size:17px;line-height:28px;color:${C.ink};padding-top:6px;">${nl(text)}</div>` +
    `<div style="font-family:${SANS};font-size:13px;line-height:20px;color:${C.mute};padding-top:16px;">${esc(tr('— Οι οικοδεσπότες σου', '— Your hosts'))}</div>` +
    `</td></tr></table></td></tr>`,
    '\n' + text + '\n' + tr('— Οι οικοδεσπότες σου', '— Your hosts')
  );
  if (replyTo) {
    const href = 'mailto:' + replyTo + '?subject=' + encodeURIComponent('Re: ' + subject);
    d.button(tr('Απάντησε στο μήνυμα', 'Reply to this message'), href, { top: 28, textLine: tr('Μπορείς να απαντήσεις κατευθείαν σε αυτό το email.', 'You can reply directly to this email.') });
    d.raw(`<tr><td class="px" align="center" style="padding:4px 40px 0 40px;font-family:${SANS};font-size:13px;line-height:20px;color:${C.faint};">${esc(tr('ή απλώς πάτησε «Απάντηση» σε αυτό το email', 'or simply hit “Reply” on this email'))}</td></tr>`);
  }
  // a compact booking box: dates on one line, the stay facts under them
  const nights = nightsOf(g.check_in, g.check_out);
  const facts = [unitName(g, lang), nights + ' ' + (nights === 1 ? tr('νύχτα', 'night') : tr('νύχτες', 'nights')), guestsText(g.guests, lang)].join(' · ');
  d.raw(
    `<tr><td class="px" style="padding:30px 40px 0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid ${C.line};border-radius:14px;"><tr><td style="padding:18px 22px 20px 22px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="font-family:${SANS};font-size:11px;letter-spacing:2px;color:${C.mute};">${esc(tr('Η ΚΡΑΤΗΣΗ ΣΟΥ', 'YOUR BOOKING'))}</td>` +
    (ref ? `<td align="right" style="font-family:${SANS};font-size:13px;color:${C.brand};font-weight:600;">${esc(ref)}</td>` : '') + `</tr></table>` +
    `<div style="font-family:${SERIF};font-size:21px;line-height:28px;color:${C.deep};font-weight:600;padding-top:10px;">${esc(fmtShort(g.check_in, lang))} <span style="color:#9bb8d6;font-weight:400;">&rarr;</span> ${esc(fmtShort(g.check_out, lang))}</div>` +
    `<div style="font-family:${SANS};font-size:14px;line-height:22px;color:${C.body};padding-top:4px;">${esc(facts)}</div>` +
    `</td></tr></table></td></tr>`,
    `${tr('Η κράτησή σου', 'Your booking')}${ref ? ' ' + ref : ''}: ${fmtDay(g.check_in, lang)} – ${fmtDay(g.check_out, lang)} · ${facts}`
  );
  d.contact(tr('Προτιμάς να μιλήσουμε;', 'Rather talk?'), tr('Πάρε μας τηλέφωνο όποτε σε βολεύει.', 'Give us a call whenever suits you.'));
  d.signoff(tr('Ήσυχα, δίπλα στη θάλασσα.', 'Quiet, by the sea.'), tr('Με εκτίμηση,', 'Kind regards,'));

  const addr = oneLine(s.address);
  const why = ref
    ? tr(`Το μήνυμα σού το έστειλαν οι ιδιοκτήτες για την κράτηση ${ref}.`, `This message was sent by the owners about booking ${ref}.`)
    : tr('Το μήνυμα σού το έστειλαν οι ιδιοκτήτες για την κράτησή σου.', 'This message was sent by the owners about your booking.');
  const short = text.replace(/\s+/g, ' ');
  return finish(d, {
    subject,
    title: subject,
    preheader: short.length > 110 ? short.slice(0, 107) + '…' : short,
    eyebrow: tr('ΝΕΟ ΜΗΝΥΜΑ', 'NEW MESSAGE'),
    h1: tr('Ένα μήνυμα|για την κράτησή σου', 'A message|about your booking').split('|'),
    footerHtml: `Life&#8217;s Moments${addr ? ' · ' + esc(addr) : ''}<br>${esc(why)}`,
    footerText: `\n--\nLife’s Moments${addr ? ' · ' + addr : ''}\n${why}`
  }, g);
}
