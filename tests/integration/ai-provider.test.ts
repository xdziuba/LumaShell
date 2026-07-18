/**
 * Test integracyjny dostawcy AI zgodnego z OpenAI (AI-0).
 *
 * Mock-serwer HTTP udaje endpointy OpenAI: /v1/models i /v1/chat/completions (strumień SSE).
 * Sprawdzamy listę modeli, sklejanie strumienia czatu, wywołania onDelta oraz czytelny błąd
 * przy złym kluczu — bez trafiania do prawdziwego API.
 *
 * Uruchomienie: node --experimental-transform-types tests/integration/ai-provider.test.ts
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAiCompatibleProvider } from '../../src/services/ai/openai-compatible.ts';
import { AnthropicProvider } from '../../src/services/ai/anthropic-provider.ts';

const wyniki: Array<{ n: string; ok: boolean; d?: string }> = [];
const sprawdz = (n: string, ok: boolean, d?: string): void => {
  wyniki.push({ n, ok, d });
};

async function main(): Promise<void> {
  // Ostatni ładunek wysłany do /v1/messages — do sprawdzenia rozbicia promptu systemowego.
  let lastAnthropicBody: Record<string, unknown> = {};

  const server = createServer((req, res) => {
    const auth = req.headers['authorization'];
    const xApiKey = req.headers['x-api-key'];
    // Zły klucz → 401. OpenAI używa Bearer, Anthropic nagłówka x-api-key — sprawdzamy oba.
    if (auth === 'Bearer BAD' || xApiKey === 'BAD') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid key' } }));
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o', display_name: 'GPT-4o' }, { bad: 1 }]
        })
      );
      return;
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (obj: unknown): void => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      send({ choices: [{ delta: { content: 'Hel' } }] });
      send({ choices: [{ delta: { content: 'lo' } }] });
      send({ choices: [{ delta: {} }] }); // porcja bez treści — ignorowana
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    // Anthropic Messages API — inny format strumienia (typowane zdarzenia SSE) i inne pola.
    if (req.method === 'POST' && req.url === '/v1/messages') {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        try {
          lastAnthropicBody = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          lastAnthropicBody = {};
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const evt = (name: string, obj: unknown): void =>
          res.write(`event: ${name}\ndata: ${JSON.stringify(obj)}\n\n`);
        evt('content_block_delta', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } });
        evt('content_block_delta', { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } });
        // Zdarzenie bez text_delta — ignorowane przez parser.
        evt('content_block_stop', { type: 'content_block_stop' });
        evt('message_stop', { type: 'message_stop' });
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}/v1`;

  // --- Lista modeli ---
  {
    const provider = new OpenAiCompatibleProvider({ kind: 'openai', baseUrl, apiKey: 'GOOD' });
    const models = await provider.listModels();
    sprawdz('listModels zwraca 2 poprawne modele', models.length === 2, JSON.stringify(models.map((m) => m.id)));
    sprawdz('listModels odsiewa wpisy bez id', models.every((m) => typeof m.id === 'string'));
  }

  // --- Czat: strumień delt + pełny tekst ---
  {
    const provider = new OpenAiCompatibleProvider({ kind: 'openai', baseUrl, apiKey: 'GOOD' });
    const deltas: string[] = [];
    const full = await provider.chat(
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'cześć' }] },
      (d) => deltas.push(d)
    );
    sprawdz('chat sklejył pełny tekst', full === 'Hello', full);
    sprawdz('chat wywołał onDelta dla każdej porcji', deltas.join('|') === 'Hel|lo', deltas.join('|'));
  }

  // --- Zły klucz → czytelny błąd ---
  {
    const provider = new OpenAiCompatibleProvider({ kind: 'openai', baseUrl, apiKey: 'BAD' });
    let message = '';
    try {
      await provider.listModels();
    } catch (e) {
      message = (e as Error).message;
    }
    sprawdz('zły klucz daje błąd 401 z komunikatem', message.includes('401') && message.includes('Invalid key'), message);
  }

  // --- Normalizacja baseUrl z końcowym slashem ---
  {
    const provider = new OpenAiCompatibleProvider({ kind: 'custom', baseUrl: `${baseUrl}/`, apiKey: 'GOOD' });
    const models = await provider.listModels();
    sprawdz('baseUrl z końcowym / jest normalizowany', models.length === 2);
  }

  // --- Anthropic: lista modeli (z display_name jako etykietą) ---
  {
    const provider = new AnthropicProvider({ baseUrl, apiKey: 'GOOD' });
    const models = await provider.listModels();
    sprawdz('Anthropic listModels zwraca 2 modele', models.length === 2, JSON.stringify(models));
    sprawdz('Anthropic mapuje display_name na label', models.find((m) => m.id === 'gpt-4o')?.label === 'GPT-4o');
  }

  // --- Anthropic: czat (strumień content_block_delta) + rozbicie promptu systemowego ---
  {
    const provider = new AnthropicProvider({ baseUrl, apiKey: 'GOOD' });
    const deltas: string[] = [];
    const full = await provider.chat(
      {
        model: 'claude-sonnet-4',
        messages: [
          { role: 'system', content: 'jesteś pomocny' },
          { role: 'user', content: 'cześć' }
        ]
      },
      (d) => deltas.push(d)
    );
    sprawdz('Anthropic chat sklejył pełny tekst', full === 'Hello', full);
    sprawdz('Anthropic chat wywołał onDelta dla każdej porcji', deltas.join('|') === 'Hel|lo', deltas.join('|'));
    sprawdz('Anthropic wydzielił prompt systemowy do pola system', lastAnthropicBody['system'] === 'jesteś pomocny');
    sprawdz(
      'Anthropic wysyła tylko user/assistant w messages',
      Array.isArray(lastAnthropicBody['messages']) &&
        (lastAnthropicBody['messages'] as unknown[]).length === 1,
      JSON.stringify(lastAnthropicBody['messages'])
    );
    sprawdz('Anthropic ustawia wymagane max_tokens', typeof lastAnthropicBody['max_tokens'] === 'number');
  }

  // --- Anthropic: zły klucz (x-api-key) → czytelny błąd 401 ---
  {
    const provider = new AnthropicProvider({ baseUrl, apiKey: 'BAD' });
    let message = '';
    try {
      await provider.listModels();
    } catch (e) {
      message = (e as Error).message;
    }
    sprawdz('Anthropic zły klucz daje błąd 401', message.includes('401') && message.includes('Invalid key'), message);
  }

  server.close();

  console.log('\nWYNIKI (dostawca AI)');
  console.log('─'.repeat(56));
  for (const w of wyniki) console.log(`${w.ok ? '  OK  ' : ' BLAD '} ${w.n}${w.d ? `  (${w.d})` : ''}`);
  console.log('─'.repeat(56));
  const bledy = wyniki.filter((w) => !w.ok).length;
  console.log(bledy === 0 ? `Wszystkie ${wyniki.length} przeszły.` : `Nieudanych: ${bledy}`);
  process.exit(bledy === 0 ? 0 : 1);
}

void main().catch((error: unknown) => {
  console.error('Test wywrócił się:', error);
  process.exit(1);
});
