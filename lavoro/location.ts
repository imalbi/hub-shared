import type { Filter } from './config.ts';
import { escapeRegex, keywordPattern, reasonOf, wholeWord } from './match.ts';
import { provinceRegion, regionKey } from './province-regions.ts';
import { provinceTowns } from './province-towns.ts';
import { normalizeTown } from './town-name.ts';

type Where = { title: string; location: string; remote?: boolean; modeResolved?: boolean };
type LocationFilter = Pick<
  Filter,
  'allowedLocations' | 'allowedProvinces' | 'keepRemote' | 'keepGenericItaly' | 'countryNames'
>;
const remoteWords = /remot|smart working|da casa/iu;

/**
 * The search is national and the filter is local. A posting passes in a place on the allowed list; otherwise it
 * must be in the country (an empty place counts) and either be remote or have no precise place.
 */
export function locationPasses(posting: Where, filter: LocationFilter) {
  const place = posting.location.trim().toLowerCase();
  // Whole words, so a short region code such as Indeed's `PIE` does not match inside another place name.
  if (filter.allowedLocations.some((allowed) => wholeWord(escapeRegex(allowed.toLowerCase())).test(place))) return true;
  const provinces = [...place.split(/,|\s+[-–—]\s+/u), ...place.split(/[,\-–—]/u)].flatMap((part) => {
    const town = normalizeTown(part);
    return Object.hasOwn(provinceTowns, town) ? (provinceTowns[town] ?? []) : [];
  });
  if (provinces.some((province) => filter.allowedProvinces.includes(province))) return true;
  // A town with no region ("Cavaglia, Biella") passes when its region is on the allowed list.
  const allowedRegions = filter.allowedLocations.map(regionKey);
  if (provinces.some((province) => allowedRegions.includes(regionKey(provinceRegion[province] ?? '')))) return true;
  const country = filter.countryNames.map((name) => name.toLowerCase());
  const inCountry = place === '' || wholeWord(country.map(escapeRegex).join('|')).test(place);
  if (!inCountry) return false;
  if (
    filter.keepRemote &&
    (posting.remote || (!posting.modeResolved && remoteWords.test(`${posting.title} ${posting.location}`)))
  )
    return true;
  return filter.keepGenericItaly && (place === '' || country.includes(place));
}

/** Only the highest bonus found counts; the reason is tagged `(sede)`. */
export function locationBonus(location: string, weights: Record<string, number>) {
  let best: [string, number] | undefined;
  for (const entry of Object.entries(weights))
    if (keywordPattern(entry[0]).test(location) && (!best || entry[1] > best[1])) best = entry;
  return best ? { bonus: best[1], reasons: [reasonOf(best[0], best[1], ' (sede)')] } : { bonus: 0, reasons: [] };
}
