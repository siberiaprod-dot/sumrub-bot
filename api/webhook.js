const TELEGRAM_API = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

function fmt(value, digits = 2) {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

async function telegram(token, method, body) {
  const r = await fetch(TELEGRAM_API(token, method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${JSON.stringify(data)}`);
  return data.result;
}

function extractOutputText(response) {
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
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!tgToken || !openaiKey) {
    console.error('Missing TELEGRAM_BOT_TOKEN or OPENAI_API_KEY');
    return res.status(200).json({ ok: true });
  }

  try {
    const update = req.body || {};
    const message = update.message || update.edited_message;
    if (!message) return res.status(200).json({ ok: true });

    const chatId = message.chat?.id;
    if (!chatId) return res.status(200).json({ ok: true });

    if (message.text === '/start') {
      await telegram(tgToken, 'sendMessage', {
        chat_id: chatId,
        text: '💱 Валютный калькулятор\n\nОтправь фото ценника или чека — я распознаю сумму в сумах и сразу покажу эквивалент в рублях и долларах.\n\nКалькулятор открывается кнопкой внизу.',
      });
      return res.status(200).json({ ok: true });
    }

    if (!Array.isArray(message.photo) || message.photo.length === 0) {
      await telegram(tgToken, 'sendMessage', {
        chat_id: chatId,
        text: 'Пришли фото ценника или чека с суммой в UZS 📸',
      });
      return res.status(200).json({ ok: true });
    }

    const largest = message.photo[message.photo.length - 1];
    const file = await telegram(tgToken, 'getFile', { file_id: largest.file_id });
    const fileUrl = `https://api.telegram.org/file/bot${tgToken}/${file.file_path}`;

    const imageResp = await fetch(fileUrl);
    if (!imageResp.ok) throw new Error(`Could not download Telegram image: ${imageResp.status}`);
    const contentType = imageResp.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await imageResp.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const dataUrl = `data:${contentType};base64,${base64}`;

    const aiResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-6-luna',
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Read the main price or final total in Uzbek soum (UZS) from this image. If there are several numbers, choose the visually prominent payable/total price. Return ONLY the integer amount in UZS using digits with no spaces, separators, currency symbols, or explanation. If no reliable UZS price is visible, return NONE.'
            },
            {
              type: 'input_image',
              image_url: dataUrl,
              detail: 'low'
            }
          ]
        }]
      }),
    });

    const aiJson = await aiResp.json();
    if (!aiResp.ok) throw new Error(`OpenAI error: ${JSON.stringify(aiJson)}`);

    const text = extractOutputText(aiJson).trim();
    const digits = text.replace(/\D/g, '');
    const amount = Number(digits);

    if (!digits || !Number.isFinite(amount) || amount <= 0) {
      await telegram(tgToken, 'sendMessage', {
        chat_id: chatId,
        text: 'Не смог уверенно распознать цену. Попробуй сфотографировать ценник крупнее и ровнее.',
      });
      return res.status(200).json({ ok: true });
    }

    const USD_RUB = 86.5;
    const USD_UZS = 11770;
    const usd = amount / USD_UZS;
    const rub = usd * USD_RUB;

    await telegram(tgToken, 'sendMessage', {
      chat_id: chatId,
      text:
        `📸 Распознал: ${fmt(amount, 0)} сум\n\n` +
        `🇷🇺 ≈ ${fmt(rub, 2)} ₽\n` +
        `🇺🇸 ≈ $${fmt(usd, 2)}\n\n` +
        `Курс расчёта: $1 = ${fmt(USD_RUB, 2)} ₽ → ${fmt(USD_UZS, 0)} сум`,
      reply_markup: {
        inline_keyboard: [[
          {
            text: 'Открыть калькулятор',
            web_app: { url: `https://sumrub-bot.vercel.app/?uzs=${amount}` }
          }
        ]]
      }
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    try {
      const chatId = req.body?.message?.chat?.id;
      const tgToken = process.env.TELEGRAM_BOT_TOKEN;
      if (chatId && tgToken) {
        await telegram(tgToken, 'sendMessage', {
          chat_id: chatId,
          text: 'Произошла ошибка при обработке фото. Попробуй ещё раз через несколько секунд.',
        });
      }
    } catch (_) {}
    return res.status(200).json({ ok: true });
  }
}
