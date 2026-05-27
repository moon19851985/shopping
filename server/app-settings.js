/**
 * إعدادات التطبيق العامة (تفعيل/تعطيل المساعد للمستخدمين).
 */
const fs = require('fs');
const path = require('path');

const APP_SETTINGS_PATH = path.join(__dirname, 'data', 'app-settings.json');

const DEFAULT_APP_SETTINGS = {
    assistantEnabledForApp: true,
    updatedAt: null
};

function readAppSettings() {
    try {
        if (!fs.existsSync(APP_SETTINGS_PATH)) {
            return { ...DEFAULT_APP_SETTINGS };
        }
        const raw = fs.readFileSync(APP_SETTINGS_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return {
            assistantEnabledForApp: parsed.assistantEnabledForApp !== false,
            updatedAt: parsed.updatedAt || null
        };
    } catch (e) {
        console.warn('[app-settings] read failed, using defaults:', e.message || e);
        return { ...DEFAULT_APP_SETTINGS };
    }
}

function ensureAppSettingsFile() {
    try {
        if (!fs.existsSync(APP_SETTINGS_PATH)) {
            writeAppSettings({ assistantEnabledForApp: true });
        }
    } catch (e) {
        console.warn('[app-settings] ensure file:', e.message || e);
    }
}

function writeAppSettings(partial) {
    const prev = readAppSettings();
    const next = {
        assistantEnabledForApp:
            partial && typeof partial.assistantEnabledForApp === 'boolean'
                ? partial.assistantEnabledForApp
                : prev.assistantEnabledForApp,
        updatedAt: new Date().toISOString()
    };
    fs.mkdirSync(path.dirname(APP_SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(APP_SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

module.exports = {
    APP_SETTINGS_PATH,
    readAppSettings,
    writeAppSettings,
    ensureAppSettingsFile
};
