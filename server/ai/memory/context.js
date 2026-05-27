/** تفضيلات/ذاكرة جلسة من العميل — تُحقن في system prompt (لا تُضف حقول جديدة دون sanitizeAssistantContext لتجنب تسريب بيانات حساسة). يدعم ui_context (لقطة واجهة نصية من العميل). */

const AI_LANG_ALLOWED = new Set(['ar', 'en', 'auto', 'arabic', 'english']);
const USER_SUB_STATUS = new Set(['paid_active', 'trial_active', 'trial_expired', 'free']);
const USER_SUB_PLAN_CODES = new Set(['INDEX3', 'INDEX4', 'INDEX5']);

function sanitizeAssistantContext(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const o = {};
    const name = String(raw.name || '').trim().slice(0, 80);
    if (name) {
        o.name = name;
    }
    const lang = String(raw.language || '').trim().toLowerCase().slice(0, 12);
    if (lang && AI_LANG_ALLOWED.has(lang)) {
        o.language = lang;
    }
    if (raw.likes_short_answers === true || raw.likes_short_answers === 1 || raw.likes_short_answers === '1') {
        o.likes_short_answers = true;
    }
    let interests = raw.interested_in;
    if (typeof interests === 'string') {
        interests = interests
            .split(/[,،;؛]/)
            .map((s) => String(s || '').trim())
            .filter(Boolean);
    }
    if (Array.isArray(interests)) {
        const list = interests
            .map((x) => String(x || '').trim().slice(0, 48))
            .filter(Boolean)
            .slice(0, 10);
        if (list.length) {
            o.interested_in = list;
        }
    }
    const persona = String(raw.persona || '').trim().slice(0, 60);
    if (persona) {
        o.persona = persona;
    }
    const responseStyle = String(raw.response_style || '').trim().slice(0, 140);
    if (responseStyle) {
        o.response_style = responseStyle;
    }
    const summary = String(raw.conversation_summary || '').trim().slice(0, 2000);
    if (summary) {
        o.conversation_summary = summary;
    }
    let pinned = raw.pinned_facts;
    if (typeof pinned === 'string') {
        try {
            pinned = JSON.parse(pinned);
        } catch {
            pinned = null;
        }
    }
    if (Array.isArray(pinned) && pinned.length) {
        o.pinned_facts = pinned
            .map((x) => String(x || '').trim().slice(0, 500))
            .filter(Boolean)
            .slice(0, 24);
    }
    const persistent = String(raw.persistent_memory || '').trim().slice(0, 3500);
    if (persistent) {
        o.persistent_memory = persistent;
    }
    const acctEmail = String(raw.account_email || '').trim().slice(0, 120);
    if (acctEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acctEmail)) {
        o.account_email = acctEmail.toLowerCase();
    }
    /** لقطة واجهة من العميل (معرف صفحة، عناوين ظاهرة) — بدون حقول إدخال سرية */
    let uiCtx = String(raw.ui_context || '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
        .replace(/</g, '«')
        .replace(/>/g, '»')
        .trim()
        .slice(0, 4000);
    if (uiCtx) {
        o.ui_context = uiCtx;
    }
    let userSub = raw.user_subscription;
    if (userSub && typeof userSub === 'object' && !Array.isArray(userSub)) {
        const status = String(userSub.status || '')
            .trim()
            .toLowerCase();
        if (USER_SUB_STATUS.has(status)) {
            const subOut = { status };
            const planCode = String(userSub.plan_code || '')
                .trim()
                .toUpperCase();
            if (planCode && USER_SUB_PLAN_CODES.has(planCode)) {
                subOut.plan_code = planCode;
            }
            const planNameAr = String(userSub.plan_name_ar || '').trim().slice(0, 80);
            if (planNameAr) {
                subOut.plan_name_ar = planNameAr;
            }
            const trialRem = Number(userSub.trial_days_remaining);
            if (Number.isFinite(trialRem) && trialRem >= 0 && trialRem <= 366) {
                subOut.trial_days_remaining = Math.floor(trialRem);
            }
            o.user_subscription = subOut;
        }
    }
    return Object.keys(o).length ? o : null;
}

function buildAssistantMemorySystemBlock(ctx) {
    if (!ctx) {
        return '';
    }
    const parts = [
        '[User profile — preferences for this session from the app; not necessarily stored on a server. Honor them when consistent with the latest user message.]'
    ];
    if (ctx.name) {
        parts.push(`Name / how to address: ${ctx.name}.`);
    }
    if (ctx.language) {
        parts.push(`Language preference hint: ${ctx.language} (still follow the language of the current user message if they switch).`);
    }
    if (ctx.likes_short_answers) {
        parts.push('User prefers concise answers unless they explicitly ask for detail.');
    }
    if (ctx.interested_in && ctx.interested_in.length) {
        parts.push(`Interest topics: ${ctx.interested_in.join(', ')}.`);
    }
    if (ctx.persona) {
        parts.push(`Requested persona / mode: ${ctx.persona}.`);
    }
    if (ctx.response_style) {
        parts.push(`Tone / style: ${ctx.response_style}.`);
    }
    if (ctx.conversation_summary) {
        parts.push(`Summary of earlier conversation (may be partial):\n${ctx.conversation_summary}`);
    }
    if (ctx.pinned_facts && ctx.pinned_facts.length) {
        parts.push(
            `Pinned facts (treat as stable unless the user contradicts them):\n- ${ctx.pinned_facts.join('\n- ')}`
        );
    }
    if (ctx.persistent_memory) {
        parts.push(
            `[ذاكرة الجهاز — سجل من جلسات سابقة على نفس المتصفح؛ تبقى حتى بعد «مسح» المحادثة أو تحديث الصفحة. إذا سأل المستخدم عن عمره أو اسمه أو أي معلومة وردت صراحة في النص أدناه، أجب بناءً عليها بثقة (ما لم يقل في رسالته الحالية عكس ذلك).]\n${ctx.persistent_memory}`
        );
    }
    if (ctx.account_email) {
        parts.push(`Account email on device (for support / plan tools): ${ctx.account_email}.`);
    }
    if (ctx.user_subscription) {
        const us = ctx.user_subscription;
        parts.push(
            '[User subscription on this device — authoritative for «ما اشتراكي» / «نوع خطتي» / «هل أنا على المميزة». ' +
                'NOT the marketing plan cards on subscriptionsPage (ui_context keys خطط_معروضة_للشراء are for purchase only). ' +
                'If account_email is set, call get_account_plan_snapshot; if server disagrees with device on paid status, prefer server for paid/trial on account.]'
        );
        const subLine = [
            `status=${us.status}`,
            us.plan_code ? `plan_code=${us.plan_code}` : null,
            us.plan_name_ar ? `plan_name_ar=${us.plan_name_ar}` : null,
            us.trial_days_remaining != null ? `trial_days_left=${us.trial_days_remaining}` : null
        ]
            .filter(Boolean)
            .join(' ');
        parts.push(subLine);
    }
    if (ctx.ui_context) {
        parts.push(
            '[App UI snapshot — screen layout/labels when the user sent this message. ' +
                'Keys اشتراك_المستخدم_الحالي and user_subscription (if present) = their real plan; ' +
                'keys خطط_معروضة_للشراء = catalog on subscriptions page only, not what they own.]'
        );
        parts.push(String(ctx.ui_context));
    }
    return parts.join('\n');
}

module.exports = {
    sanitizeAssistantContext,
    buildAssistantMemorySystemBlock
};
