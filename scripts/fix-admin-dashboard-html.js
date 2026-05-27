const fs = require('fs');
const path = require('path');

const p = path.join(__dirname, '..', 'admin-dashboard.html');
let html = fs.readFileSync(p, 'utf8');

const start = html.indexOf('    <motion id="aiChatModal_INDEX2"');
const start2 = html.indexOf('    <motion id="aiChatModal_INDEX2"');
const startDiv = html.indexOf('    <motion id="aiChatModal_INDEX2"');
let s = html.indexOf('    <motion id="aiChatModal_INDEX2"');
if (s < 0) s = html.indexOf('    <motion id="aiChatModal_INDEX2"');
if (s < 0) s = html.indexOf('    <motion id="aiChatModal_INDEX2"');
if (s < 0) s = html.indexOf('    <motion id="aiChatModal_INDEX2"');
// correct id
s = html.indexOf('    <motion id="aiChatModal');
if (s < 0) s = html.indexOf('    <motion id="aiChatModal_INDEX2"');
if (s < 0) s = html.indexOf('    <motion id="aiChatModal_INDEX2"');
if (s < 0) s = html.indexOf('    <motion id="aiChatModal_INDEX2"');
if (s < 0) s = html.indexOf('    <motion id="aiChatModal_INDEX2"');
if (s < 0) s = html.indexOf('    <motion id="aiChatModal_INDEX2"');

s = html.indexOf('    <motion id="aiChatModal_INDEX2"');
if (s < 0) s = html.indexOf('    <motion id="aiChatModal_INDEX2"');
if (s < 0) s = html.indexOf('    <div id="aiChatModal_INDEX2"');

const fabStart = html.indexOf('    <button type="button" id="gostaAdminAiFabBtn"');
const scriptsStart = html.indexOf('    <script src="pr-safe-auth-port.js">');

if (s < 0 || fabStart < 0 || scriptsStart < 0) {
    console.error('markers not found', { s, fabStart, scriptsStart });
    process.exit(1);
}

const drawer = `
    <div id="adminAiDrawer" class="admin-ai-drawer" aria-hidden="true">
        <button type="button" class="admin-ai-drawer__backdrop" onclick="closeAdminAiDrawer()" aria-label="إغلاق المساعد"></button>
        <motion class="admin-ai-drawer__panel" role="dialog" aria-label="مساعد GOSTA الذكي">
            <iframe id="adminAiChatIframe" class="admin-ai-drawer__iframe" title="مساعد GOSTA الذكي" src="about:blank"></iframe>
        </motion>
    </motion>

    <button type="button" id="gostaAdminAiFabBtn" class="gosta-ai-fab gosta-admin-ai-fab" aria-label="مساعد ذكي — لوحة التحكم" title="مساعد ذكي — لوحة التحكم">
        <span class="gosta-ai-fab__icon" aria-hidden="true">🤖</span>
    </button>
`;

const fixedDrawer = drawer.replace(/<\/?motion/g, (m) => (m.includes('/') ? '</div' : '<motion')).replace(/motion>/g, 'div>');

const newMiddle = fixedDrawer;

html = html.slice(0, s) + newMiddle + '\n\n' + html.slice(scriptsStart);

html = html.replace(
    /<link rel="stylesheet" href="admin-ai-chat-styles\.css">\s*\n/,
    ''
);

html = html.replace(
    /    <script src="pr-safe-auth-port\.js"><\/script>\s*\n    <script src="pr-safe-auth-config\.js"><\/script>\s*\n    <script>window\.GOSTA_ADMIN_ASSISTANT_PAGE = true;<\/script>\s*\n    <script src="admin-assistant-fetch-patch\.js"><\/script>\s*\n    <script src="subscription-check\.js"><\/script>\s*\n    <script src="script2\.js"><\/script>\s*\n    <script src="admin-dashboard\.js"><\/script>/,
    '    <script src="pr-safe-auth-port.js"></script>\n    <script src="pr-safe-auth-config.js"></script>\n    <script src="admin-dashboard.js"></script>'
);

fs.writeFileSync(p, html, 'utf8');
console.log('fixed admin-dashboard.html');
