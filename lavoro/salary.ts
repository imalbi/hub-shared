// Pure helper to extract and format RAL / salary mentions from job descriptions or snippets.

function cleanCurrency(val: string): string {
  return val
    .trim()
    .replace(/^(?:euro|eur|€)\b\s*/i, '')
    .replace(/^€\s*/i, '')
    .replace(/\s*(?:\b(?:euro|eur)|€)$/i, '')
    .replace(/\s*\+$/, '+');
}

function normalizeNum(val: string): string {
  let cleaned = cleanCurrency(val).replace(/[,.]00$/, '');
  // English thousands separator with comma e.g. 25,500 or 65,800
  if (/^\d{1,3},\d{3}$/.test(cleaned)) {
    cleaned = cleaned.replace(',', '.');
  }
  // English thousands separator with comma and decimal cents e.g. 28,000.50
  if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\.\d{1,2}$/, '').replace(/,/g, '.');
  }
  // Decimal cents e.g. 33.058,74 or 36.906,87 -> drop cents to keep base integer 33.058
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(/,\d{1,2}$/, '');
  }
  if (/^\d{2}(?:[.,]\d+)?k\+?$/i.test(cleaned)) {
    return cleaned.toLowerCase().replace(',', '.');
  }
  // Decimal notation under 100 with comma/dot: "22,5" -> "22.5k"
  if (/^\d{2}[.,]\d{1,2}\+?$/.test(cleaned)) {
    return `${cleaned.replace(',', '.')}k`;
  }
  // Plain 2 digits under 100: "28" -> "28k"
  if (/^\d{2}\+?$/.test(cleaned)) {
    return `${cleaned}k`;
  }
  return cleaned;
}

function parseSalaryNumber(s: string): number {
  const stripped = s.replace(/\+$/, '');
  if (stripped.endsWith('k')) {
    return parseFloat(stripped.slice(0, -1)) * 1000;
  }
  const clean = stripped.replace(/\./g, '').replace(',', '.');
  return parseFloat(clean);
}

function isValidSalary(s: string): boolean {
  const num = parseSalaryNumber(s);
  return !isNaN(num) && num >= 15000 && num <= 300000;
}

function decodeHtml(str: string): string {
  return str
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&euro;/gi, '€')
    .replace(/&#8364;/g, '€')
    .replace(/&amp;/gi, '&');
}

function parseMonthlyVal(val: string): number | null {
  const trimmed = cleanCurrency(val);
  const clean = trimmed.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(clean);
  if (isNaN(num) || num < 500 || num > 15000) return null;
  return Math.round(num);
}

