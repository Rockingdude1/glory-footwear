// Checks the submitted password against the ADMIN_PASSWORD environment
// variable (set in the Vercel dashboard — never committed to the repo, never
// sent to the browser except in this one request when someone actually types
// it in). On success, sets an HttpOnly session cookie that /api/catalog.js
// checks to decide whether to include real stock numbers.
//
// The cookie value is a deterministic HMAC of a fixed string, keyed by the
// admin password itself — this avoids needing a second secret just for
// signing sessions, at the cost of the session being invalidated automatically
// if you ever change ADMIN_PASSWORD (a reasonable trade for how small this is).

const crypto = require('crypto');

const SESSION_MESSAGE = 'glory-admin-session';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

function computeSessionToken(secret){
  return crypto.createHmac('sha256', secret).update(SESSION_MESSAGE).digest('hex');
}

module.exports = async (req, res) => {
  if(req.method !== 'POST'){
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const secret = process.env.ADMIN_PASSWORD;
  if(!secret){
    res.status(500).json({ error: 'ADMIN_PASSWORD is not configured on the server' });
    return;
  }

  let body = req.body;
  if(typeof body === 'string'){
    try { body = JSON.parse(body || '{}'); } catch(e) { body = {}; }
  }
  const password = body && body.password;

  if(password !== secret){
    res.status(401).json({ error: 'Incorrect password' });
    return;
  }

  const token = computeSessionToken(secret);
  res.setHeader('Set-Cookie',
    `glory_admin=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${THIRTY_DAYS}; Path=/`
  );
  res.status(200).json({ ok: true });
};
