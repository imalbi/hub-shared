import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestBody } from './test-http.ts';
import {
  dropSettledCodes,
  fetchOpinion,
  opinionFailure,
  opinionInput,
  possibilityOf,
  promptVersion,
  type Opinion,
} from './opinion-prompt.ts';

const input = opinionInput(
  'Profilo inventato senza contatti',
  {
    title: 'Sviluppatore',
    company: 'Esempio',
    location: 'Italia',
    workMode: 'remote',
    description: 'Retribuzione 30.000 euro',
    reasons: ['remote +2'],
  },
  'gemini-3.8-flash',
);
const valid = {
  codes: ['domain', 'location'],
  verdict: 'alta',
  why: 'Compatibile',
  fit: ['Ruolo'],
  contro: [],
  next: 'Scrivi al referente',
  unverified: ['Azienda'],
};
const signal = new AbortController().signal;

void test('official bando text is included in the current version and labelled in the prompt', async () => {
  const withBando = opinionInput(input.profile, { ...input.posting, bando: 'Diploma inventato' }, input.model);
  assert.equal(withBando.version, 9);
  assert.equal(withBando.posting.bando, 'Diploma inventato');
  assert.notDeepEqual(withBando, input);
  const fake: typeof fetch = async (_url, init) => {
    const body = requestBody(init?.body);
    assert.ok(body.includes('Diploma inventato'));
    assert.ok(body.includes('testo ufficiale del bando'));
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(valid) }] } }] });
  };
  await fetchOpinion(fake, 'invented-key', withBando, signal);
});

void test('the request sends the key in the header and the profile, posting and labelled scores in the body', async () => {
  const fake: typeof fetch = async (url, init) => {
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'invented-key');
    const body = requestBody(init?.body);
    const codeSchema = JSON.parse(body).generationConfig.responseFormat.text.schema.properties.codes;
    assert.deepEqual(codeSchema.items.enum, [
      'location',
      'work_mode',
      'salary',
      'domain',
      'seniority',
      'degree',
      'sales',
      'contract',
      'language',
      'other',
    ]);
    assert.equal(codeSchema.maxItems, 3);
    assert.ok(!body.includes('invented-key'));
    assert.ok(body.includes(input.profile));
    assert.ok(body.includes('Retribuzione 30.000 euro'));
    assert.ok(body.includes('punteggi automatici'));
    assert.ok(body.includes('alternativa equivalente e preferenziale'));
    assert.ok(body.includes('non dire che manca se è dichiarata'));
    assert.ok(body.includes('Una sede tra più sedi possibili'));
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(valid) }] } }] });
  };
  assert.deepEqual(await fetchOpinion(fake, 'invented-key', input, signal), valid);
});

void test('the Ollama provider posts the same prompt and schema to the local chat API without a key', async () => {
  const fake: typeof fetch = async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/chat');
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), null);
    const rawBody = requestBody(init?.body);
    const body = JSON.parse(rawBody);
    assert.equal(body.model, 'gemini-3.8-flash');
    assert.equal(body.stream, false);
    assert.deepEqual(body.format.properties.verdict.enum, ['alta', 'media', 'bassa', 'fuori']);
    assert.ok(body.messages[0].content.includes(input.profile));
    assert.ok(body.options.num_ctx >= 16384);
    assert.ok(!rawBody.includes('invented-key'));
    return Response.json({ message: { content: JSON.stringify(valid) } });
  };
  assert.deepEqual(await fetchOpinion(fake, 'invented-key', input, signal, 0, 'ollama'), valid);
});

void test('an Ollama error keeps only the status, never its free-text body', async () => {
  const fake: typeof fetch = async () => Response.json({ error: `model not found ${input.profile}` }, { status: 404 });
  const error = await fetchOpinion(fake, '', input, signal, 0, 'ollama').catch((e: unknown) => e);
  assert.equal(opinionFailure(error), 'http 404');
});

