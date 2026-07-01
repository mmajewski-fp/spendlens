/**
 * Description → category slug mapping (S-01).
 *
 * Pure, deterministic, locale-safe. Maps a free-text transaction description
 * onto one of the 11 fixed category slugs seeded by F-01, with `other` as the
 * fallback (roadmap Open Question Q3, resolved: fixed taxonomy).
 *
 * Matching is a lowercased substring scan over an ordered keyword table.
 * `String.prototype.toLowerCase()` uses Unicode default case mapping (NOT the
 * locale-sensitive `toLocaleLowerCase`), so it is locale-independent — see
 * context/foundation/lessons.md (no ambient locale in deterministic logic).
 */

/** One of the 11 seeded slugs. `other` is the fallback. */
export type CategorySlug =
  | "groceries"
  | "dining"
  | "transport"
  | "housing"
  | "utilities"
  | "entertainment"
  | "healthcare"
  | "shopping"
  | "travel"
  | "salary"
  | "other";

export const OTHER_SLUG: CategorySlug = "other";

/**
 * Ordered keyword → slug table. Order matters: the first keyword found as a
 * substring of the lowercased description wins. Keep more-specific keywords
 * ahead of any that could collide.
 */
const KEYWORD_TABLE: readonly (readonly [string, CategorySlug])[] = [
  ["salary", "salary"],
  ["payroll", "salary"],
  ["rent", "housing"],
  ["mortgage", "housing"],
  ["grocer", "groceries"],
  ["supermarket", "groceries"],
  ["restaurant", "dining"],
  ["cafe", "dining"],
  ["coffee", "dining"],
  ["pizz", "dining"],
  ["uber", "transport"],
  ["fuel", "transport"],
  ["transit", "transport"],
  ["electric", "utilities"],
  ["water", "utilities"],
  ["internet", "utilities"],
  ["netflix", "entertainment"],
  ["cinema", "entertainment"],
  ["concert", "entertainment"],
  ["pharmacy", "healthcare"],
  ["clinic", "healthcare"],
  ["amazon", "shopping"],
  ["clothing", "shopping"],
  ["airline", "travel"],
  ["hotel", "travel"],
];

/** Map a transaction description to a category slug; `other` when nothing matches. */
export function categorize(description: string): CategorySlug {
  const haystack = description.toLowerCase();
  for (const [keyword, slug] of KEYWORD_TABLE) {
    if (haystack.includes(keyword)) return slug;
  }
  return OTHER_SLUG;
}
