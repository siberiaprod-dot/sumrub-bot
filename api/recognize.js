function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text;
  for (const item of response.output || []) {
    if (item.type === 'message') {
      for (const c of item.content || []) {
        if (c.type === 'output_text' && typeof c.text === 'string') return c.text;
      }
    }
  }
  return '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return res.status(500).json({ ok: false, error: 'OPENAI_API_KEY is not configured' });

  try {
    const image = req.body?.image;
    if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
      return res.status(400).json({ ok: false, error: 'Image is required' });
    }

    const aiResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-6-luna',
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Determine the amount in Uzbek soum (UZS) that the user most likely wants to convert. For a receipt, prefer the final payable total (Итого к оплате / Всего / total), not individual item prices. For a price tag, use the main displayed price. Return ONLY one integer in UZS, digits only, with no spaces or explanation. If you cannot determine it reliably, return NONE.'
            },
            {
              type: 'input_image',
              image_url: image,
              detail: 'high'
            }
          ]
        }],
        max_output_tokens: 40
      })
    });

    const aiJson = await aiResp.json();
    if (!aiResp.ok) {
      console.error('OpenAI error', aiJson);
      return res.status(502).json({ ok: false, error: aiJson?.error?.message || 'OpenAI request failed' });
    }

    const text = extractOutputText(aiJson).trim();
    if (text === 'NONE') return res.status(422).json({ ok: false, error: 'Не удалось уверенно распознать сумму' });

    const digits = text.replace(/\D/g, '');
    const amount = Number(digits);
    if (!digits || !Number.isFinite(amount) || amount <= 0) {
      return res.status(422).json({ ok: false, error: 'Не удалось уверенно распознать сумму' });
    }

    return res.status(200).json({ ok: true, amount });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: err?.message || 'Ошибка обработки изображения' });
  }
}
