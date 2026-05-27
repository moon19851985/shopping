/**
 * مخزن محادثات المساعد — SQLite (ملف محلي تحت server/data).
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MAX_MESSAGES_JSON_BYTES = 1_800_000;

function createConversationStore(sqlitePath) {
    const dir = path.dirname(sqlitePath);
    fs.mkdirSync(dir, { recursive: true });
    const db = new Database(sqlitePath);
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
            conversation_id TEXT PRIMARY KEY,
            account_email TEXT NOT NULL,
            messages_json TEXT NOT NULL,
            summary TEXT,
            user_preferences_json TEXT,
            pinned_facts_json TEXT,
            updated_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conversations_email_updated
        ON conversations(account_email, updated_at DESC);
    `);

    const selLast = db.prepare(
        `SELECT conversation_id, account_email, messages_json, summary, user_preferences_json, pinned_facts_json, updated_at, created_at
         FROM conversations WHERE account_email = ? ORDER BY updated_at DESC LIMIT 1`
    );
    const selById = db.prepare(
        `SELECT conversation_id, account_email, messages_json, summary, user_preferences_json, pinned_facts_json, updated_at, created_at
         FROM conversations WHERE conversation_id = ? AND account_email = ?`
    );
    const upsert = db.prepare(`
        INSERT INTO conversations (conversation_id, account_email, messages_json, summary, user_preferences_json, pinned_facts_json, updated_at, created_at)
        VALUES (@conversation_id, @account_email, @messages_json, @summary, @user_preferences_json, @pinned_facts_json, @updated_at, @created_at)
        ON CONFLICT(conversation_id) DO UPDATE SET
            messages_json = excluded.messages_json,
            summary = excluded.summary,
            user_preferences_json = excluded.user_preferences_json,
            pinned_facts_json = excluded.pinned_facts_json,
            updated_at = excluded.updated_at
    `);
    const patchPinned = db.prepare(`
        UPDATE conversations SET pinned_facts_json = @pinned_facts_json, updated_at = @updated_at
        WHERE conversation_id = @conversation_id AND account_email = @account_email
    `);

    function parseJson(raw, fallback) {
        if (raw == null || raw === '') {
            return fallback;
        }
        try {
            return JSON.parse(raw);
        } catch {
            return fallback;
        }
    }

    function rowToApi(r) {
        if (!r) return null;
        return {
            conversationId: r.conversation_id,
            accountEmail: r.account_email,
            messages: parseJson(r.messages_json, []),
            summary: r.summary || '',
            userPreferences: parseJson(r.user_preferences_json, null),
            pinnedFacts: parseJson(r.pinned_facts_json, []) || [],
            updatedAt: r.updated_at,
            createdAt: r.created_at
        };
    }

    function clampMessagesJson(messages) {
        let json = JSON.stringify(messages);
        if (json.length <= MAX_MESSAGES_JSON_BYTES) {
            return json;
        }
        const arr = Array.isArray(messages) ? messages.slice() : [];
        while (json.length > MAX_MESSAGES_JSON_BYTES && arr.length > 2) {
            arr.shift();
            json = JSON.stringify(arr);
        }
        return json;
    }

    return {
        db,
        getLastByEmail(emailNorm) {
            const em = String(emailNorm || '').trim().toLowerCase();
            if (!em) return null;
            const r = selLast.get(em);
            return rowToApi(r);
        },
        getById(conversationId, emailNorm) {
            const id = String(conversationId || '').trim();
            const em = String(emailNorm || '').trim().toLowerCase();
            if (!id || !em) return null;
            const r = selById.get(id, em);
            return rowToApi(r);
        },
        upsertRow({
            conversationId,
            accountEmail,
            messages,
            summary,
            userPreferences,
            pinnedFacts
        }) {
            const id = String(conversationId || '').trim();
            const em = String(accountEmail || '').trim().toLowerCase();
            if (!id || !em) {
                return { ok: false, error: 'missing_ids' };
            }
            const now = Date.now();
            const list = Array.isArray(messages) ? messages : [];
            const existing = selById.get(id, em);
            const created = existing ? existing.created_at : now;
            const pins =
                pinnedFacts !== undefined
                    ? (Array.isArray(pinnedFacts) ? pinnedFacts : []).map((s) => String(s).slice(0, 500)).slice(0, 24)
                    : parseJson(existing?.pinned_facts_json, []);
            const summaryVal =
                summary !== undefined
                    ? String(summary).slice(0, 8000)
                    : (existing && existing.summary) || '';
            const prefsVal =
                userPreferences !== undefined
                    ? JSON.stringify(userPreferences).slice(0, 12000)
                    : existing?.user_preferences_json || null;
            upsert.run({
                conversation_id: id,
                account_email: em,
                messages_json: clampMessagesJson(list),
                summary: summaryVal,
                user_preferences_json: prefsVal,
                pinned_facts_json: JSON.stringify(pins),
                updated_at: now,
                created_at: created
            });
            return { ok: true, conversationId: id, updatedAt: now };
        },
        updatePinned(conversationId, emailNorm, pinnedFacts) {
            const id = String(conversationId || '').trim();
            const em = String(emailNorm || '').trim().toLowerCase();
            if (!id || !em) return { ok: false, error: 'missing_ids' };
            const pins = Array.isArray(pinnedFacts)
                ? pinnedFacts.map((s) => String(s).slice(0, 500)).slice(0, 24)
                : [];
            const r = patchPinned.run({
                conversation_id: id,
                account_email: em,
                pinned_facts_json: JSON.stringify(pins),
                updated_at: Date.now()
            });
            if (r.changes === 0) {
                return { ok: false, error: 'not_found' };
            }
            return { ok: true };
        }
    };
}

module.exports = { createConversationStore, MAX_MESSAGES_JSON_BYTES };
