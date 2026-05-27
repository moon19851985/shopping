const fs = require('fs');
const path = require('path');

const p = path.join(__dirname, '..', 'admin-dashboard.html');
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);

const i = lines.findIndex((l) => l.includes('id="aiChatModal_INDEX2"'));
const k = lines.findIndex((l, idx) => idx > i && l.includes('pr-safe-auth-port'));

if (i < 0 || k < 0) {
    console.error('markers', i, k);
    process.exit(1);
}

const drawer = [
    '    <div id="adminAiDrawer" class="admin-ai-drawer" aria-hidden="true">',
    '        <button type="button" class="admin-ai-drawer__backdrop" onclick="closeAdminAiDrawer()" aria-label="إغلاق المساعد"></button>',
    '        <div class="admin-ai-drawer__panel" role="dialog" aria-label="مساعد GOSTA الذكي">',
    '            <iframe id="adminAiChatIframe" class="admin-ai-drawer__iframe" title="مساعد GOSTA الذكي" src="about:blank"></iframe>',
    '        </div>',
    '    </div>',
    '',
    '    <button type="button" id="gostaAdminAiFabBtn" class="gosta-ai-fab gosta-admin-ai-fab" aria-label="مساعد ذكي — لوحة التحكم" title="مساعد ذكي — لوحة التحكم">',
    '        <span class="gosta-ai-fab__icon" aria-hidden="true">🤖</span>',
    '    </button>',
    ''
];

const out = [...lines.slice(0, i), ...drawer, ...lines.slice(k)];
fs.writeFileSync(p, out.join('\n'), 'utf8');
console.log('ok, removed', k - i, 'lines');
