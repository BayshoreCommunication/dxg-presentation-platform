/** Titles that come before a name and are never what a speaker is called by their first name. */
const HONORIFICS = new Set(["dr", "prof", "mr", "mrs", "ms", "mx", "sir", "dame"]);

/**
 * The first name to greet a speaker by, for the `{{speaker_first}}` merge field.
 *
 * The first word left once leading honorifics are dropped ("Dr. Priya Raman" → "Priya").
 * A name that is only a title, or blank, falls back to the full name as given, so the
 * greeting is never empty.
 */
export function firstName(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const given = words.find((word) => !HONORIFICS.has(word.toLowerCase().replace(/\.$/, "")));
  return given ?? fullName.trim();
}
