export function publicImageUrl(filename: string) {
  const base = (process.env.PUBLIC_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
  return `${base}/uploads/${filename}`;
}

/** يصلح روابط قديمة محفوظة بـ localhost عند القراءة من القاعدة */
export function normalizeImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const base = (process.env.PUBLIC_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");

  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      const parsed = new URL(url);
      const path = `${parsed.pathname}${parsed.search}`;
      if (path.startsWith("/uploads/")) {
        return `${base}${path}`;
      }
      if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
        return `${base}${path}`;
      }
      return url;
    } catch {
      return url;
    }
  }

  return `${base}${url.startsWith("/") ? url : `/${url}`}`;
}
