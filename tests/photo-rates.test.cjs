const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

async function photoReply(output) {
  const messages = [];
  const context = {
    Intl, Buffer, console,
    process: { env: { TELEGRAM_BOT_TOKEN: 'test', OPENAI_API_KEY: 'test' } },
    fetch: async (url, options) => {
      if (url.endsWith('/getFile')) return { json: async () => ({ ok: true, result: { file_path: 'test.jpg' } }) };
      if (url.includes('/file/bot')) return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new ArrayBuffer(1) };
      if (url.endsWith('/responses')) return { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: output }] }] }) };
      if (url.endsWith('/sendMessage')) {
        messages.push(JSON.parse(options.body));
        return { json: async () => ({ ok: true, result: {} }) };
      }
      throw new Error('Unexpected request: ' + url);
    }
  };
  vm.createContext(context);
  vm.runInContext(read('api/webhook.js').replace('export default async function handler', 'async function handler'), context);
  const res = { status() { return this; }, json() {} };
  await context.handler({ method: 'POST', body: { message: { chat: { id: 1 }, photo: [{ file_id: 'photo' }] } } }, res);
  return messages;
}

function calculator(search, saved = {}) {
  const elements = {};
  const defaults = { uzs: '455000', usdRub: '86.5', usdUzs: '11770', usdInput: '100' };
  const storage = new Map(Object.entries(saved));
  const context = {
    Intl, URLSearchParams, location: { search },
    document: { getElementById(id) {
      return elements[id] ||= { value: defaults[id] || '', textContent: '', addEventListener() {} };
    } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  };
  vm.createContext(context);
  vm.runInContext(read('index.html').match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { elements, storage, context };
}

test('chat returns UZS and carries amount to Mini App without currency conversion', async () => {
  const [reply] = await photoReply('120000');
  assert.match(reply.text, /120\s000 сум/);
  assert.doesNotMatch(reply.text, /₽|\$|86\.5|11770/);
  assert.match(reply.text, /Мои курсы/);
  const url = new URL(reply.reply_markup.inline_keyboard[0][0].web_app.url);
  assert.equal(url.searchParams.get('uzs'), '120000');
  for (const [usdRub, usdUzs, expected] of [['90', '12000', '900,00 ₽'], ['80', '10000', '960,00 ₽']]) {
    const { elements, storage } = calculator(url.search, { usdRub, usdUzs });
    assert.equal(elements.rubResult.textContent, expected);
    assert.equal(storage.get('usdRub'), usdRub);
    assert.equal(storage.get('usdUzs'), usdUzs);
  }
});

test('unreadable photo produces retry message without calculator result', async () => {
  for (const output of ['NONE', '', '0']) {
    const [reply] = await photoReply(output);
    assert.match(reply.text, /Не смог уверенно распознать/);
    assert.equal(reply.reply_markup, undefined);
  }
});

test('absent settings retain existing defaults; invalid rates show no result', () => {
  const { elements, context } = calculator('?uzs=11770');
  assert.equal(elements.rubResult.textContent, '86,50 ₽');
  assert.equal(elements.usdResult.textContent, '$1,00');
  elements.usdRub.value = '0';
  vm.runInContext('calculate()', context);
  assert.equal(elements.rubResult.textContent, '—');
});
