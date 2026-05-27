/**
 * مزامنة واستئناف المحادثات — يتطلب حساباً مفعّلاً على الخادم.
 */
const crypto = require('crypto');

function registerConversationRoutes(app, deps) {
    const {
        conversationStore,
        findVerifiedRegistrationByEmail,
        getClientIpForRateLimit,
        allowAiChatRate,
        adminMetrics
    } = deps;

    const bump =
        adminMetrics && typeof adminMetrics.bump === 'function' ? adminMetrics.bump : () => {};

    if (!conversationStore || typeof findVerifiedRegistrationByEmail !== 'function') {
        console.warn('[ai/conversations] مخزن المحادثات غير مُهيأ — مسارات /api/ai/conversations معطّلة');
        return;
    }

    function guardVerifiedEmail(emailNorm) {
        const em = String(emailNorm || '').trim().toLowerCase();
        if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
            return { ok: false, error: 'invalid_email' };
        }
        const row = findVerifiedRegistrationByEmail(em);
        if (!row) {
            return { ok: false, error: 'account_required', message: 'يلزم حساب مفعّل على الخادم لحفظ المحادثة.' };
        }
        return { ok: true, email: em };
    }

    app.post('/api/ai/conversations/sync', (req, res) => {
        try {
            const ip = getClientIpForRateLimit(req);
            if (!allowAiChatRate(ip)) {
                bump('conversations_sync_rate_limited');
                return res.status(429).json({ ok: false, error: 'rate_limit' });
            }
            const g = guardVerifiedEmail(req.body?.accountEmail);
            if (!g.ok) {
                bump('conversations_sync_denied');
                return res.status(403).json({ ok: false, error: g.error, message: g.message || '' });
            }
            let conversationId = String(req.body?.conversationId || '').trim();
            if (!conversationId) {
                conversationId = crypto.randomUUID();
            }
            const messages = req.body?.messages;
            if (!Array.isArray(messages)) {
                bump('conversations_sync_bad_request');
                return res.status(400).json({ ok: false, error: 'missing_messages' });
            }
            const summary = req.body?.summary;
            const userPreferences = req.body?.userPreferences;
            const pinnedFacts = req.body?.pinnedFacts;
            const r = conversationStore.upsertRow({
                conversationId,
                accountEmail: g.email,
                messages,
                summary,
                userPreferences,
                pinnedFacts
            });
            if (!r.ok) {
                bump('conversations_sync_fail');
                return res.status(400).json({ ok: false, error: r.error || 'save_failed' });
            }
            bump('conversations_sync_ok');
            return res.json({ ok: true, conversationId: r.conversationId, updatedAt: r.updatedAt });
        } catch (e) {
            console.error('[ai/conversations] sync:', e);
            bump('conversations_sync_server_error');
            return res.status(500).json({ ok: false, error: 'server_error' });
        }
    });

    app.get('/api/ai/conversations/last', (req, res) => {
        try {
            const ip = getClientIpForRateLimit(req);
            if (!allowAiChatRate(ip)) {
                return res.status(429).json({ ok: false, error: 'rate_limit' });
            }
            const g = guardVerifiedEmail(req.query?.account_email || req.query?.email);
            if (!g.ok) {
                return res.status(403).json({ ok: false, error: g.error, message: g.message || '' });
            }
            const row = conversationStore.getLastByEmail(g.email);
            if (!row) {
                return res.status(404).json({ ok: false, error: 'no_conversation' });
            }
            return res.json({ ok: true, ...row });
        } catch (e) {
            console.error('[ai/conversations] last:', e);
            return res.status(500).json({ ok: false, error: 'server_error' });
        }
    });

    app.get('/api/ai/conversations/:id', (req, res) => {
        try {
            const ip = getClientIpForRateLimit(req);
            if (!allowAiChatRate(ip)) {
                return res.status(429).json({ ok: false, error: 'rate_limit' });
            }
            const g = guardVerifiedEmail(req.query?.account_email || req.query?.email);
            if (!g.ok) {
                return res.status(403).json({ ok: false, error: g.error, message: g.message || '' });
            }
            const row = conversationStore.getById(req.params.id, g.email);
            if (!row) {
                return res.status(404).json({ ok: false, error: 'not_found' });
            }
            return res.json({ ok: true, ...row });
        } catch (e) {
            console.error('[ai/conversations] get:', e);
            return res.status(500).json({ ok: false, error: 'server_error' });
        }
    });

    app.patch('/api/ai/conversations/:id/pinned', (req, res) => {
        try {
            const ip = getClientIpForRateLimit(req);
            if (!allowAiChatRate(ip)) {
                return res.status(429).json({ ok: false, error: 'rate_limit' });
            }
            const g = guardVerifiedEmail(req.body?.accountEmail);
            if (!g.ok) {
                return res.status(403).json({ ok: false, error: g.error, message: g.message || '' });
            }
            const r = conversationStore.updatePinned(req.params.id, g.email, req.body?.pinnedFacts);
            if (!r.ok) {
                return res.status(r.error === 'not_found' ? 404 : 400).json({ ok: false, error: r.error });
            }
            return res.json({ ok: true });
        } catch (e) {
            console.error('[ai/conversations] pinned:', e);
            return res.status(500).json({ ok: false, error: 'server_error' });
        }
    });
}

module.exports = { registerConversationRoutes };
