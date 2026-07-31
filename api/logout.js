// Clears the admin session cookie set by login.js.
module.exports = async (req, res) => {
  res.setHeader('Set-Cookie', 'glory_admin=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');
  res.status(200).json({ ok: true });
};
