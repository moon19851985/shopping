/**
 * يمرّر x-admin-key لمسارات /api/ai من لوحة التحكم حتى يعمل المساعد حتى عند تعطيله للتطبيق.
 */
(function (global) {
    if (!global.GOSTA_ADMIN_ASSISTANT_PAGE || typeof global.fetch !== 'function') {
        return;
    }
    var nativeFetch = global.fetch.bind(global);
    global.fetch = function (input, init) {
        var url = '';
        try {
            url = typeof input === 'string' ? input : input && input.url ? String(input.url) : '';
        } catch (e) {}
        if (url.indexOf('/api/ai') !== -1) {
            init = init ? Object.assign({}, init) : {};
            var headers = new Headers(init.headers || {});
            if (!headers.has('x-admin-key')) {
                var key = global.PR_SAFE_AUTH && global.PR_SAFE_AUTH.adminKey ? global.PR_SAFE_AUTH.adminKey : '';
                if (key) {
                    headers.set('x-admin-key', key);
                }
            }
            init.headers = headers;
        }
        return nativeFetch(input, init);
    };
})(typeof window !== 'undefined' ? window : globalThis);