function formatMonthlyVal(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function extractSalary(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = decodeHtml(raw);

  // 1. Monthly salary: "Retribuzione: €743,81 - €2.519,88 al mese", "1.800 € / mese"
  const numToken =
    '(?:€|(?:euro|eur)\\b)?\\s*(?:\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d{2})?|\\d{3,5}(?:[.,]\\d{2})?|\\d{1,3}(?:[.,]\\d{2})?)';
  const monthlyRange = new RegExp(
    `\\b(?:retribuzione|stipendio|compenso)?\\s*[:=-]?\\s*(?:\\b(?:di|da|tra|circa)\\b\\s*)*(${numToken})\\s*(?:[-–]|fino\\s+a|a)\\s*(${numToken})\\s*(?:€|(?:euro|eur)\\b)?\\s*(?:\\/\\s*(?:mese|m)|al\\s+mese|mensili)\\b`,
    'i',
  ).exec(text);
  if (monthlyRange && monthlyRange[1] && monthlyRange[2]) {
    const from = parseMonthlyVal(monthlyRange[1]);
    const to = parseMonthlyVal(monthlyRange[2]);
    if (from !== null && to !== null) {
      return `${formatMonthlyVal(from)} - ${formatMonthlyVal(to)} €/m`;
    }
  }

  const monthlySingle = new RegExp(
    `\\b(?:retribuzione|stipendio|compenso)?\\s*(?:mensile)?\\s*[:=-]?\\s*(?:\\b(?:di|da|tra|circa)\\b\\s*)*(${numToken})\\s*(?:€|(?:euro|eur)\\b)?\\s*(?:\\/\\s*(?:mese|m)|al\\s+mese|mensili)\\b`,
    'i',
  ).exec(text);
  if (monthlySingle && monthlySingle[1]) {
    const val = parseMonthlyVal(monthlySingle[1]);
    if (val !== null) {
      return `${formatMonthlyVal(val)} €/m`;
    }
  }

  // 2. CCNL metalmeccanico / collective agreement level ranges (e.g. Accenture: B2 33.058,74€ e 50.500€, B3 36.906,87 € e 65,800€)
  // or seniority levels (e.g. Junior: €28,000 – €34,000). When multiple levels are present, pick the lowest entry level band.
  const generalNumToken =
    '(?:€|(?:euro|eur)\\b)?\\s*\\d{1,3}(?:[.,]\\d{3})*(?:[.,]\\d+)?\\s*k?\\+?(?:\\s*(?:€|(?:euro|eur)\\b))?';
  const ccnlRegex = new RegExp(
    `\\b([A-Z]\\d{1,2}|[1-9]°?|Junior|Middle|Senior|Entry[\\s-]level)[:\\s]+(${generalNumToken})\\s*(?:[-–/]|fino\\s+a|a(?:\\s+i)?|ed?(?:\\s+i)?|e|to)\\s*(${generalNumToken})`,
    'gi',
  );
  let ccnlMatch: RegExpExecArray | null;
  const ccnlCandidates: Array<{ fromStr: string; toStr: string; minVal: number }> = [];
  while ((ccnlMatch = ccnlRegex.exec(text)) !== null) {
    // A band needs a currency, a k or a thousands separator: "Junior 20 e 25 anni" is an age, not a salary.
    const looksLikeMoney = (v: string) => /€|\beur|k\b|\d[.,]\d{3}/i.test(v);
    if (ccnlMatch[2] && ccnlMatch[3] && looksLikeMoney(ccnlMatch[2]) && looksLikeMoney(ccnlMatch[3])) {
      const from = normalizeNum(ccnlMatch[2]);
      const to = normalizeNum(ccnlMatch[3]);
      if (isValidSalary(from) && isValidSalary(to)) {
        ccnlCandidates.push({ fromStr: from, toStr: to, minVal: parseSalaryNumber(from) });
      }
    }
  }
  if (ccnlCandidates.length > 0) {
    ccnlCandidates.sort((a, b) => a.minVal - b.minVal);
    return `${ccnlCandidates[0].fromStr} - ${ccnlCandidates[0].toStr} €`;
  }

  // 2b. Workday / ATS format: "Minimum Base Salary: 28,000.00 EUR \n Maximum Base Salary: 36,000.00 EUR"
  const minMaxATS = /minimum\s+base\s+salary\s*:\s*([^\n\r]+)[\s\S]*?maximum\s+base\s+salary\s*:\s*([^\n\r]+)/i.exec(
    text,
  );
  if (minMaxATS && minMaxATS[1] && minMaxATS[2]) {
    const from = normalizeNum(minMaxATS[1]);
    const to = normalizeNum(minMaxATS[2]);
    if (isValidSalary(from) && isValidSalary(to)) {
      return `${from} - ${to} €`;
    }
  }

  // 3. Amount BEFORE keyword: "€45.000 – €65.000 di RAL", "28.000 - 32.000 € di retribuzione"
  const amountBeforeKeyword = new RegExp(
    `(${generalNumToken})\\s*(?:[-–/]|fino\\s+a|a|ed?|e|to)\\s*(${generalNumToken})\\s*(?:di\\s+)?\\b(?:ral|retribuzione|stipendio|compenso)\\b`,
    'i',
  ).exec(text);
  if (amountBeforeKeyword && amountBeforeKeyword[1] && amountBeforeKeyword[2]) {
    const from = normalizeNum(amountBeforeKeyword[1]);
    const to = normalizeNum(amountBeforeKeyword[2]);
    if (isValidSalary(from) && isValidSalary(to)) {
      return `${from} - ${to} €`;
    }
  }

  // 3b. Starts from / rising to: "Salary starts from of €30,000 at entry level rising to €90,000", "Starts from 30.000 € up to 60.000 €"
  const startsRising = new RegExp(
    `\\b(?:salary|retribuzione|stipendio|ral|compenso)?\\s*\\bstarts?\\s+(?:from|at)?\\s*(?:of)?\\s*(${generalNumToken})[^.\\n;]{0,100}?\\b(?:rising\\s+to|up\\s+to|fino\\s+a)\\s*(${generalNumToken})`,
    'i',
  ).exec(text);
  if (startsRising && startsRising[1] && startsRising[2]) {
    const from = normalizeNum(startsRising[1]);
    const to = normalizeNum(startsRising[2]);
    if (isValidSalary(from) && isValidSalary(to)) {
      return `${from} - ${to} €`;
    }
  }

  // 3c. Starting from: "retribuzione a partire da 24.000,00 €", "a partire da 24.000 €"
  const startingFrom =
    /\b(?:retribuzione|stipendio|ral|compenso|salary|pay)?\s*a\s+partire\s+da\s*(${generalNumToken})/i.exec(text);
  if (startingFrom && startingFrom[1]) {
    const val = normalizeNum(startingFrom[1]);
    if (isValidSalary(val)) {
      return `${val}+ €`;
    }
  }

  // 4. Explicit keyword: RAL / retribuzione / pay range / salary / annual salary / gross annual salary
  // Iterate through all keyword occurrences so non-numeric intro sentences do not shadow the real salary.
  const keywordPattern =
    /\b(?:ral|retribuzione(?:\s+annua)?(?:\s+lorda)?|stipendio|compenso|pay(?:\s+(?:range|band))?|salary(?:\s+(?:range|band))?|(?:gross\s+)?annual\s+salary|base\s+pay|compensation)\b(?:\s*\([^)]*\))?[^:;\n\d]{0,80}?[:=-]?\s*(?:di|da|tra(?:\s+i)?|from)?\s*(?:circa|around)?\s*((?:€|(?:euro|eur)\b)?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*k?\+?(?:\s*(?:€|(?:euro|eur)\b))?(?:\s*(?:[-–/]|fino\s+a|a(?:\s+i)?|ed?(?:\s+i)?|e|to)\s*(?:€|(?:euro|eur)\b)?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*k?\+?)?\s*(?:€|(?:euro|eur)\b|\/anno|all'anno|annui|annuali|annual\s+salary)?)/gi;

  let kwMatch: RegExpExecArray | null;
  while ((kwMatch = keywordPattern.exec(text)) !== null) {
    if (kwMatch[1]) {
      const rawVal = kwMatch[1].trim();
      // Range: "28 - 32k", "28.000 - 32.000 €", "26-29k", "22,5-51k", "Euro 23.258 ed Euro 28.816", "EUR 27.550 - 30.000", "€25,500 to €38,500"
      const range =
        /^((?:€|(?:euro|eur)\b)?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*k?\+?(?:\s*(?:€|(?:euro|eur)\b))?)\s*(?:[-–/]|fino\s+a|a(?:\s+i)?|ed?(?:\s+i)?|e|to)\s*((?:€|(?:euro|eur)\b)?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*k?\+?)\s*(?:€|(?:euro|eur)\b|\/anno|all'anno|annual\s+salary)?$/i.exec(
          rawVal,
        );
      if (range && range[1] && range[2]) {
        const from = normalizeNum(range[1]);
        const to = normalizeNum(range[2]);
        if (isValidSalary(from) && isValidSalary(to)) {
          return `${from} - ${to} €`;
        }
      }
      // Single value: "30.000 €", "28k", "25.000", "25k+"
      const single =
        /^((?:€|(?:euro|eur)\b)?\s*\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?\s*k?\+?)\s*(?:€|(?:euro|eur)\b|\/anno|all'anno|annual\s+salary)?$/i.exec(
          rawVal,
        );
      if (single && single[1]) {
        const val = normalizeNum(single[1]);
        if (isValidSalary(val)) {
          return `${val} €`;
        }
      }
    }
  }

  // 5. Standalone range with k or currency: "28.000 € - 35.000 €", "22,5-51k", "28k - 32k €"
  const kRange = /\b(\d{2}(?:[.,]\d{1,2})?)\s*[-–]\s*(\d{2}(?:[.,]\d{1,2})?k)\b/i.exec(text);
  if (kRange && kRange[1] && kRange[2]) {
    const from = normalizeNum(kRange[1]);
    const to = normalizeNum(kRange[2]);
    if (isValidSalary(from) && isValidSalary(to)) {
      return `${from} - ${to} €`;
    }
  }

  const standaloneRange =
    /(?:€\s*)?(\d{2}(?:[.,]\d{3})*|\d{2}(?:[.,]\d+)?k)\s*(?:€\s*)?[-–]\s*(?:€\s*)?(\d{2}(?:[.,]\d{3})*|\d{2}(?:[.,]\d+)?k)\s*(?:€|euro|\/anno|all'anno)/i.exec(
      text,
    );
  if (standaloneRange && standaloneRange[1] && standaloneRange[2]) {
    const from = normalizeNum(standaloneRange[1]);
    const to = normalizeNum(standaloneRange[2]);
    if (isValidSalary(from) && isValidSalary(to)) {
      return `${from} - ${to} €`;
    }
  }

  // 6. Standalone plus e.g. "25k+" or "25k +"
  const plusMatch = /\b(\d{2}(?:[.,]\d{1,2})?k)\s*\+/i.exec(text);
  if (plusMatch && plusMatch[1]) {
    const val = normalizeNum(`${plusMatch[1]}+`);
    if (isValidSalary(val)) {
      return `${val} €`;
    }
  }

  // 7. Explicit annual marker: "28.000 € all'anno" or "32.000 € / anno"
  const explicitAnnual = /(?:€\s*)?(\d{2}[.,]\d{3})\s*€\s*(?:\/(?:anno|all'anno|annui|annuali))/i.exec(text);
  if (explicitAnnual && explicitAnnual[1]) {
    const val = normalizeNum(explicitAnnual[1]);
    if (isValidSalary(val)) {
      return `${val} €`;
    }
  }

  return null;
}
