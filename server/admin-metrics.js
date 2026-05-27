/**
 * عدّادات خفيفة في الذاكرة لمسارات المساعد ولوحة المراقبة.
 * تُصفَر عند إعادة تشغيل عملية الخادم.
 */
'use strict';

const METRIC_KEYS = new Set([
    'ai_chat_not_configured',
    'ai_chat_rate_limited',
    'ai_chat_bad_request',
    'ai_chat_requests',
    'ai_chat_tool_json_ok',
    'ai_chat_tool_stream_ok',
    'ai_chat_tool_loop_fallback',
    'ai_chat_standard_json_ok',
    'ai_chat_standard_stream_ok',
    'ai_chat_openai_error',
    'ai_chat_queue_full',
    'ai_chat_timeout',
    'ai_chat_other_error',
    'ai_summarize_not_configured',
    'ai_summarize_rate_limited',
    'ai_summarize_bad_request',
    'ai_summarize_requests',
    'ai_summarize_success',
    'ai_summarize_openai_error',
    'ai_summarize_queue_full',
    'ai_summarize_timeout',
    'ai_summarize_other_error',
    'ai_image_not_configured',
    'ai_image_rate_limited',
    'ai_image_bad_request',
    'ai_image_requests',
    'ai_image_success',
    'ai_image_openai_error',
    'ai_image_queue_full',
    'ai_image_other_error',
    'ai_image_edit_not_configured',
    'ai_image_edit_rate_limited',
    'ai_image_edit_bad_request',
    'ai_image_edit_requests',
    'ai_image_edit_success',
    'ai_image_edit_openai_error',
    'ai_image_edit_queue_full',
    'ai_image_edit_timeout',
    'ai_image_edit_other_error',
    'conversations_sync_rate_limited',
    'conversations_sync_denied',
    'conversations_sync_bad_request',
    'conversations_sync_ok',
    'conversations_sync_fail',
    'conversations_sync_server_error',
    'admin_server_monitor_hits'
]);

const startMs = Date.now();
const counts = {};
for (const k of METRIC_KEYS) {
    counts[k] = 0;
}

function bump(key) {
    if (!METRIC_KEYS.has(key)) {
        return;
    }
    counts[key] += 1;
}

function snapshot() {
    return {
        startedAtUtc: new Date(startMs).toISOString(),
        uptimeSec: Math.floor((Date.now() - startMs) / 1000),
        counters: { ...counts }
    };
}

module.exports = { bump, snapshot };
