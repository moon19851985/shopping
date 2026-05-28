/**
 * إعداد المساعد للتطبيق (من الخادم) — لا يؤثر على مساعد لوحة التحكم.
 */
(function (global) {
    var LS_KEY = 'gostaAppAssistantEnabledV1';
    var state = { enabled: true, loaded: false, refreshPromise: null };

    function readLocalFallback() {
        try {
            var v = localStorage.getItem(LS_KEY);
            if (v === '0') return false;
            if (v === '1') return true;
        } catch (e) {}
        return true;
    }

    function writeLocal(enabled) {
        try {
            localStorage.setItem(LS_KEY, enabled ? '1' : '0');
        } catch (e) {}
    }

    global.isGostaAppAssistantEnabledForUsers_INDEX2 = function () {
        if (global.GOSTA_ADMIN_ASSISTANT_PAGE) {
            return true;
        }
        if (!state.loaded) {
            return readLocalFallback();
        }
        return !!state.enabled;
    };

    global.applyGostaAppAssistantUiVisibility_INDEX2 = function () {
        if (global.GOSTA_ADMIN_ASSISTANT_PAGE) {
            return;
        }
        var on = global.isGostaAppAssistantEnabledForUsers_INDEX2();
        if (document.body) {
            document.body.classList.toggle('gosta-app-assistant-off', !on);
        }
        if (!on) {
            try {
                if (typeof global.closeAiChatModal_INDEX2 === 'function') {
                    global.closeAiChatModal_INDEX2();
                }
            } catch (eClose) {}
        }
        try {
            if (typeof global.syncGostaAiFabVisibility_INDEX2 === 'function') {
                global.syncGostaAiFabVisibility_INDEX2();
            }
        } catch (eFab) {}
    };

    async function waitForAuthDiscovery() {
        try {
            if (global.PR_SAFE_AUTH_DISCOVERY && typeof global.PR_SAFE_AUTH_DISCOVERY.then === 'function') {
                await global.PR_SAFE_AUTH_DISCOVERY;
            }
        } catch (e) {}
    }

    global.refreshGostaAppAssistantSetting_INDEX2 = async function () {
        if (global.GOSTA_ADMIN_ASSISTANT_PAGE) {
            return true;
        }
        if (state.refreshPromise) {
            return state.refreshPromise;
        }
        state.refreshPromise = (async function () {
            await waitForAuthDiscovery();
            var enabled = readLocalFallback();
            var AUTH = global.PR_SAFE_AUTH || {};
            if (AUTH.apiBase) {
                try {
                    var r = await fetch(AUTH.apiBase + '/api/app-settings', { cache: 'no-store' });
                    if (r.ok) {
                        var j = await r.json();
                        if (j && typeof j.assistantEnabledForApp === 'boolean') {
                            enabled = j.assistantEnabledForApp;
                        }
                    }
                } catch (eFetch) {
                    console.warn('[gosta-app-assistant-settings] fetch:', eFetch);
                }
            }
            state.enabled = !!enabled;
            state.loaded = true;
            writeLocal(state.enabled);
            global.applyGostaAppAssistantUiVisibility_INDEX2();
            return state.enabled;
        })();
        try {
            return await state.refreshPromise;
        } finally {
            state.refreshPromise = null;
        }
    };

    function initAppAssistantSettingsWatcher() {
        if (global.GOSTA_ADMIN_ASSISTANT_PAGE) {
            return;
        }
        global.refreshGostaAppAssistantSetting_INDEX2();
        setInterval(function () {
            global.refreshGostaAppAssistantSetting_INDEX2();
        }, 60000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAppAssistantSettingsWatcher);
    } else {
        initAppAssistantSettingsWatcher();
    }
})(typeof window !== 'undefined' ? window : globalThis);
