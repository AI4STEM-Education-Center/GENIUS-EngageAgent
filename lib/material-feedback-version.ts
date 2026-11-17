/** A response belongs to the version the learner actually saw. Older records
 * without an explicit version can only be used after that publication time. */
export function ratingMatchesPublication(rating: { published_at?: string; rated_at?: string }, publishedAt?: string): boolean {
  if (!publishedAt) return true;
  if (rating.published_at) return rating.published_at === publishedAt;
  const published = Date.parse(publishedAt), rated = Date.parse(rating.rated_at || "");
  return Number.isFinite(published) && Number.isFinite(rated) && rated >= published;
}
