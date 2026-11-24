import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstMatchingRule, matchRule, type BlacklistRule } from './blacklist.ts';

const rule = (patch: Partial<BlacklistRule>): BlacklistRule => ({
  id: 1,
  enabled: true,
  field: 'company',
  matchType: 'contains',
  value: 'acme',
  ...patch,
});

void test('every field is read from the posting it names', () => {
  const posting = {
    company: 'Acme Labs',
    title: 'Backend developer',
    description: 'We build rockets',
    location: 'Exampleville',
    site: 'indeed',
    work_mode: 'remote',
    key: 'acme labs|backend developer',
  };
  const fields: BlacklistRule['field'][] = ['company', 'title', 'description', 'location', 'site', 'work_mode', 'key'];
  for (const field of fields) assert.ok(matchRule(rule({ field, value: posting[field].slice(0, 5) }), posting), field);
  assert.equal(matchRule(rule({ field: 'title', value: 'acme' }), posting), false);
});

void test('equals needs the whole field, contains a part, word a whole word', () => {
  const posting = { company: 'Acme Labs', title: 'Storage engineer' };
  assert.ok(matchRule(rule({ matchType: 'equals', value: 'acme labs' }), posting));
  assert.equal(matchRule(rule({ matchType: 'equals', value: 'acme' }), posting), false);
  assert.ok(matchRule(rule({ matchType: 'contains', value: 'me la' }), posting));
  assert.ok(matchRule(rule({ matchType: 'word', value: 'labs' }), posting));
  assert.equal(matchRule(rule({ matchType: 'word', value: 'lab' }), posting), false);
  // the 16b rule: "rag" is not inside "storage"
  assert.equal(matchRule(rule({ field: 'title', matchType: 'word', value: 'rag' }), posting), false);
  assert.ok(matchRule(rule({ field: 'title', matchType: 'contains', value: 'rag' }), posting));
});

void test('case and runs of spaces are ignored on both sides', () => {
  assert.ok(matchRule(rule({ matchType: 'equals', value: '  ACME   labs ' }), { company: 'acme\tLABS' }));
  assert.ok(matchRule(rule({ matchType: 'word', value: 'Acme  Labs' }), { company: 'The  acme labs group' }));
});

void test('Unicode is normalised: width forms fold and accents stay significant', () => {
  assert.ok(matchRule(rule({ matchType: 'equals', value: 'ACME' }), { company: 'Ａｃｍｅ' }));
  // composed and decomposed "é" are the same text
  assert.ok(matchRule(rule({ matchType: 'equals', value: 'café' }), { company: 'café' }));
  // a word boundary is Unicode-aware: "società" is one word, not "societ" plus "à"
  assert.equal(matchRule(rule({ matchType: 'word', value: 'societ' }), { company: 'società nuova' }), false);
  assert.ok(matchRule(rule({ matchType: 'word', value: 'società' }), { company: 'La Società nuova' }));
});

void test('a disabled rule never matches, and the first enabled match wins', () => {
  const posting = { company: 'Acme Labs', title: 'Developer' };
  assert.equal(matchRule(rule({ enabled: false }), posting), false);
  const rules = [rule({ id: 1, enabled: false }), rule({ id: 2, field: 'title', value: 'dev' }), rule({ id: 3 })];
  assert.equal(firstMatchingRule(rules, posting)?.id, 2);
  assert.equal(firstMatchingRule([rule({ enabled: false })], posting), undefined);
});

void test('a field that is absent or an empty value never matches', () => {
  assert.equal(matchRule(rule({ field: 'description' }), { company: 'Acme' }), false);
  assert.equal(matchRule(rule({ field: 'description', value: 'acme' }), { description: null }), false);
  assert.equal(matchRule(rule({ value: '  ' }), { company: 'Acme' }), false);
});
