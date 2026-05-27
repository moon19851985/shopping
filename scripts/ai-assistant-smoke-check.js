/**
 * فحص خفيف: يتأكد من وجود علامات واجهة المساعد في script2.js (بدون تشغيل خادم).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const script2 = path.join(root, 'script2.js');
const idx = path.join(root, 'index.html');

function mustContain(file, label, needles) {
    const s = fs.readFileSync(file, 'utf8');
    for (let i = 0; i < needles.length; i++) {
        if (!s.includes(needles[i])) {
            console.error(`[ai-assistant-smoke] ${label}: missing "${needles[i]}"`);
            process.exit(1);
        }
    }
}

mustContain(script2, 'script2.js', [
    'tryParseInlineImageGenerationPrompt_INDEX2',
    'tryParseInlineImageEditIntent_INDEX2',
    'requestAiImageEditWithDataUrl_INDEX2',
    'appendOpenAiFriendlyHint_INDEX2',
    'persistLastAiImageToSession_INDEX2'
]);
mustContain(idx, 'index.html', ['ai-chat-usage-details', 'focusInlineEditLastImage_INDEX2', 'aiChatLogResizeHandle_INDEX2']);

console.log('[ai-assistant-smoke] markers OK');
