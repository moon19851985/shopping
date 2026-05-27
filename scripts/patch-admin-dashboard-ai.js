const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dashPath = path.join(root, 'admin-dashboard.html');
const fragPath = path.join(root, '_admin-ai-fragment.html');
let html = fs.readFileSync(dashPath, 'utf8');
const frag = fs.readFileSync(fragPath, 'utf8');
const marker = '    <script src="pr-safe-auth-port.js"></script>';
if (!html.includes(marker)) {
    throw new Error('marker not found');
}
if (html.includes('gostaAdminAiFabBtn')) {
    console.log('already patched');
    process.exit(0);
}
html = html.replace(marker, frag + '\n\n' + marker);
const scripts = [
    '    <script>window.GOSTA_ADMIN_ASSISTANT_PAGE = true;</script>',
    '    <script src="admin-assistant-fetch-patch.js"></script>',
    '    <script src="subscription-check.js"></script>',
    '    <script src="script2.js"></script>'
].join('\n');
html = html.replace(
    '    <script src="pr-safe-auth-config.js"></script>\n    <script src="admin-dashboard.js"></script>',
    '    <script src="pr-safe-auth-config.js"></script>\n' + scripts + '\n    <script src="admin-dashboard.js"></script>'
);
fs.writeFileSync(dashPath, html, 'utf8');
console.log('patched admin-dashboard.html');
