const path = require('node:path');
require('dotenv').config({ path: [path.join(__dirname, '.env'), path.resolve('.env')], quiet: true });
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai'); // ไลบรารี OpenAI สำหรับต่อ Groq
const database = require('./src/config/oracle'); 
const apiRoutes = require('./src/routes/api');

const { createAcademicRepository } = require('./src/repositories/academicRepository');
const { createAIAdvisor } = require('./src/services/aiAdvisor');
const { createAIChatController } = require('./src/controllers/aiChatController');
const { AdvisorError } = require('./src/services/academicData');
const { createAdvisorProfileReader } = require('./src/services/advisorProfile');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); 
app.use(express.json()); 
app.use((error, req, res, next) => {
    if (!['/api/aichat', '/api/ai/courses/validate'].includes(req.path)) return next(error);
    const status = [400, 413, 415].includes(error.status) ? error.status : 400;
    return res.status(status).json({
        status: 'error', code: 'INVALID_REQUEST', error: 'ไม่สามารถอ่านคำขอ AI ได้ กรุณาตรวจรูปแบบและความยาวของข้อความ'
    });
});

let openai;
const aiAdvisor = createAIAdvisor({
    repository: createAcademicRepository(database),
    complete: async messages => {
        try {
            openai ||= new OpenAI({
                apiKey: process.env.GROQ_API_KEY,
                baseURL: 'https://api.groq.com/openai/v1',
                timeout: 15000,
                maxRetries: 0
            });
            const response = await openai.chat.completions.create({
                model: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
                temperature: 0,
                max_tokens: 800,
                response_format: { type: 'json_object' },
                messages
            });
            return response.choices[0]?.message?.content;
        } catch (error) {
            console.error('[ai-advisor] AI_UNAVAILABLE', Number.isInteger(error?.status) ? error.status : 'connection/configuration');
            throw new AdvisorError('AI_UNAVAILABLE', 'ติดต่อ Groq ไม่สำเร็จ กรุณาลองใหม่ภายหลัง', 502);
        }
    }
});
const aiChatController = createAIChatController(aiAdvisor, createAdvisorProfileReader({
    url: process.env.SUPABASE_URL,
    publicKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    onConfigError: code => console.warn('[advisor-profile]', code)
}));

function startup() {
    console.log(`\n=========================================`);
    console.log(`กำลังบูตระบบ SUT MortorSor Backend...`);
    const server = app.listen(PORT, () => {
        console.log(`🚀 เซิร์ฟเวอร์รันสำเร็จที่ http://localhost:${PORT}`);
        console.log(`⏳ กำลังสแตนด์บายรอรับคำสั่งจากหน้าเว็บ...`);
        console.log(`=========================================\n`);
    });
    server.on('error', (error) => {
        console.error(`\n❌ เซิร์ฟเวอร์พัง! สาเหตุ: ${error.message}\n`);
    });
    database.initialize().catch(() => console.error('[oracle] INITIALIZATION_FAILED'));
}

// /api/recommend, /api/courses (catalog: code, name, credits only), /api/timetable,
// /api/terms and /api/catalog/offerings are registered once in src/routes/api.js.
// The former inline /api/courses guessed the year (2569), the section ('1'), the
// weekday and the end time; it shadowed the router and was removed.

// Grounded AI responses and read-only enrollment validation.
app.post('/api/aichat', aiChatController.chat);
app.get('/api/ai/profile', aiChatController.welcome);
app.post('/api/ai/courses/validate', aiChatController.validateCourses);

app.use('/api', apiRoutes);

startup();
