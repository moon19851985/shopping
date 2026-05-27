/** تلميح خفيف عند ردود شديدة القصر (مسار JSON) */

function polishAiChatReplyShort(reply) {
    const s = String(reply || '').trim();
    if (!s || s === '…') {
        return s || '…';
    }
    if (s.length >= 28) {
        return s;
    }
    return (
        s +
        '\n\n— إذا احتجت شرحاً أوسع أو أمثلة، اذكر ذلك في رسالة لاحقة (مثلاً: «وسّع الجواب»).'
    );
}

module.exports = { polishAiChatReplyShort };
