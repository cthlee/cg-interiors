/* ============================================================
   CG INTERIORS — Inquiry endpoint  (Cloudflare Pages Function)
   Route:  POST /api/inquiry
   Flow:   validate → honeypot → Turnstile → save to D1 → email

   Bindings / env (set in Cloudflare dashboard or wrangler):
     DB                  D1 database binding (required)
     RESEND_API_KEY      secret — Resend API key (email)
     TURNSTILE_SECRET    secret — Cloudflare Turnstile secret
     FROM_EMAIL          e.g. "CG Interiors <studio@camposgoldberg.com>"
     STUDIO_INBOX        where alerts land, e.g. "studio@camposgoldberg.com"

   Degrades gracefully: a missing RESEND/TURNSTILE key skips that step
   (so you can wire the database first and add email later) — the lead
   is always saved before any email is attempted, so it is never lost.
   ============================================================ */

const PROJECT_TYPES = ['Full Residence', 'Single Room / Partial', 'New Build', 'Boutique Commercial', 'Other'];
const MAX = { name: 120, email: 160, location: 160, budget: 60, message: 4000 };

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return json({ error: 'Malformed request.' }, 400);
  }

  // 1 — Honeypot: bots fill the hidden "company" field. Pretend success.
  if (body.company) return json({ ok: true }, 200);

  // 2 — Validate
  const data = {
    name: clean(body.name, MAX.name),
    email: clean(body.email, MAX.email),
    type: clean(body.type, 80),
    location: clean(body.location, MAX.location),
    budget: clean(body.budget, MAX.budget),
    message: clean(body.message, MAX.message),
  };
  const errors = [];
  if (!data.name) errors.push('name');
  if (!isEmail(data.email)) errors.push('email');
  if (!data.type || PROJECT_TYPES.indexOf(data.type) === -1) errors.push('type');
  if (!data.message || data.message.length < 12) errors.push('message');
  if (errors.length) return json({ error: 'Please review the highlighted fields.', fields: errors }, 422);

  // 3 — Turnstile (skip only if no secret configured yet)
  if (env.TURNSTILE_SECRET) {
    const token = body['cf-turnstile-response'];
    const ok = await verifyTurnstile(token, env.TURNSTILE_SECRET, request.headers.get('CF-Connecting-IP'));
    if (!ok) return json({ error: 'Verification failed. Please try again.' }, 403);
  }

  // 4 — Persist (the lead is safe from here on)
  if (!env.DB) return json({ error: 'Server not configured.' }, 500);
  let inquiryId;
  try {
    const res = await env.DB.prepare(
      `INSERT INTO inquiries (name, email, project_type, location, budget, message, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      data.name, data.email, data.type,
      data.location || null, data.budget || null, data.message,
      request.headers.get('CF-Connecting-IP') || null,
      (request.headers.get('User-Agent') || '').slice(0, 300)
    ).run();
    inquiryId = res.meta && res.meta.last_row_id;
  } catch (err) {
    return json({ error: 'We could not save your inquiry. Please email us directly.' }, 500);
  }

  // 5 — Email (best-effort; never blocks the saved lead)
  let emailed = false;
  if (env.RESEND_API_KEY) {
    const from = env.FROM_EMAIL || 'CG Interiors <contact@camposgoldberg.com>';
    const studioInbox = env.STUDIO_INBOX || 'isadoraterci@gmail.com';
    // Public brand address (from within FROM_EMAIL) — where client replies land.
    const publicEmail = (from.match(/<([^>]+)>/) || [, from])[1];
    const results = await Promise.allSettled([
      sendEmail(env.RESEND_API_KEY, {
        from, to: data.email, reply_to: publicEmail,
        ...autoReplyEmail(data),
      }),
      sendEmail(env.RESEND_API_KEY, {
        from, to: studioInbox, reply_to: data.email,
        ...studioAlertEmail(data, inquiryId),
      }),
    ]);
    emailed = results.every((r) => r.status === 'fulfilled');
  }

  return json({ ok: true, id: inquiryId, emailed }, 200);
}

/* ---------- helpers ---------- */

function clean(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function isEmail(v) {
  return typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= MAX.email;
}
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function verifyTurnstile(token, secret, ip) {
  if (!token) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const out = await r.json();
    return !!out.success;
  } catch (_) {
    return false;
  }
}

async function sendEmail(apiKey, payload) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error('Resend ' + r.status);
  return r.json();
}

/* ---------- email templates (inline styles for client compatibility) ---------- */

function shell(inner) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#F3EFE8;padding:32px 16px;font-family:Georgia,'Times New Roman',serif;color:#1C1914;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#FAF8F4;border:1px solid #E4DED3;">
<tr><td style="padding:40px 44px;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:4px;text-transform:uppercase;color:#1C1914;">Campos&nbsp;Goldberg</div>
<div style="font-family:Arial,Helvetica,sans-serif;font-size:9px;letter-spacing:5px;text-transform:uppercase;color:#8A6335;margin-top:4px;">Interiors — New York</div>
<div style="height:1px;background:#E4DED3;margin:26px 0;"></div>
${inner}
</td></tr>
<tr><td style="padding:22px 44px;background:#1C1914;color:#FAF8F4;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;">
42 Howard Street, Floor 4 · New York, NY&nbsp;10013
</td></tr>
</table></body></html>`;
}

function autoReplyEmail(data) {
  const first = esc((data.name.split(/\s+/)[0]) || 'there');
  const inner = `
<h1 style="font-size:28px;font-weight:normal;line-height:1.2;margin:0 0 20px;">Thank you, ${first}.</h1>
<p style="font-size:16px;line-height:1.7;margin:0 0 18px;">Your inquiry has reached the studio, and we are glad it did. A member of our team will read it personally and respond within <strong>two business days</strong>.</p>
<p style="font-size:16px;line-height:1.7;margin:0 0 26px;">In the meantime, here is what you shared with us:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;">
${row('Project', esc(data.type))}
${data.location ? row('Location', esc(data.location)) : ''}
${data.budget ? row('Budget', esc(data.budget)) : ''}
</table>
<div style="height:1px;background:#E4DED3;margin:28px 0;"></div>
<p style="font-size:15px;line-height:1.7;margin:0;font-style:italic;color:#33302A;">With warm regards,<br>Campos Goldberg Interiors</p>`;
  return { subject: 'We’ve received your inquiry — Campos Goldberg Interiors', html: shell(inner), text: autoReplyText(data, first) };
}

function studioAlertEmail(data, id) {
  const inner = `
<h1 style="font-size:24px;font-weight:normal;line-height:1.2;margin:0 0 20px;">New inquiry received</h1>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;">
${row('Name', esc(data.name))}
${row('Email', `<a href="mailto:${esc(data.email)}" style="color:#8A6335;">${esc(data.email)}</a>`)}
${row('Project', esc(data.type))}
${row('Location', esc(data.location) || '—')}
${row('Budget', esc(data.budget) || '—')}
</table>
<div style="height:1px;background:#E4DED3;margin:22px 0;"></div>
<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8A6335;margin:0 0 10px;">Message</p>
<p style="font-size:16px;line-height:1.7;margin:0;white-space:pre-wrap;">${esc(data.message)}</p>
<p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#A2988A;margin:26px 0 0;">Inquiry #${esc(id)} · reply directly to this email to reach ${esc(data.name.split(/\s+/)[0])}.</p>`;
  return { subject: `New inquiry — ${data.name} · ${data.type}`, html: shell(inner), text: studioAlertText(data, id) };
}

function row(label, value) {
  return `<tr>
<td style="padding:6px 0;color:#8A6335;text-transform:uppercase;letter-spacing:1.5px;font-size:11px;width:96px;vertical-align:top;">${label}</td>
<td style="padding:6px 0;color:#1C1914;">${value}</td></tr>`;
}
function autoReplyText(data, first) {
  return `Thank you, ${first}.

Your inquiry has reached the studio. A member of our team will respond personally within two business days.

What you shared:
- Project: ${data.type}${data.location ? `\n- Location: ${data.location}` : ''}${data.budget ? `\n- Budget: ${data.budget}` : ''}

With warm regards,
Campos Goldberg Interiors
42 Howard Street, Floor 4, New York, NY 10013`;
}
function studioAlertText(data, id) {
  return `New inquiry #${id}

Name: ${data.name}
Email: ${data.email}
Project: ${data.type}
Location: ${data.location || '—'}
Budget: ${data.budget || '—'}

Message:
${data.message}`;
}
