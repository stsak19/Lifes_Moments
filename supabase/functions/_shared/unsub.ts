// Signed unsubscribe links for the offer emails: the token is an HMAC of the address, made with the
// server's cron secret, so nobody can unsubscribe someone else's address by guessing a link.
const enc = new TextEncoder();

export async function unsubToken(secret: string, email: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('unsub:' + email.trim().toLowerCase())));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

export async function unsubValid(secret: string, email: string, token: string): Promise<boolean> {
  const want = await unsubToken(secret, email);
  if (token.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

/** The link in the email and in the List-Unsubscribe header (the function answers a one-click POST). */
export async function unsubUrl(functionsBase: string, secret: string, email: string): Promise<string> {
  const e = email.trim().toLowerCase();
  return functionsBase.replace(/\/$/, '') + '/unsubscribe?e=' + encodeURIComponent(e) + '&t=' + (await unsubToken(secret, e));
}