void test('malformed JSON, an unknown verdict and too many points are rejected', async () => {
  for (const text of [
    '{',
    JSON.stringify({ ...valid, verdict: 'forse' }),
    JSON.stringify({ ...valid, verdict: 'candidati' }),
    JSON.stringify({ ...valid, fit: ['1', '2', '3', '4', '5'] }),
    JSON.stringify({ ...valid, codes: ['unknown'] }),
    JSON.stringify({ ...valid, codes: ['domain', 'domain'] }),
    JSON.stringify({ ...valid, codes: ['domain', 'location', 'salary', 'other'] }),
  ]) {
    const fake: typeof fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
    await assert.rejects(fetchOpinion(fake, 'invented-key', input, signal));
  }
});

void test('an answer that names a profile constraint is accepted', async () => {
  const quoting = { ...valid, why: 'Sede: Roma' };
  const fake: typeof fetch = async () =>
    Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(quoting) }] } }] });
  assert.deepEqual(await fetchOpinion(fake, 'invented-key', { ...input, profile: 'Roma' }, signal), quoting);
});

void test('the answer text skips thought parts and parts without text', async () => {
  const fake: typeof fetch = async () =>
    Response.json({
      candidates: [
        {
          content: {
            parts: [
              { text: 'ragionamento', thought: true },
              { thoughtSignature: 'sig' },
              { text: JSON.stringify(valid) },
            ],
          },
        },
      ],
    });
  assert.deepEqual(await fetchOpinion(fake, 'invented-key', input, signal), valid);
});

void test('a failure log line names codes and fields, never the provider message, key or profile', async () => {
  const fake: typeof fetch = async () =>
    Response.json(
      {
        error: {
          code: 400,
          status: 'INVALID_ARGUMENT',
          message: `bad request for ${input.profile} invented-key`,
          details: [{ '@type': 'BadRequest', fieldViolations: [{ field: 'generation_config.response_format' }] }],
        },
      },
      { status: 400 },
    );
  const error = await fetchOpinion(fake, 'invented-key', input, signal).catch((e: unknown) => e);
  const line = opinionFailure(error);
  assert.equal(line, 'http 400 INVALID_ARGUMENT generation_config.response_format');
  const bad: typeof fetch = async () =>
    Response.json({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ ...valid, verdict: input.profile }) }] } }],
    });
  const parse = opinionFailure(await fetchOpinion(bad, 'invented-key', input, signal).catch((e: unknown) => e));
  assert.equal(parse, 'invalid answer at verdict (invalid_value)');
});

void test('a 503 is retried twice, a third 503 is the error', async () => {
  let calls = 0;
  const flaky: typeof fetch = async () =>
    ++calls === 1
      ? new Response('', { status: 503 })
      : Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(valid) }] } }] });
  assert.deepEqual(await fetchOpinion(flaky, 'invented-key', input, signal, 0), valid);
  assert.equal(calls, 2);
  calls = 0;
  const down: typeof fetch = async () => {
    calls++;
    return new Response('', { status: 503 });
  };
  await assert.rejects(fetchOpinion(down, 'invented-key', input, signal, 0), { status: 503 });
  assert.equal(calls, 3);
});

void test('an omitted codes field defaults to an empty array', async () => {
  const { codes: _codes, ...old } = valid;
  const fake: typeof fetch = async () =>
    Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(old) }] } }] });
  assert.deepEqual(await fetchOpinion(fake, 'invented-key', input, signal), { ...old, codes: [] });
});

void test("the prompt states today's date so past dates are not read as future", async () => {
  const bodies: string[] = [];
  const fake: typeof fetch = async (_url, init) => {
    bodies.push(requestBody(init?.body));
    return Response.json({ message: { content: JSON.stringify(valid) } });
  };
  await fetchOpinion(fake, '', input, signal, 0, 'ollama', new Date(2026, 10, 12, 20));
  assert.match(bodies[0] ?? '', /Oggi è il 2026-11-12/);
});

void test('the prompt text describes each answer field, since Ollama never shows the model the schema descriptions', async () => {
  const bodies: string[] = [];
  const fake: typeof fetch = async (_url, init) => {
    bodies.push(String(JSON.parse(requestBody(init?.body)).messages[0].content));
    return Response.json({ message: { content: JSON.stringify(valid) } });
  };
  await fetchOpinion(fake, '', input, signal, 0, 'ollama');
  for (const field of ['codes', 'verdict', 'why', 'fit', 'contro', 'next', 'unverified'])
    assert.match(bodies[0] ?? '', new RegExp(`^- ${field}: `, 'm'));
  assert.match(bodies[0] ?? '', /Mai un codice/);
});

