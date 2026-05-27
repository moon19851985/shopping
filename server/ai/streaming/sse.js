/**
 * بث SSE: من OpenAI إلى العميل، وحزم نص+صور+تذاكر للمسار مع الأدوات.
 */

function sendSseTextChunksAndImages(res, text, generatedImages, executedSupportTickets) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }
    const full = String(text || '');
    const step = 28;
    for (let i = 0; i < full.length; i += step) {
        const piece = full.slice(i, i + step);
        res.write(`data: ${JSON.stringify({ c: piece })}\n\n`);
    }
    if (Array.isArray(generatedImages)) {
        for (const g of generatedImages) {
            if (g && g.imageDataUrl) {
                res.write(
                    `data: ${JSON.stringify({
                        img: {
                            imageDataUrl: g.imageDataUrl,
                            revisedPrompt: g.revisedPrompt || null
                        }
                    })}\n\n`
                );
            }
        }
    }
    if (Array.isArray(executedSupportTickets)) {
        for (const t of executedSupportTickets) {
            if (t && t.ticketId) {
                res.write(`data: ${JSON.stringify({ ticket: { ticketId: t.ticketId } })}\n\n`);
            }
        }
    }
    res.write('data: [DONE]\n\n');
    res.end();
}

/** يمرّر تدفق SSE من OpenAI إلى العميل كأحداث data: {"c":"قطعة نص"} و data: [DONE] */
async function pipeOpenAiChatStreamToClient(openAiBody, res) {
    const reader = openAiBody.getReader();
    const dec = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += dec.decode(value, { stream: true });
            let sep;
            while ((sep = buffer.indexOf('\n\n')) >= 0) {
                const block = buffer.slice(0, sep);
                buffer = buffer.slice(sep + 2);
                for (const line of block.split('\n')) {
                    const t = line.trim();
                    if (!t.startsWith('data:')) continue;
                    const payload = t.slice(5).trim();
                    if (payload === '[DONE]') {
                        res.write('data: [DONE]\n\n');
                        continue;
                    }
                    try {
                        const o = JSON.parse(payload);
                        const piece =
                            o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content;
                        if (piece) {
                            res.write(`data: ${JSON.stringify({ c: piece })}\n\n`);
                        }
                        if (o.error) {
                            res.write(
                                `data: ${JSON.stringify({
                                    err: String(
                                        (o.error && o.error.message) || o.error.code || 'stream_error'
                                    )
                                })}\n\n`
                            );
                        }
                    } catch (_) {}
                }
            }
        }
        if (buffer.trim()) {
            for (const line of buffer.split('\n')) {
                const t = line.trim();
                if (!t.startsWith('data:')) continue;
                const payload = t.slice(5).trim();
                if (payload === '[DONE]' || !payload) continue;
                try {
                    const o = JSON.parse(payload);
                    const piece =
                        o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content;
                    if (piece) {
                        res.write(`data: ${JSON.stringify({ c: piece })}\n\n`);
                    }
                } catch (_) {}
            }
        }
    } finally {
        try {
            reader.releaseLock();
        } catch (_) {}
        if (!res.writableEnded) {
            res.write('data: [DONE]\n\n');
            res.end();
        }
    }
}

module.exports = {
    sendSseTextChunksAndImages,
    pipeOpenAiChatStreamToClient
};
