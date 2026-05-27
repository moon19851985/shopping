/**
 * يبني admin-ai-chat-styles.css — قواعد المساعد فقط دون styles.css كاملاً.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'styles.css'), 'utf8').split(/\r?\n/);

const scopedButtons = `
/* أزرار وحقول داخل نافذة المساعد فقط */
.ai-chat-modal .btn-primary,
.ai-chat-prefs-dialog .btn-primary {
    padding: 10px 14px;
    background: linear-gradient(135deg, #667eea 0%, #3558b6 100%);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    margin-top: 0;
    width: auto;
}
.ai-chat-modal .btn-secondary,
.ai-chat-prefs-dialog .btn-secondary {
    padding: 10px 14px;
    background: #eef2fa;
    color: #1a2b5c;
    border: 1px solid rgba(42, 74, 155, 0.2);
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    width: auto;
}
.ai-chat-modal .form-group label,
.ai-chat-prefs-dialog .form-group label {
    display: block;
    margin-bottom: 4px;
    font-size: 13px;
    color: #20334f;
}
.ai-chat-modal .form-group input,
.ai-chat-modal .form-group select,
.ai-chat-modal .form-group textarea,
.ai-chat-prefs-dialog .form-group input,
.ai-chat-prefs-dialog .form-group select,
.ai-chat-prefs-dialog .form-group textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid #d9e0ee;
    border-radius: 8px;
    font-size: 14px;
}
`;

let modalBase = lines.slice(927, 959).join('\n');
modalBase = modalBase
    .replace(/^\.modal-content\b/gm, '#aiChatModal_INDEX2 .modal-content')
    .replace(/^\.modal\.show\b/gm, '#aiChatModal_INDEX2.modal.show')
    .replace(/^\.modal\b/gm, '#aiChatModal_INDEX2.modal');

const body = [
    '/* تنسيقات مساعد لوحة التحكم — لا تُستورد styles.css على اللوحة */',
    modalBase,
    scopedButtons,
    lines.slice(1042, 2340).join('\n')
].join('\n\n');

fs.writeFileSync(path.join(root, 'admin-ai-chat-styles.css'), body, 'utf8');
console.log('admin-ai-chat-styles.css', body.length, 'chars');
