const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'index.html'), 'utf8').split(/\r?\n/);
const block = lines.slice(541, 675).join('\n');
const fab = [
    '',
    '    <button type="button" id="gostaAdminAiFabBtn" class="gosta-ai-fab gosta-admin-ai-fab" aria-label="مساعد ذكي — لوحة التحكم" title="مساعد ذكي — لوحة التحكم">',
    '        <span class="gosta-ai-fab__icon" aria-hidden="true">🤖</span>',
    '    </button>'
].join('\n');
fs.writeFileSync(path.join(root, '_admin-ai-fragment.html'), block + fab, 'utf8');
console.log('ok', (block + fab).length);
