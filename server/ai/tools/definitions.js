/** مخططات function-calling لـ OpenAI Chat Completions */

const ASSISTANT_FUNCTION_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'web_search',
            description:
                'Search the public web for recent facts, news, sports, or prices. Use for time-sensitive or verifiable queries.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Focused search query (any language)' }
                },
                required: ['query']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'generate_image',
            description:
                'Generate a new image from a text description. Use when the user clearly asks to create, draw, or visualize an image.',
            parameters: {
                type: 'object',
                properties: {
                    prompt: { type: 'string', description: 'Detailed image description' }
                },
                required: ['prompt']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_server_time',
            description: 'Get current UTC date and time from the server.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_account_plan_snapshot',
            description:
                'Read-only: returns registration and subscription/trial for assistantContext account_email. Fields: planCode/planName, hasActivePaidSubscription, paidPlanCode, freeTrialActive, freeTrialExpired, hint. Use for «ما اشتراكي» / plan type — never infer INDEX5 from subscriptionsPage catalog text. If no_account_email, use user_subscription from context. Never invent.',
            parameters: { type: 'object', properties: {} }
        }
    },
    {
        type: 'function',
        function: {
            name: 'create_support_ticket',
            description:
                'Create a real support ticket in the Gosta system. ONLY after the user clearly asks to contact support / open a ticket / report a problem AND you have a valid email (from assistantContext account_email or explicit user email). Use concise subject and full message body.',
            parameters: {
                type: 'object',
                properties: {
                    subject: { type: 'string', description: 'Short ticket title' },
                    message: { type: 'string', description: 'Full problem description' },
                    email: {
                        type: 'string',
                        description: 'Optional override if user stated a different contact email; otherwise omit to use app account_email'
                    }
                },
                required: ['subject', 'message']
            }
        }
    }
];

module.exports = { ASSISTANT_FUNCTION_TOOLS };
