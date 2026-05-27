const {
    AI_ASSISTANT_SUPPORT_TOOL_WINDOW_MS,
    AI_ASSISTANT_SUPPORT_TOOL_MAX
} = require('../models/config');

const assistantSupportTicketToolByIp = new Map();

function allowAssistantSupportTicketTool(clientIp) {
    const key = String(clientIp || 'unknown');
    const now = Date.now();
    const row = assistantSupportTicketToolByIp.get(key);
    if (!row || now - row.windowStart >= AI_ASSISTANT_SUPPORT_TOOL_WINDOW_MS) {
        assistantSupportTicketToolByIp.set(key, { windowStart: now, count: 1 });
        return true;
    }
    if (row.count >= AI_ASSISTANT_SUPPORT_TOOL_MAX) {
        return false;
    }
    row.count += 1;
    return true;
}

module.exports = { allowAssistantSupportTicketTool };
