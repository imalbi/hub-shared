/**
 * Detects whether a job is exclusively or specifically reserved for "categorie protette" (Legge 68/99).
 * Distinguishes reserved positions from generic equal-opportunity / diversity disclaimers.
 */

const TITLE_PROTECTED_PATTERN =
  /\b(?:categori[ae]\s+protett[ae]|cat\.?\s*protett[ae]|l\.?\s*68\/99|legge\s+68\/99|collocamento\s+mirato)\b/i;

const DESC_PROTECTED_PATTERNS = [
  /\b(?:posizione|ricerca|offerta|inserimento|opportunit[aà]|annuncio)\s+riservat[aoe]\b.*?\b(?:categori[ae]\s+protett[ae]|l\.?\s*68\/99|legge\s+68\/99|art\.?\s*(?:1|18)\b)/i,
  /\briservat[aoe]\s+(?:esclusivamente\s+)?(?:a|agli|alle)?\s*(?:candidat[ie]|persone|lavorator[ie])?\s*appartenent[ie]\s+(?:alle\s+)?(?:categori[ae]\s+protett[ae]|l\.?\s*68\/99)/i,
  /\briservat[aoe]\s+(?:esclusivamente\s+)?(?:a|agli|alle)?\s*(?:categori[ae]\s+protett[ae]|l\.?\s*68\/99)/i,
  /\b(?:requisito\s+(?:obbligatorio|indispensabile)|costituisce\s+requisito\s+obbligatorio)\b.*?\b(?:categori[ae]\s+protett[ae]|l\.?\s*68\/99|collocamento\s+mirato)\b/i,
  /\biscri(?:tto|zione)\s+(?:al|alle\s+liste\s+del)?\s*collocamento\s+mirato\b/i,
  /\bappartenenza\s+alle\s+categorie\s+protette\s+(?:\(?(?:l\.?\s*68\/99|art\.?\s*(?:1|18))\)?\s+)?(?:come\s+requisito|obbligatori[ao]|indispensabile)\b/i,
  /\b(?:ricerchiamo|ricerca|selezioniamo)\s+(?:profili|candidat[ie]|figure|risorse)\b.*?\bappartenent[ie]\s+alle\s+categorie\s+protette\b/i,
  /\brivolt[aoe]\s+(?:esclusivamente\s+)?a\s+(?:candidat[ie]|persone)?\s*appartenent[ie]\s+alle\s+categorie\s+protette\b/i,
];

export function isProtectedCategory(title: string, description?: string | null): boolean {
  if (TITLE_PROTECTED_PATTERN.test(title)) return true;
  if (!description) return false;
  return DESC_PROTECTED_PATTERNS.some((pattern) => pattern.test(description));
}
