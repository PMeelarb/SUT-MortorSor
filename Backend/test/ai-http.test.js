const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const { createRequire } = require('node:module');
const { createAdvisorProfileReader } = require('../src/services/advisorProfile');
const { context, mockDatabase } = require('./fixtures/academic');

function loadWithMocks(filename, mocks, env = {}) {
    const absolute = path.resolve(__dirname, '..', filename);
    const localRequire = createRequire(absolute);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(absolute, 'utf8'), {
        module, exports: module.exports, __dirname: path.dirname(absolute),
        require: name => Object.hasOwn(mocks, name) ? mocks[name] : localRequire(name),
        process: { env }, console: { log() {}, error() {}, warn() {} }
    }, { filename: absolute });
    return module.exports;
}

test('normal server routes work over local HTTP using mocked Oracle, Groq and Supabase', async t => {
    const database = mockDatabase();
    let finishInitialization;
    database.initialize = () => new Promise(resolve => { finishInitialization = resolve; });
    const loadedController = loadWithMocks('src/controllers/courseController.js', { '../config/oracle': database });
    // Adopt VM promises in this realm before passing them to Express.
    const controller = Object.fromEntries(Object.entries(loadedController)
        .map(([name, handler]) => [name, (...args) => Promise.resolve(handler(...args))]));
    const router = loadWithMocks('src/routes/api.js', { '../controllers/courseController': controller });
    let server;
    let ready;
    const listening = new Promise(resolve => { ready = resolve; });
    const expressFactory = () => {
        const app = express();
        const listen = app.listen.bind(app);
        app.listen = (port, callback) => {
            server = listen(0, '127.0.0.1', () => { callback(); ready(); });
            return server;
        };
        return app;
    };
    expressFactory.json = express.json;
    let providerCalls = 0;
    let providerUnavailable = false;
    class MockOpenAI {
        constructor() {
            this.chat = { completions: { create: async payload => {
                providerCalls++;
                if (providerUnavailable) throw Object.assign(new Error('mock API secret'), { status: 429 });
                assert.equal(payload.messages.filter(message => message.role === 'system').length, 1);
                const request = JSON.parse(payload.messages.at(-1).content);
                if (request.question === 'สวัสดีครับ') return { choices: [{ message: { content: JSON.stringify({
                    intent: 'greeting', reply: 'สวัสดีครับ สนใจวางแผนการเรียนเรื่องไหนครับ'
                }) } }] };
                return { choices: [{ message: { content: JSON.stringify({
                    answerType: 'both', courseCodes: ['TEST1001'], classIds: ['fixture-class-1']
                }) } }] };
            } } };
        }
    }
    const env = {};
    let profileMode = 'verified';
    let firstName = 'Fixture';
    loadWithMocks('server.js', {
        dotenv: { config(options) {
            assert.equal(options.path[0], path.resolve(__dirname, '../.env'));
            env.SUPABASE_URL = 'https://fixture.supabase.co';
            env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fixture';
        } }, express: expressFactory, openai: MockOpenAI,
        './src/config/oracle': database, './src/routes/api': router,
        './src/services/advisorProfile': {
            createAdvisorProfileReader: options => createAdvisorProfileReader({
                ...options,
                fetcher: async (url, options) => {
                    assert.equal(url.origin, env.SUPABASE_URL);
                    assert.equal(options.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
                    assert.equal(options.method, undefined);
                    const secondAccount = options.headers.Authorization === 'Bearer fixture-token-b';
                    if (!secondAccount && options.headers.Authorization !== 'Bearer fixture-token') return { ok: false, status: 401 };
                    const studentId = secondAccount ? 'B6712346' : 'B6712345';
                    if (url.pathname === '/auth/v1/user') return { ok: true, json: async () => ({
                        id: secondAccount ? 'fixture-user-b' : 'fixture-user', app_metadata: { student_id: studentId, year_level: 3 }
                    }) };
                    assert.equal(url.searchParams.get('student_id'), `eq.${studentId}`);
                    if (profileMode === 'database_unavailable') return { ok: false, status: 503 };
                    return { ok: true, json: async () => profileMode === 'profile_not_found' ? []
                        : [{ first_name: secondAccount ? 'SecondAccount' : firstName,
                            last_name: 'Surname', faculty: context.faculty, major: context.major }] };
                }
            })
        }
    }, env);
    await listening;
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (url, body) => fetch(base + url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });

    const greeting = await post('/api/aichat', { message: 'สวัสดีครับ', context });
    assert.equal(greeting.status, 200);
    assert.match((await greeting.json()).reply, /สวัสดีครับ/);
    assert.equal(database.calls.length, 0);
    finishInitialization();
    assert.equal(providerCalls, 1);

    const headers = { Authorization: 'Bearer fixture-token' };
    const welcome = await fetch(base + '/api/ai/profile', { headers });
    assert.equal(welcome.headers.get('cache-control'), 'no-store');
    const welcomeBody = await welcome.json();
    assert.equal(welcomeBody.profileStatus, 'verified');
    assert.match(welcomeBody.welcome, /Fixture/);
    assert.doesNotMatch(JSON.stringify(welcomeBody), /Surname|B6712345|fixture-token/);
    firstName = 'UpdatedName';
    const changed = await (await fetch(base + '/api/ai/profile', { headers })).json();
    assert.match(changed.welcome, /UpdatedName/);
    const second = await (await fetch(base + '/api/ai/profile', { headers: { Authorization: 'Bearer fixture-token-b' } })).json();
    assert.equal(second.profileStatus, 'verified');
    assert.match(second.welcome, /SecondAccount/);
    assert.doesNotMatch(second.welcome, /UpdatedName/);
    const signedOut = await (await fetch(base + '/api/ai/profile')).json();
    assert.equal(signedOut.welcome, null);
    assert.equal(signedOut.profileStatus, 'sign_in_required');
    for (const status of ['profile_not_found', 'database_unavailable']) {
        profileMode = status;
        const failure = await (await fetch(base + '/api/ai/profile', { headers })).json();
        assert.equal(failure.profileStatus, status);
        assert.equal(failure.welcome, null);
        assert.ok(failure.profileMessage);
    }
    profileMode = 'verified';
    const personal = await fetch(base + '/api/aichat', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'ช่วยแนะนำวิชาสาขาของผม ปี 1 เทอม 1', studentId: 'forged' })
    });
    assert.equal(personal.status, 200);
    const personalBody = await personal.json();
    assert.equal(personalBody.context.major, context.major);
    assert.equal(personalBody.context.yearLevel, 1);
    assert.equal(personalBody.context.semester, 1);
    assert.equal(personalBody.profileStatus, 'verified');
    assert.equal(providerCalls, 1);

    const malformed = await fetch(base + '/api/aichat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"message": invalid'
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).code, 'INVALID_REQUEST');
    const invalidMessage = await post('/api/aichat', { message: [] });
    assert.equal(invalidMessage.status, 400);
    assert.equal((await invalidMessage.json()).code, 'INVALID_MESSAGE');

    const healthyConnection = database.oracledb.getConnection;
    database.oracledb.getConnection = mockDatabase({ noKeys: true }).oracledb.getConnection;
    const unverified = await post('/api/aichat', { message: 'ปี 3 เทอม 2 ต้องเรียนอะไรบ้าง', context });
    assert.equal(unverified.status, 503);
    const unverifiedBody = await unverified.json();
    assert.equal(unverifiedBody.code, 'SCHEMA_UNVERIFIED');
    assert.doesNotMatch(unverifiedBody.error, /EXP_|foreign key|metadata\.sql/);
    database.oracledb.getConnection = healthyConnection;

    providerUnavailable = true;
    const offlineProvider = await post('/api/aichat', { message: 'สวัสดีครับ' });
    assert.equal(offlineProvider.status, 502);
    const providerBody = await offlineProvider.json();
    assert.equal(providerBody.code, 'AI_UNAVAILABLE');
    assert.doesNotMatch(providerBody.error, /mock API secret/);
    providerUnavailable = false;
    providerCalls = 0;

    const missing = await fetch(base + '/api/recommend?major=fixture&year=3&semester=2');
    assert.equal(missing.status, 422);
    assert.equal((await missing.json()).code, 'CONTEXT_REQUIRED');
    const query = new URLSearchParams(context);
    const plan = await fetch(base + '/api/recommend?' + query);
    assert.equal(plan.status, 200);
    const planBody = await plan.json();
    assert.equal(planBody.data[0].COURSECODE, 'TEST1001');
    assert.equal(planBody.data[0].SECTION, undefined);
    assert.equal(planBody.offerings[0].section, 'A');

    const response = await post('/api/aichat', { context, message: 'เพิ่มลงตาราง', history: [{ role: 'user', content: 'เพิ่มลงตาราง' }] });
    assert.equal(response.status, 200);
    const answer = await response.json();
    assert.match(answer.reply, /09:15–10:45/);
    assert.equal(providerCalls, 1);
    const validated = await post('/api/ai/courses/validate', { context, courses: answer.actions });
    assert.equal(validated.status, 200);
    assert.equal((await validated.json()).courses[0].meetings.length, 2);
    assert.equal(providerCalls, 1);

    const invalid = await post('/api/ai/courses/validate', { context, courses: [{ courseCode: 'TEST1001', section: '1' }] });
    assert.equal(invalid.status, 422);
    const legacy = await fetch(base + '/api/course/TEST1001?' + query);
    assert.equal(legacy.status, 200);
    const legacyBody = await legacy.json();
    assert.equal(legacyBody.data.length, 2);
    assert.equal(legacyBody.data[0].SECTION, 'A');
    assert.equal(legacyBody.data[0].MID_DATE, null);
    assert.equal((await fetch(base + '/api/course/TEST1001')).status, 422);
    assert.ok(database.calls.every(call => /^\s*SELECT/.test(call.sql)));

    const exported = mockDatabase({ exportSchema: true, planRows: [
        { COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: '2.5', UNRESOLVED_PLAN_ROWS: 1 },
        { COURSECODE: null, COURSENAME: null, COURSEUNIT: null, UNRESOLVED_PLAN_ROWS: 1 }
    ] });
    database.oracledb.getConnection = exported.oracledb.getConnection;
    const partial = await post('/api/aichat', { context, message: 'ปี 3 เทอม 2 ต้องเรียนอะไรบ้าง' });
    assert.equal(partial.status, 200);
    const partialBody = await partial.json();
    assert.equal(partialBody.outcome, 'plan_partial');
    assert.match(partialBody.reply, /ยืนยันรหัสวิชาไม่ได้ 1 รายการ/);
    const recommendation = await (await fetch(base + '/api/recommend?' + query)).json();
    assert.equal(recommendation.unresolvedPlanRows, 1);
    const fresh = await post('/api/ai/courses/validate', { context, courses: answer.actions });
    assert.equal(fresh.status, 200);
    assert.equal((await fresh.json()).unresolvedPlanRows, 1);
    assert.ok(exported.calls.every(call => /^\s*SELECT/.test(call.sql)));

    // V5 read-only endpoints: offered terms, term catalog, and timetable source on recommend.
    const catalogDb = mockDatabase({ headingRows: [
        { CONDITIONID: '1.', DESCRIPTION: 'หมวดวิชาศึกษาทั่วไป' }, { CONDITIONID: '2.', DESCRIPTION: 'หมวดวิชาเฉพาะ' }],
    programCourseRows: [{ COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: '2.5', CONDITIONID: '2.1' },
        { COURSECODE: 'GEN1001', COURSENAME: 'ศึกษาทั่วไปจำลอง', COURSEUNIT: '3', CONDITIONID: '1.2' }] });
    database.oracledb.getConnection = catalogDb.oracledb.getConnection;
    const terms = await (await fetch(base + '/api/terms')).json();
    assert.deepEqual(terms.terms.map(term => `${term.academicYear}/${term.semester}`), ['2568/3', '2569/1']);
    const catalogQuery = new URLSearchParams({ faculty: context.faculty, major: context.major, academicYear: 2569, semester: 2,
        mode: 'simulate', sourceAcademicYear: 2568, sourceSemester: 3 });
    const catalog = await (await fetch(base + '/api/catalog/offerings?' + catalogQuery)).json();
    assert.equal(catalog.status, 'success');
    assert.deepEqual(catalog.source, { mode: 'simulate', sourceAcademicYear: 2568, sourceSemester: 3 });
    assert.equal(catalog.courses.find(course => course.courseCode === 'TEST1001').category, 'major');
    assert.equal(catalog.courses.find(course => course.courseCode === 'GEN1001').category, 'genEd');
    assert.equal(catalog.courses.find(course => course.courseCode === 'GEN1001').status, 'not_offered');
    const missingTerm = await fetch(base + '/api/catalog/offerings?' + new URLSearchParams({ faculty: context.faculty, major: context.major }));
    assert.equal(missingTerm.status, 400);
    const badSource = await fetch(base + '/api/recommend?' + query + '&mode=invent');
    assert.equal(badSource.status, 400);
    assert.ok(catalogDb.calls.every(call => /^\s*SELECT/.test(call.sql)));

    // /api/timetable: year and term are required, never defaulted to 2569/1.
    const timetableDb = mockDatabase({ timetableRows: [{ COURSECODE: 'TEST1001', SECTION: 1, DAY_NAME: 'อาทิตย์', START_TIME: '08:00', END_TIME: '12:00' }] });
    database.oracledb.getConnection = timetableDb.oracledb.getConnection;
    for (const bad of ['', '?acadyear=2569', '?semester=1', '?acadyear=2569&semester=4', '?acadyear=x&semester=1']) {
        const response = await fetch(base + '/api/timetable' + bad);
        assert.equal(response.status, 400, bad);
    }
    assert.equal(timetableDb.calls.length, 0);
    const timetable = await (await fetch(base + '/api/timetable?acadyear=2569&semester=1')).json();
    assert.equal(timetable.status, 'success');
    const timetableCall = timetableDb.calls.at(-1);
    assert.deepEqual([timetableCall.binds.acadyear, timetableCall.binds.semester, timetableCall.binds.level0], [2569, 1, 1]);
    assert.match(timetableCall.sql, /EXP_SYSTIMEWEEK wk ON wk\.WEEKDAY = ct\.WEEKDAY/);
    assert.match(timetableCall.sql, /ts_end\.TIMESLOT = ct\.TIMESLOTTO \+ 1/);
    assert.match(timetableCall.sql, /c\.LEVELID IN \(:level0\)/);
    assert.doesNotMatch(timetableCall.sql, /WHEN 1 THEN|2569/);

    // /api/courses is the catalog-only router handler: code, name and credits; no guessed section or time.
    const courses = await (await fetch(base + '/api/courses')).json();
    assert.deepEqual(courses.data, [{ COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: '2.5' }]);
});
