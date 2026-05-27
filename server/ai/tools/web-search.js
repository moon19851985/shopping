async function webSearchDuckDuckGoLite(query) {
    const q = String(query || '').trim().slice(0, 220);
    if (!q) {
        return 'Empty search query.';
    }
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12000);
    try {
        const r = await fetch(url, {
            signal: ac.signal,
            headers: { 'User-Agent': 'GOSTA-Assistant/1.0 (support)' }
        });
        const j = await r.json().catch(() => ({}));
        const parts = [];
        if (j.AbstractText) {
            parts.push(String(j.AbstractText));
        }
        if (j.Answer) {
            parts.push(String(j.Answer));
        }
        if (Array.isArray(j.RelatedTopics)) {
            for (const rt of j.RelatedTopics.slice(0, 6)) {
                if (rt && typeof rt === 'object' && rt.Text) {
                    parts.push(String(rt.Text));
                } else if (typeof rt === 'string') {
                    parts.push(rt);
                }
            }
        }
        const text = parts.filter(Boolean).join('\n\n').trim().slice(0, 4500);
        return text || 'No instant snippet from search API; suggest the user try a different query or check a trusted site.';
    } catch (e) {
        return 'Search temporarily unavailable. Suggest the user try again or verify from a primary source.';
    } finally {
        clearTimeout(timer);
    }
}

module.exports = { webSearchDuckDuckGoLite };
