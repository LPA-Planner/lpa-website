// /functions/api/enquiry.js
// Cloudflare Pages Function: handles POSTed form data and sends via MailChannels.
// Requires two environment variables set in your Pages project:
//   TO_EMAIL   -> where to send enquiries
//   FROM_EMAIL -> the sender address (use an address at your domain, e.g. no-reply@yourdomain)

export async function onRequestPost(context) {
  const { request, env } = context;
  const contentType = request.headers.get("content-type") || "";
  let fields = {};

  try {
    if (contentType.includes("application/json")) {
      fields = await request.json();
    } else if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const formData = await request.formData();
      fields = Object.fromEntries(formData.entries());
    } else {
      return json(400, { error: "Unsupported content type" });
    }
  } catch (err) {
    return json(400, { error: "Invalid request body" });
  }

  // Honeypot: silently accept bots
  if (fields._gotcha) {
    return finish(request, fields._next);
  }

  // Build subject and body using whatever fields your form posted.
  const subject = fields._subject || "New enquiry";
  const origin = safeOrigin(request.url);
  const pairs = Object.entries(fields).filter(([k]) => !k.startsWith("_"));

  const textBody =
    `You have a new enquiry:\n\n` +
    pairs.map(([k, v]) => `${k}: ${String(v)}`).join("\n") +
    `\n\n--\nSent from ${origin}`;

  const htmlBody =
    `<h2>New enquiry</h2>` +
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;">` +
    pairs
      .map(
        ([k, v]) =>
          `<tr><th align="left" style="padding:4px 8px 4px 0;">${escapeHTML(
            k
          )}</th><td style="padding:4px 0;">${escapeHTML(String(v))}</td></tr>`
      )
      .join("") +
    `</table><hr><p style="color:#666;">Sent from ${escapeHTML(origin)}</p>`;

  const replyTo =
    fields.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)
      ? fields.email
      : env.FROM_EMAIL;

  // Compose MailChannels payload
  const payload = {
    personalizations: [{ to: [{ email: env.TO_EMAIL }] }],
    from: { email: env.FROM_EMAIL, name: "Website Enquiries" },
    reply_to: { email: replyTo },
    subject,
    content: [
      { type: "text/plain", value: textBody },
      { type: "text/html", value: htmlBody },
    ],
  };

  // Send email via MailChannels
  const mcRes = await fetch("https://api.mailchannels.net/tx/v1/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!mcRes.ok) {
    const detail = await mcRes.text();
    return json(500, { error: "Mail send failed", detail });
  }

  // All good — redirect browsers or return JSON for programmatic clients
  return finish(request, fields._next);
}

/* ---------- Helpers ---------- */
function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function finish(request, next) {
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/html")) {
    // Redirect human submissions to a thank-you page
    const location = next || "/thanks.html";
    return new Response(null, { status: 303, headers: { Location: location } });
  }
  return json(200, { ok: true });
}

function escapeHTML(str = "") {
  return str.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}
