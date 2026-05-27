const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexLines = fs.readFileSync(path.join(root, 'index.html'), 'utf8').split(/\r?\n/);
const aiBlock = indexLines.slice(541, 675).join('\n');

const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>مساعد GOSTA — لوحة التحكم</title>
    <link rel="stylesheet" href="admin-ai-chat-styles.css">
    <style>
        html, body { margin: 0; height: 100%; background: transparent; overflow: hidden; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    </style>
</head>
<body>
${aiBlock}
    <script src="pr-safe-auth-port.js"></script>
    <script src="pr-safe-auth-config.js"></script>
    <script>window.GOSTA_ADMIN_ASSISTANT_PAGE = true;</script>
    <script src="admin-assistant-fetch-patch.js"></script>
    <script src="subscription-check.js"></script>
    <script src="user-storage-scope.js"></script>
    <script src="script2.js"></script>
    <script>
        document.addEventListener('DOMContentLoaded', function () {
            if (typeof openAiChatModal_INDEX2 === 'function') {
                openAiChatModal_INDEX2(true);
            }
        });
    </script>
</body>
</html>
`;

fs.writeFileSync(path.join(root, 'admin-ai-chat.html'), html, 'utf8');
console.log('wrote admin-ai-chat.html');
