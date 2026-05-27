/** تصنيف «سؤال معقّد» لتوجيه النموذج الأقوى */

function isComplexPrompt(text) {
    const t = String(text || '').trim();
    if (!t) return false;
    if (t.length >= 260) return true;
    if ((t.match(/\n/g) || []).length >= 4) return true;
    const complexityHints = [
        'حلل',
        'قارن',
        'خطة',
        'استراتيجية',
        'معقد',
        'تفصيلي',
        'اشرح',
        'بالتفصيل',
        'خطوة',
        'خطوات',
        'قائمة',
        'ماذا لو',
        'ما الفرق',
        'لماذا',
        'كود',
        'برمج',
        'debug',
        'architecture',
        'optimize',
        'trade-off',
        'step by step',
        'اكتب',
        'صيغ',
        'اقترح'
    ];
    const lt = t.toLowerCase();
    let hits = 0;
    for (const k of complexityHints) {
        if (lt.includes(k)) hits += 1;
    }
    return hits >= 2;
}

module.exports = { isComplexPrompt };
