const { AdvisorError } = require('../services/academicData');
const { profileWelcome, profileAccessMessage } = require('../services/advisorProfile');
const { randomUUID } = require('node:crypto');

const CONVERSATION_TTL = 30 * 60 * 1000;
const MAX_CONVERSATIONS = 500;

function sendAdvisorError(res, error) {
    if (error instanceof AdvisorError) {
        if (error.code === 'SCHEMA_UNVERIFIED') {
            console.warn('[ai-advisor] SCHEMA_UNVERIFIED', error.message);
            return res.status(503).json({
                status: 'error', code: error.code, error: 'ตอนนี้ยังยืนยันข้อมูลการเรียนจากแหล่งข้อมูลของมหาวิทยาลัยไม่ได้ กรุณาลองใหม่ภายหลัง'
            });
        }
        return res.status(error.status).json({ status: 'error', code: error.code, error: error.message });
    }
    // Driver errors can contain SQL, credentials, and request payloads.
    const reason = /^(?:ORA|NJS|DPI)-\d+$/.test(error?.code) ? error.code : 'unknown';
    console.warn('[ai-advisor] RETRIEVAL_FAILED', reason);
    return res.status(503).json({
        status: 'error', code: 'RETRIEVAL_FAILED',
        error: 'ค้นข้อมูลการเรียนไม่สำเร็จ กรุณาลองใหม่ภายหลัง'
    });
}

function createAIChatController(advisor, readProfile = async () => ({ status: 'sign_in_required' })) {
    const conversations = new Map();
    const handle = method => async (req, res) => {
        try {
            if (method !== 'chat') return res.json(await advisor[method](req.body));
            const authorization = req.headers?.authorization;
            const identity = await readProfile(authorization);
            res.set?.('Cache-Control', 'no-store');
            const requestedId = req.body?.conversationId;
            const tracked = req.body?.trackConversation === true;
            const owner = identity.status === 'verified' ? identity.userId : (!authorization ? null : undefined);
            const now = Date.now();
            const previous = tracked && owner !== undefined && typeof requestedId === 'string' ? conversations.get(requestedId) : null;
            const session = previous && previous.owner === owner && previous.expiresAt > now ? previous : null;
            const reset = tracked && requestedId && !session;
            const body = reset ? { ...req.body, context: {}, history: [], selectedCourseIds: [] } : req.body;
            const state = tracked && owner !== undefined ? session?.state || {} : null;
            const { conversationState, ...answer } = await advisor.chat(body, identity, state);
            let conversationId;
            if (conversationState && tracked && owner !== undefined) {
                if (session) conversations.delete(requestedId);
                if (conversations.size >= MAX_CONVERSATIONS) conversations.delete(conversations.keys().next().value);
                conversationId = session ? requestedId : randomUUID();
                conversations.set(conversationId, { owner, state: conversationState, expiresAt: Date.now() + CONVERSATION_TTL });
            }
            res.json({ ...answer, profileStatus: identity.status, ...(tracked ? { conversationId: conversationId || null } : {}) });
        } catch (error) {
            sendAdvisorError(res, error);
        }
    };
    async function welcome(req, res) {
        const identity = await readProfile(req.headers?.authorization);
        const verified = identity.status === 'verified';
        res.set('Cache-Control', 'no-store').json({ status: 'success', profileStatus: identity.status,
            welcome: verified ? profileWelcome(identity.profile) : null,
            profileMessage: verified ? null : profileAccessMessage(identity.status) });
    }
    return { chat: handle('chat'), validateCourses: handle('validateCourses'), welcome };
}

module.exports = { createAIChatController, sendAdvisorError };
