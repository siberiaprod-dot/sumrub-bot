export default async function handler(req, res) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(500).json({ ok: false, error: 'Missing TELEGRAM_BOT_TOKEN' });

  const webhookUrl = 'https://sumrub-bot.vercel.app/api/webhook';
  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl, drop_pending_updates: true }),
  });

  const data = await r.json();
  return res.status(r.ok ? 200 : 500).json({
    ...data,
    webhook: webhookUrl,
  });
}
