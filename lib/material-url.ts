/** Production materials use HTTPS. Local development additionally permits only
 * our exact signed, same-origin material endpoint, never arbitrary HTTP URLs. */
export function isSafeMaterialUrl(value: string): boolean {
  if (process.env.NODE_ENV !== "production" && /^\/api\/local-material-assets\?ticket=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}