void test('codes is a required answer field, or a local model leaves it empty', async () => {
  let required: unknown;
  const fake: typeof fetch = async (_url, init) => {
    required = JSON.parse(requestBody(init?.body)).format.required;
    return Response.json({ message: { content: JSON.stringify(valid) } });
  };
  await fetchOpinion(fake, '', input, signal, 0, 'ollama');
  assert.ok(Array.isArray(required) && required.includes('codes'));
});

void test('P1 a new answer parses with each of the four values and the current prompt version', async () => {
  assert.equal(promptVersion, 9);
  for (const verdict of ['alta', 'media', 'bassa', 'fuori']) {
    const answer = { ...valid, verdict };
    const fake: typeof fetch = async () =>
      Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] });
    assert.deepEqual(await fetchOpinion(fake, 'invented-key', input, signal), answer);
  }
});

void test('P2 possibilityOf reads an old verdict through its codes and passes a new one through', () => {
  assert.equal(possibilityOf({ verdict: 'candidati', codes: [] }), 'alta');
  assert.equal(possibilityOf({ verdict: 'chiedi prima', codes: ['domain'] }), 'media');
  assert.equal(possibilityOf({ verdict: 'scarta', codes: ['salary'] }), 'fuori');
  assert.equal(possibilityOf({ verdict: 'scarta', codes: ['domain'] }), 'bassa');
  assert.equal(possibilityOf({ verdict: 'scarta', codes: [] }), 'bassa');
  for (const verdict of ['alta', 'media', 'bassa', 'fuori'] as const)
    assert.equal(possibilityOf({ verdict, codes: ['salary'] }), verdict);
});

void test('P3 the prompt holds the four values, Caso A/B and the missing-fact rule, and none of the old words', async () => {
  let sent = '';
  const fake: typeof fetch = async (_url, init) => {
    sent = requestBody(init?.body);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(valid) }] } }] });
  };
  await fetchOpinion(fake, 'invented-key', input, signal);
  const prompt = JSON.parse(sent).contents[0].parts[0].text.toLowerCase();
  for (const word of ['alta', 'media', 'bassa', 'fuori']) assert.ok(prompt.includes(`"${word}"`), word);
  assert.ok(prompt.includes('caso a ('));
  assert.ok(prompt.includes('caso b ('));
  assert.ok(prompt.includes('non abbassa mai la possibilità'));
  assert.ok(prompt.includes("senza mai suggerire di contattare l'azienda"));
  for (const old of ['candidati', 'chiedi prima', 'scarta']) assert.ok(!prompt.includes(old), old);
});

void test('the shared prompt takes qualifications only from the supplied profile', async () => {
  let sent = '';
  const fake: typeof fetch = async (_url, init) => {
    sent = requestBody(init?.body);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(valid) }] } }] });
  };
  await fetchOpinion(fake, 'invented-key', { ...input, profile: 'Diploma di esempio' }, signal);
  const prompt: string = JSON.parse(sent).contents[0].parts[0].text;
  assert.ok(prompt.includes('Diploma di esempio'));
  assert.ok(!prompt.includes('Perito Elettronico ed Elettrotecnico'));
  assert.ok(!prompt.includes('100/100'));
});

void test('a place or mode the score already found compatible leaves the codes, unless the verdict is fuori', () => {
  const answer: Opinion = { ...valid, verdict: 'media', codes: ['location', 'work_mode', 'domain'] };
  assert.deepEqual(dropSettledCodes(answer, ['torino:+3 (sede)', 'hybrid:+1 (modalità)']).codes, ['domain']);
  assert.deepEqual(dropSettledCodes(answer, ['trasferte:-1 (descr.)']).codes, answer.codes);
  assert.deepEqual(dropSettledCodes({ ...answer, verdict: 'fuori' }, ['torino:+3 (sede)']).codes, answer.codes);
});
