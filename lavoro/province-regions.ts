import { normalizeTown } from './town-name.ts';

// Regions by their ISTAT sigle, so a place written as "Cavaglia, Biella" (no region) matches an allowed region.
const regionProvinces: Record<string, string> = {
  piemonte: 'AL AT BI CN NO TO VB VC',
  "valle d'aosta": 'AO',
  lombardia: 'BG BS CO CR LC LO MB MI MN PV SO VA',
  'trentino-alto adige': 'BZ TN',
  veneto: 'BL PD RO TV VE VI VR',
  'friuli-venezia giulia': 'GO PN TS UD',
  liguria: 'GE IM SP SV',
  'emilia-romagna': 'BO FC FE MO PC PR RA RE RN',
  toscana: 'AR FI GR LI LU MS PI PO PT SI',
  umbria: 'PG TR',
  marche: 'AN AP FM MC PU',
  lazio: 'FR LT RI RM VT',
  abruzzo: 'AQ CH PE TE',
  molise: 'CB IS',
  campania: 'AV BN CE NA SA',
  puglia: 'BA BR BT FG LE TA',
  basilicata: 'MT PZ',
  calabria: 'CS CZ KR RC VV',
  sicilia: 'AG CL CT EN ME PA RG SR TP',
  sardegna: 'CA NU OR SS SU',
};

export const provinceRegion: Record<string, string> = Object.fromEntries(
  Object.entries(regionProvinces).flatMap(([region, sigle]) => sigle.split(' ').map((sigla) => [sigla, region])),
);

/** Region names compare without accents, case or dash style: "Trentino Alto Adige" equals "trentino-alto adige". */
export const regionKey = (name: string) => normalizeTown(name).replaceAll('-', ' ');
