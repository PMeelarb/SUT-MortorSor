const test = require('node:test');
const assert = require('node:assert/strict');
const { createAIAdvisor, contextFromRequest, sanitizeHistory } = require('../src/services/aiAdvisor');
const { createAcademicRepository } = require('../src/repositories/academicRepository');
const { createAIChatController } = require('../src/controllers/aiChatController');
const { createAdvisorProfileReader } = require('../src/services/advisorProfile');
const { AdvisorError, completeOffering, creditValue, dayName, timeMinutes } = require('../src/services/academicData');
const { context, offering, evidence, mockDatabase } = require('./fixtures/academic');

const copy = value => structuredClone(value);
const selection = { answerType: 'both', courseCodes: ['TEST1001'], classIds: ['fixture-class-1'] };

test('V6 keeps a plan across term changes and checks verified sections against conversational restrictions', async () => {
    const afternoon = (section, day) => ({ ...offering, section, classId: `fixture-${section}`,
        meetings: [{ day, start: '13:00', end: '15:00' }] });
    const { advisor, calls } = setup({ evidence: { ...evidence,
        offerings: [offering, afternoon('B', 'ศุกร์'), afternoon('C', 'จันทร์')] } });
    const identity = { status: 'verified', profile: { ...context, firstName: 'PrivateName' } };
    const history = [];
    let priorContext = {};
    const ask = async message => {
        const answer = await advisor.chat({ message, history, context: priorContext, selectedAcademicYear: context.academicYear,
            presentation: 'conversation' }, identity);
        priorContext = answer.conversationContext;
        history.push({ role: 'user', content: message }, { role: 'assistant', content: answer.reply });
        return answer;
    };
    const plan = await ask('ช่วยแนะนำวิชาปี 1 เทอม 2 หน่อย');
    assert.match(plan.reply, /ปี 1 เทอม 2/);
    assert.doesNotMatch(plan.reply, /PrivateName|TEST1001|\[oracle-/);
    assert.equal(plan.academicDetails.cards[0].code, 'TEST1001');
    const otherTerm = await ask('แล้วเทอม 3 ล่ะ');
    assert.equal(otherTerm.context.yearLevel, 1);
    assert.equal(otherTerm.context.semester, 3);
    assert.match(otherTerm.reply, /ปี 1 เทอม 3/);
    assert.equal(otherTerm.presentationStatus, 'fallback'); // This mock returned the old action shape, not a valid approach.
    const late = await ask('เอาที่ไม่เรียนเช้า');
    assert.deepEqual(late.academicDetails.cards[0].groups.map(group => group.section), ['B', 'C']);
    const freeFriday = await ask('ขอแบบว่างวันศุกร์');
    assert.deepEqual(freeFriday.academicDetails.cards[0].groups.map(group => group.section), ['C']);
    assert.deepEqual(freeFriday.scheduleOptions.excludeDays, ['ศุกร์']);
    assert.equal(freeFriday.scheduleOptions.skipPlanAction, true);
    assert.ok(calls.read.every(call => call.major === context.major && call.yearLevel === 1));
    assert.doesNotMatch(JSON.stringify(calls.messages), /PrivateName|TEST1001|รายวิชาจำลอง/);
});

test('V6 rejects extra model facts and uses the chosen conversational phrasing only when valid', async () => {
    const body = { message: 'แล้วเทอม 3 ล่ะ', context, history: [{ role: 'user', content: 'ช่วยแนะนำวิชาปี 3 เทอม 2' }], presentation: 'conversation' };
    const accepted = await setup({ content: '{"approach":"overview"}' }).advisor.chat(body);
    assert.equal(accepted.presentationStatus, 'ready');
    assert.match(accepted.reply, /^ตามแผนหลักสูตร/);
    const rejected = await setup({ content: '{"approach":"overview","reply":"FAKE9999 section Z"}' }).advisor.chat(body);
    assert.equal(rejected.presentationStatus, 'fallback');
    assert.doesNotMatch(JSON.stringify(rejected), /FAKE9999|section Z/);
    assert.equal(rejected.academicDetails.cards[0].code, 'TEST1001');
    const general = await setup({ content: '{"intent":"general","reply":"ลง FAKE9999 ได้เลย"}' }).advisor.chat({ message: 'ขอคำแนะนำหน่อย', presentation: 'conversation' });
    assert.doesNotMatch(general.reply, /FAKE9999/);
});
function setup(options = {}) {
    const calls = { read: [], messages: [] };
    const advisor = createAIAdvisor({
        repository: {
            async read(input, config) {
                calls.read.push(input);
                if (options.error) throw options.error;
                const data = copy(options.evidence || evidence);
                return config?.includeOfferings === false ? { ...data, offerings: [],
                    sources: data.sources.filter(source => source.id !== 'oracle-offerings') } : data;
            },
            async readCourse(search, input, config) {
                calls.catalog ||= [];
                calls.catalog.push({ search, input, config });
                if (options.error) throw options.error;
                return copy(options.catalog || { ...evidence, program: null, plan: [evidence.plan[0]] });
            }
        },
        complete: async messages => {
            calls.messages.push(messages);
            return options.content ?? JSON.stringify(selection);
        }
    });
    return { advisor, calls };
}

test('explicit academic context retrieves the plan without needing academic year or Groq', async () => {
    const { advisor, calls } = setup({ content: JSON.stringify({ ...selection, classIds: [] }) });
    const result = await advisor.chat({ message: 'แนะนำวิชา ปี 3', context: { faculty: context.faculty, major: context.major, yearLevel: 3, semester: 2 } });
    assert.equal(result.outcome, 'grounded');
    assert.equal(result.context.curriculumYear, 2565);
    assert.equal(result.context.academicYear, null);
    assert.equal(calls.read.length, 1);
    assert.equal(calls.messages.length, 0);
    assert.match(result.reply, /รายวิชาจำลอง/);
    assert.deepEqual(result.actions, []);
});

test('explicit years remain independent and typed year/semester are understood', () => {
    const result = contextFromRequest({ context }, 'ปีหลักสูตร 2564 ปีการศึกษา 2570 ชั้นปี 4 เทอม 3');
    assert.deepEqual(result, { ...context, curriculumYear: 2564, academicYear: 2570, yearLevel: 4, semester: 3 });
    assert.throws(() => contextFromRequest({ context: { ...context, semester: '2 OR 1=1' } }), /ไม่ถูกต้อง/);
    assert.throws(() => contextFromRequest(null), /บริบท/);
    assert.equal(contextFromRequest({ context }, 'แนะนำวิชาปี 1').yearLevel, 1);
    assert.equal(contextFromRequest({ context }, 'ปีหลักสูตร 2565 ปีการศึกษา 2569').yearLevel, 3);
    assert.deepEqual(contextFromRequest({ context }, 'ชั้นปีที่หนึ่งเทอมที่หนึ่ง ปีหลักสูตร 2565 ปีการศึกษา 2569'),
        { ...context, yearLevel: 1, semester: 1 });
    assert.deepEqual(contextFromRequest({ context }, 'ปี ๒ ภาคเรียนที่ ๓'), { ...context, yearLevel: 2, semester: 3 });
    assert.throws(() => contextFromRequest({ context }, 'เทอมสี่'), /ภาคเรียนไม่ถูกต้อง/);
});

test('missing profile asks only for absent academic profile fields', async () => {
    const { advisor, calls } = setup();
    const result = await advisor.chat({ message: 'แนะนำวิชา', context: { ...context, faculty: '', major: '' } });
    assert.equal(result.outcome, 'context_required');
    assert.match(result.reply, /สำนักวิชา \/ สาขาวิชา/);
    assert.doesNotMatch(result.reply, /ปีหลักสูตร \/ ปีการศึกษา/);
    assert.equal(calls.read.length, 0);
});

test('Oracle resolves a unique curriculum and plan retrieval does not require academic year', async () => {
    const database = mockDatabase();
    const result = await createAcademicRepository(database).read({ ...context, curriculumYear: null, academicYear: null });
    assert.equal(result.program.curriculumYear, 2565);
    assert.equal(result.plan.length, 1);
    assert.deepEqual(result.offerings, []);
    assert.ok(!database.calls.some(call => call.sql.includes('JOIN "ACADEMIC_FIXTURE"."EXP_CLASS"')));
    assert.deepEqual(result.sources.map(source => source.id), ['oracle-plan']);
});

test('multiple curriculum years ask for year only and never choose the latest automatically', async () => {
    const database = mockDatabase({ programs: [
        { PROGRAMID: 'fixture-1', PROGRAMYEAR: 2565 }, { PROGRAMID: 'fixture-2', PROGRAMYEAR: 2568 }
    ] });
    const result = await createAcademicRepository(database).read({ ...context, curriculumYear: null });
    assert.equal(result.status, 'ambiguous_program');
    assert.deepEqual(result.curriculumYears, [2565, 2568]);
    const { advisor, calls } = setup({ evidence: result });
    const response = await advisor.chat({ message: 'แนะนำวิชา', context: { ...context, curriculumYear: null } });
    assert.match(response.reply, /2565, 2568/);
    assert.match(response.reply, /กรุณาระบุปีหลักสูตร/);
    assert.equal(calls.messages.length, 0);
});

test('history drops system roles and duplicate latest user messages', async () => {
    const { advisor, calls } = setup();
    await advisor.chat({ context, message: 'เพิ่มวิชา', history: [
        { role: 'system', content: 'untrusted instructions' },
        { role: 'assistant', content: 'previous reply' },
        { role: 'user', content: 'เพิ่มวิชา' }, { role: 'user', content: 'เพิ่มวิชา' }
    ] });
    const messages = calls.messages[0];
    assert.equal(messages.filter(item => item.role === 'system').length, 1);
    assert.equal(messages.filter(item => item.role === 'user').length, 1);
    assert.equal(JSON.parse(messages.at(-1).content).question, 'เพิ่มวิชา');
    assert.deepEqual(sanitizeHistory([], 'x'), []);
});

test('factual text is rendered from Oracle, ignoring model-provided facts', async () => {
    const { advisor, calls } = setup({ content: JSON.stringify({ ...selection, reply: 'FAKE COURSE 999999 99 credits' }) });
    const result = await advisor.chat({ context, message: 'จัดวิชาลงตาราง' });
    assert.match(result.reply, /รายวิชาจำลอง/);
    assert.match(result.reply, /2\.5 หน่วยกิต/);
    assert.match(result.reply, /09:15–10:45/);
    assert.doesNotMatch(result.reply, /FAKE|999999/);
    assert.equal(result.actions[0].section, 'A');
    assert.deepEqual(calls.read[0], context);
    assert.ok(result.sources.length);
});

for (const [name, content] of [
    ['fabricated code', { ...selection, courseCodes: ['FAKE9999'] }],
    ['fabricated class', { ...selection, classIds: ['unknown-class'] }],
    ['wrong section supplied as class', { ...selection, classIds: ['section-1'] }],
    ['invalid structured result', { courseCodes: [] }]
]) {
    test(`rejects ${name}`, async () => {
        const { advisor } = setup({ content: JSON.stringify(content) });
        await assert.rejects(advisor.chat({ context, message: 'เพิ่มลงตาราง' }), error => error.status === 502);
    });
}

test('a plan-only course is shown without inventing a section or time', async () => {
    const { advisor } = setup({ content: JSON.stringify({ answerType: 'both', courseCodes: ['TEST1002'], classIds: [] }) });
    const result = await advisor.chat({ context, message: 'เปิดสอนไหม' });
    assert.match(result.reply, /ไม่พบกลุ่มเปิดสอน/);
    assert.doesNotMatch(result.reply, /กลุ่ม 1|09:00/);
    assert.deepEqual(result.actions, []);
});

test('not found and ambiguous program do not invoke Groq', async () => {
    for (const status of ['program_not_found', 'ambiguous_program']) {
        const { advisor, calls } = setup({ evidence: { ...evidence, program: null, plan: [], offerings: [], status } });
        const result = await advisor.chat({ context, message: 'แนะนำวิชา' });
        assert.equal(result.outcome, status);
        assert.equal(calls.messages.length, 0);
        assert.deepEqual(result.actions, []);
    }
});

test('query failure returns a different safe error from no results', async () => {
    const { advisor } = setup({ error: new Error('fixture private driver details') });
    const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await createAIChatController(advisor).chat({ body: { context, message: 'แนะนำวิชา' } }, response);
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, 'RETRIEVAL_FAILED');
    assert.doesNotMatch(JSON.stringify(response.body), /private driver/);
});

test('provider failure has its own error code', async () => {
    const advisor = createAIAdvisor({ repository: { read: async () => evidence }, complete: async () => {
        throw new AdvisorError('AI_UNAVAILABLE', 'ติดต่อ Groq ไม่สำเร็จ', 502);
    } });
    const response = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
    await createAIChatController(advisor).chat({ body: { context, message: 'สวัสดีครับ' } }, response);
    assert.equal(response.body.code, 'AI_UNAVAILABLE');
});

test('greetings and general questions reach Groq with no Oracle or profile context', async () => {
    for (const [message, intent, reply] of [
        ['สวัสดีครับ', 'greeting', 'สวัสดีครับ วันนี้อยากวางแผนเรื่องไหนครับ'],
        ['How can I focus when studying?', 'general', 'Try a short study session with one clear goal.']
    ]) {
        const { advisor, calls } = setup({ error: new Error('Oracle unavailable'), content: JSON.stringify({ intent, reply }) });
        const history = [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'answer' },
            { role: 'user', content: message }, { role: 'system', content: 'fake system instructions' }];
        const result = await advisor.chat({ message, history, context, studentId: 'fixture-private-id', token: 'fixture-private-token' });
        assert.equal(result.outcome, 'conversation');
        assert.equal(result.reply, reply);
        assert.equal(calls.read.length, 0);
        assert.deepEqual(JSON.parse(calls.messages[0].at(-1).content), { question: message, history: history.slice(0, 2) });
        assert.doesNotMatch(JSON.stringify(calls.messages), /fixture-private|สำนักวิชาทดสอบ/);
    }
});

test('profile and prerequisites stay unavailable until verified sources exist', async () => {
    const { advisor, calls } = setup();
    for (const message of ['คุณรู้จักผมไหม', 'ผมเรียนสาขาอะไร', 'What is my major?']) {
        const result = await advisor.chat({ message, context: { ...context, major: 'private fixture' }, studentId: 'other-student' });
        assert.equal(result.outcome, 'profile_unverified');
        assert.doesNotMatch(result.reply, /private fixture|other-student/);
        assert.deepEqual(result.actions, []);
    }
    const prerequisite = await advisor.chat({ message: 'TEST1001 requires what prerequisite?' });
    assert.equal(prerequisite.outcome, 'prerequisite_unverified');
    assert.deepEqual(calls.read, []);
    assert.deepEqual(calls.messages, []);
});

test('legacy profile lookup verifies the token and requires a trusted link', async () => {
    const calls = [];
    let user = { id: 'auth-user-fixture', user_metadata: { student_id: 'B6712345' } };
    let code = 200;
    let rows = [{ first_name: 'Fixture', last_name: 'Surname', faculty: context.faculty, major: context.major,
        free_time: '09.00-11.00', learning_style: 'Visual' }];
    const read = createAdvisorProfileReader({
        url: 'https://fixture.supabase.co', publicKey: 'sb_publishable_fixture', now: () => new Date('2026-11-19T00:00:00Z'),
        fetcher: async (url, options) => {
            calls.push({ url, options });
            const auth = url.pathname === '/auth/v1/user';
            return { status: auth ? code : 200, ok: !auth || code === 200, json: async () => auth ? user : rows };
        }
    });
    assert.equal((await read()).status, 'sign_in_required');
    assert.equal(calls.length, 0);
    assert.equal((await read('Bearer fixture-token')).status, 'profile_not_found');
    assert.equal(calls.length, 1);
    code = 401;
    assert.equal((await read('Bearer expired-token')).status, 'sign_in_required');
    assert.equal(calls.length, 2);
    code = 200;
    user = { ...user, app_metadata: { student_id: 'B6612345' } };
    const authentic = await read('Bearer fixture-token');
    assert.equal(authentic.status, 'verified');
    assert.equal(authentic.profile.yearLevel, 4);
    assert.equal(authentic.profile.curriculumYear, null);
    assert.equal(calls.at(-1).url.searchParams.get('student_id'), 'eq.B6612345');
    assert.equal(calls.at(-1).url.searchParams.get('select'), 'first_name,last_name,faculty,major,free_time,learning_style');
    assert.equal(authentic.profile.lastName, 'Surname');
    assert.equal(authentic.profile.freeTime, '09.00-11.00');
    assert.equal(authentic.profile.learningStyle, 'Visual');
    assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer fixture-token');
    rows = [...rows, ...rows];
    assert.equal((await read('Bearer fixture-token')).status, 'database_unavailable');
});

test('self-service profile lookup uses the verified Auth UID as its only account key', async () => {
    const requests = [];
    const user = {
        id: 'ab000000-0000-4000-8000-000000000001',
        user_metadata: {
            student_id: 'B6612345',
            student_profile: { reported_student_id: 'B6712345', curriculum_year: 2567 }
        }
    };
    const read = createAdvisorProfileReader({
        url: 'https://fixture.supabase.co', publicKey: 'sb_publishable_fixture', now: () => new Date('2026-11-19T00:00:00Z'),
        fetcher: async url => {
            requests.push(url);
            const data = url.pathname === '/auth/v1/user' ? user : [{ first_name: 'Fixture', faculty: context.faculty, major: context.major }];
            return { status: 200, ok: true, json: async () => data };
        }
    });
    const identity = await read('Bearer fixture-token');
    assert.equal(identity.status, 'verified');
    assert.equal(identity.profile.yearLevel, 3);
    assert.equal(identity.profile.curriculumYear, null);
    assert.equal(requests[0].pathname, '/auth/v1/user');
    assert.equal(requests[1].searchParams.get('student_id'), 'eq.U-AB000000000040008000000000000001');

    user.is_anonymous = true;
    assert.equal((await read('Bearer fixture-token')).status, 'sign_in_required');
    assert.equal(requests.length, 3);
});

test('advisor reads the signed-in profile without provisioning or substituting registration metadata', async () => {
    const validKey = 'U-AB000000000040008000000000000001';
    const user = { id: 'ab000000-0000-4000-8000-000000000001', user_metadata: {
        student_profile: { first_name: 'Unverified fixture', major: 'Unverified program' }
    } };
    const calls = [];
    let rows = [];
    let readable = true;
    const read = createAdvisorProfileReader({
        url: 'https://fixture.supabase.co', publicKey: 'sb_publishable_fixture',
        fetcher: async (url, options) => {
            calls.push(url.pathname);
            assert.equal(options.headers.Authorization, 'Bearer fixture-token');
            assert.equal(options.headers.apikey, 'sb_publishable_fixture');
            assert.equal(options.redirect, 'error');
            assert.equal(options.cache, 'no-store');
            assert.equal(options.method, undefined);
            switch (url.pathname) {
                case '/auth/v1/user':
                    return { ok: true, json: async () => user };
                case '/rest/v1/profiles':
                    assert.equal(url.searchParams.get('student_id'), `eq.${validKey}`);
                    return readable ? { ok: true, json: async () => rows } : { ok: false, status: 503 };
                default:
                    assert.fail(url.pathname);
            }
        }
    });
    assert.deepEqual(await read('Bearer fixture-token'), { status: 'profile_not_found' });
    assert.deepEqual(calls, ['/auth/v1/user', '/rest/v1/profiles']);
    readable = false;
    assert.deepEqual(await read('Bearer fixture-token'), { status: 'database_unavailable' });
    readable = true;
    rows = [{ first_name: 'Stored fixture', major: context.major }];
    const result = await read('Bearer fixture-token');
    assert.equal(result.status, 'verified');
    assert.equal(result.profile.firstName, 'Stored fixture');
    assert.equal(result.profile.yearLevel, null);
    assert.deepEqual(calls, Array(3).fill(['/auth/v1/user', '/rest/v1/profiles']).flat());
});

test('advisor rejects privileged keys and invalid URLs without sending a token or logging credentials', async () => {
    const jwt = (role, ref) => `header.${Buffer.from(JSON.stringify({ role, ref })).toString('base64url')}.signature`;
    const origin = 'https://fixture.supabase.co';
    for (const [url, publicKey, expected] of [
        [`${origin}/rest/v1`, 'sb_publishable_fixture', 'SUPABASE_URL_INVALID'],
        ['http://fixture.supabase.co', 'sb_publishable_fixture', 'SUPABASE_URL_INVALID'],
        [origin, undefined, 'SUPABASE_PUBLISHABLE_KEY_INVALID'],
        [origin, 'sb_secret_fixture', 'SUPABASE_PUBLISHABLE_KEY_INVALID'],
        [origin, jwt('service_role', 'fixture'), 'SUPABASE_PUBLISHABLE_KEY_INVALID'],
        [origin, jwt('anon', 'wrongproject'), 'SUPABASE_PUBLISHABLE_KEY_INVALID']
    ]) {
        const diagnostics = [];
        const read = createAdvisorProfileReader({
            url, publicKey, onConfigError: code => diagnostics.push(code),
            fetcher: () => assert.fail('Invalid configuration must not start a request')
        });
        assert.deepEqual(await read('Bearer fixture-token'), { status: 'configuration_error' });
        assert.deepEqual(diagnostics, [expected]);
    }
    const legacyKey = jwt('anon', 'fixture');
    const read = createAdvisorProfileReader({
        url: origin, publicKey: legacyKey, onConfigError: assert.fail,
        fetcher: async (url, { headers }) => {
            assert.equal(url.pathname, '/auth/v1/user');
            assert.equal(headers.apikey, legacyKey);
            return { status: 401 };
        }
    });
    assert.deepEqual(await read('Bearer invalid-fixture-token'), { status: 'sign_in_required' });
    const apiKeyRejected = createAdvisorProfileReader({
        url: origin, publicKey: 'sb_publishable_fixture',
        fetcher: async () => ({ status: 401, json: async () => ({ message: 'Invalid API key' }) })
    });
    assert.deepEqual(await apiKeyRejected('Bearer fixture-token'), { status: 'configuration_error' });
});

test('verified profile greets by name and fills only missing Oracle plan fields', async () => {
    const { advisor, calls } = setup();
    const identity = { status: 'verified', profile: {
        firstName: 'Fixture', faculty: context.faculty, major: context.major, yearLevel: 3, curriculumYear: 2565
    } };
    const greeting = await advisor.chat({ message: 'สวัสดีครับ' }, identity);
    assert.equal(greeting.outcome, 'personal_greeting');
    assert.match(greeting.reply, /Fixture/);
    assert.equal(calls.messages.length, 0);
    const result = await advisor.chat({
        message: 'สวัสดีครับ ช่วยแนะนำวิชาสาขาของผมตอนปี1 เทอม1 ให้หน่อยครับ', selectedSemester: 2
    }, identity);
    assert.equal(result.outcome, 'grounded');
    assert.deepEqual(calls.read[0], { ...context, yearLevel: 1, semester: 1, academicYear: null });
    assert.equal(result.conversationContext.major, '');
    assert.equal(result.conversationContext.yearLevel, 1);
    const updatedIdentity = { status: 'verified', profile: { ...identity.profile, major: 'สาขาใหม่' } };
    await advisor.chat({
        message: 'แนะนำวิชาตามแผน', context: result.conversationContext
    }, updatedIdentity);
    assert.equal(calls.read[1].major, 'สาขาใหม่');
    await advisor.chat({ message: 'แนะนำวิชาตามแผน', selectedSemester: 2 }, identity);
    assert.equal(calls.read[2].yearLevel, 3);
    assert.equal(calls.read[2].semester, 2);
    assert.equal(calls.messages.length, 0);
});

test('profile questions answer from verified fields without asking Groq or disclosing unrelated fields', async () => {
    const { advisor, calls } = setup();
    const identity = { status: 'verified', profile: {
        firstName: 'Fixture', lastName: 'Surname', faculty: 'Faculty fixture', major: 'Major fixture',
        yearLevel: 3, curriculumYear: null, freeTime: '09.00-11.00', learningStyle: 'Visual fixture'
    } };
    for (const [message, expected] of [
        ['สวัสดีครับ คุณรู้จักผมไหม', /Fixture.*ชั้นปีที่ 3.*Major fixture/],
        ['ผมชื่ออะไร', /ชื่อในโปรไฟล์ Fixture Surname/],
        ['ผมเรียนสาขาอะไร', /^สาขาวิชา Major fixture$/],
        ['ผมอยู่สำนักวิชาอะไร', /^สำนักวิชา Faculty fixture$/],
        ['ผมอยู่ชั้นปีไหน', /^ชั้นปี 3$/],
        ['ปีหลักสูตรของผมคือปีอะไร', /ยังไม่ได้บันทึกปีหลักสูตร/],
        ['ผมว่างเมื่อไหร่', /^ช่วงเวลาว่าง 09\.00-11\.00$/],
        ['ผมมีสไตล์การเรียนอะไร', /^สไตล์การเรียน Visual fixture$/]
    ]) {
        const result = await advisor.chat({ message, profile: { firstName: 'Forged' } }, identity);
        assert.equal(result.outcome, 'personal_profile', message);
        assert.match(result.reply, expected);
        assert.doesNotMatch(result.reply, /Forged/);
    }
    assert.equal(calls.messages.length, 0);
    assert.equal(calls.read.length, 0);
});

test('implicit major and follow-up keep the requested term and reload the account program defaults', async () => {
    const { advisor, calls } = setup();
    const identity = { status: 'verified', profile: {
        firstName: 'Fixture', faculty: context.faculty, major: context.major, yearLevel: 3, curriculumYear: 2565
    } };
    const first = { role: 'user', content: 'ช่วยแนะนำวิชาสาขาปี 1 เทอม 1 ให้หน่อย' };
    const result = await advisor.chat({ message: first.content, selectedSemester: 3 }, identity);
    assert.equal(result.outcome, 'grounded');
    assert.match(result.reply, /ชั้นปีที่ 1 ภาคเรียนที่ 1/);
    assert.doesNotMatch(result.reply, /(?:กรุณาระบุ|ขอทราบ).*สาขาวิชา/);
    assert.equal(result.conversationContext.major, '');
    assert.equal(calls.read[0].major, context.major);

    const updated = { status: 'verified', profile: { ...identity.profile, major: 'สาขาที่อัปเดต', curriculumYear: null } };
    const followup = await advisor.chat({ message: 'แล้วปี 2 ล่ะ', context: result.conversationContext,
        history: [first, { role: 'user', content: 'ผมชื่ออะไร' }] }, updated);
    assert.equal(followup.outcome, 'grounded');
    assert.deepEqual(calls.read[1], { ...context, major: updated.profile.major, yearLevel: 2, semester: 1, curriculumYear: null, academicYear: null });

    const blankMajor = { status: 'verified', profile: { ...identity.profile, major: '' } };
    const missing = await advisor.chat({ message: 'ช่วยแนะนำวิชา สาขาปี 1 เทอม 1 ให้หน่อย' }, blankMajor);
    assert.match(missing.reply, /ขอทราบสาขาวิชา/);
    assert.doesNotMatch(missing.reply, /สำนักวิชา/);
    assert.equal(calls.read.length, 2);
});

test('dictated Thai greeting and academic follow-ups use the verified profile and spoken numbers', async () => {
    const { advisor, calls } = setup();
    const identity = { status: 'verified', profile: { ...context, firstName: 'Fixture' } };
    const greeting = await advisor.chat({ message: 'สวัสดีครับ สวัสดีครับ' }, identity);
    assert.equal(greeting.outcome, 'personal_greeting');
    assert.match(greeting.reply, /Fixture/);

    const question = 'ช่วยแนะนำวิชาสาขาปีหนึ่ง เทอมหนึ่งให้หน่อยครับ';
    const first = await advisor.chat({ message: question, selectedSemester: 2 }, identity);
    assert.equal(first.outcome, 'grounded');
    assert.equal(calls.read[0].major, context.major);
    assert.equal(first.context.yearLevel, 1);
    assert.equal(first.context.semester, 1);

    const history = [{ role: 'user', content: question }];
    const next = await advisor.chat({ message: 'ชั้นปีที่สองเทอมที่หนึ่ง', history, context: first.conversationContext }, identity);
    assert.equal(next.outcome, 'grounded');
    assert.equal(next.context.yearLevel, 2);
    assert.equal(next.context.semester, 1);
    assert.equal(calls.messages.length, 0);
});

test('a faculty named without its prefix still uses the verified profile major and curriculum', async () => {
    const { advisor, calls } = setup();
    const identity = { status: 'verified', profile: { ...context } };
    const result = await advisor.chat({ message: 'ช่วยแนะนำวิชา ปี 1 เทอม 1, สำนักวิชา: ทดสอบ' }, identity);
    assert.equal(result.outcome, 'grounded');
    assert.equal(calls.read[0].major, context.major);
    assert.equal(calls.read[0].curriculumYear, context.curriculumYear);
});

test('general conversation works without Supabase and sends no profile turns or credentials to Groq', async () => {
    const { advisor, calls } = setup({ content: JSON.stringify({ intent: 'general', reply: 'ลองอ่านเป็นช่วงสั้น ๆ ครับ' }) });
    const body = {
        message: 'ขอเทคนิคอ่านหนังสือ B6712345 Bearer fixture-access-token',
        history: [{ role: 'user', content: 'ผมชื่ออะไร' }, { role: 'assistant', content: 'Fixture Surname' }]
    };
    const result = await advisor.chat(body, { status: 'database_unavailable' });
    assert.equal(result.outcome, 'conversation');
    assert.doesNotMatch(JSON.stringify(calls.messages), /B6712345|fixture-access-token|Fixture Surname/);
    for (const [status, expected] of [
        ['configuration_error', /ตั้งค่า/], ['profile_not_found', /ยังไม่พบโปรไฟล์/],
        ['database_unavailable', /อ่านโปรไฟล์.*ไม่สำเร็จ/]
    ]) {
        const failure = await advisor.chat({ message: 'ช่วยแนะนำวิชาสาขาปี 1 เทอม 1' }, { status });
        assert.match(failure.reply, expected);
        assert.equal(failure.outcome, 'profile_unverified');
    }
    assert.equal(calls.read.length, 0);
});

test('saved availability can filter verified meetings and an explicit time takes precedence', async () => {
    const { advisor, calls } = setup();
    const identity = { status: 'verified', profile: { freeTime: '09.00-11.00' } };
    const saved = await advisor.chat({ message: 'ขอดูตารางเรียนตามเวลาว่างวันจันทร์', context }, identity);
    assert.match(saved.reply, /TEST1001.+กลุ่ม A/);
    const typed = await advisor.chat({ message: 'ขอดูตารางเรียนตามเวลาว่างวันจันทร์ 11:00-12:00', context }, identity);
    assert.doesNotMatch(typed.reply, /TEST1001.+กลุ่ม A/);
    const missing = await advisor.chat({ message: 'ขอดูตารางเรียนตามเวลาว่างวันจันทร์', context }, {
        status: 'verified', profile: { freeTime: 'บางวันช่วงเช้า' }
    });
    assert.match(missing.reply, /ขอทราบช่วงเวลาว่าง/);
    assert.equal(calls.read.length, 2);
    assert.equal(calls.messages.length, 0);
});

test('personal plan without verified identity explains how to connect without repeating fields', async () => {
    const { advisor, calls } = setup();
    const result = await advisor.chat({
        message: 'ช่วยแนะนำวิชาสาขาของผมตอนปี1 เทอม1', profile: { major: 'Forged', faculty: 'Forged' }
    }, { status: 'sign_in_required' });
    assert.equal(result.outcome, 'profile_unverified');
    assert.match(result.reply, /เข้าสู่ระบบเพื่อให้แชตใช้ข้อมูลโปรไฟล์/);
    assert.doesNotMatch(result.reply, /พิมพ์ในรูปแบบ|Forged/);
    assert.equal(calls.read.length, 0);
});

test('a validated model intent can route an informal question but its academic prose is discarded', async () => {
    const { advisor, calls } = setup({ content: JSON.stringify({ intent: 'study_plan', reply: 'FAKE9999' }) });
    const result = await advisor.chat({ message: 'เทอมนี้เอาอะไรดีนะ', context });
    assert.equal(result.outcome, 'grounded');
    assert.equal(calls.read.length, 1);
    assert.doesNotMatch(result.reply, /FAKE9999|ข้อมูลเปิดสอน ปีการศึกษา/);
    const invalid = setup({ content: JSON.stringify({ intent: 'run_sql', reply: 'SELECT * FROM EXP_STUDENT' }) });
    await assert.rejects(invalid.advisor.chat({ message: 'ข้อความทดสอบ', context }), { code: 'MODEL_OUTPUT_INVALID' });
    assert.deepEqual(invalid.calls.read, []);
});

test('follow-up keeps the plan scope, requests the academic year and filters verified Monday sections', async () => {
    const { advisor, calls } = setup();
    const first = { role: 'user', content: 'ปี 3 เทอม 2 ต้องเรียนอะไรบ้าง' };
    const second = { role: 'user', content: 'แล้ววิชาไหนเปิดวันจันทร์' };
    const plan = await advisor.chat({ message: first.content, context: { ...context, academicYear: null } });
    assert.match(plan.reply, /แผนการเรียนตามหลักสูตร/);
    const clarification = await advisor.chat({ message: second.content, context: plan.context, history: [first] });
    assert.equal(clarification.outcome, 'context_required');
    assert.match(clarification.reply, /ปีการศึกษา/);
    assert.doesNotMatch(clarification.reply, /(?:กรุณาระบุ|ขอทราบ).*ปีหลักสูตร/);
    const result = await advisor.chat({ message: 'ปีการศึกษา 2569', context: clarification.context, history: [first, second] });
    assert.match(result.reply, /วันจันทร์.*oracle-offerings/);
    assert.match(result.reply, /TEST1001.+กลุ่ม A/);
    assert.match(result.reply, /TEST1002 — ไม่พบกลุ่มเปิดสอน/);
    assert.deepEqual(calls.read.map(item => item.academicYear), [null, 2569]);
});

test('explicit other-program context discards the previously selected curriculum year', async () => {
    const { advisor, calls } = setup();
    const result = await advisor.chat({
        message: 'สำนักวิชา: สำนักวิชาอื่น, สาขาวิชา: สาขาอื่น, ปี 3 เทอม 2 ต้องเรียนอะไรบ้าง', context
    });
    assert.equal(calls.read[0].faculty, 'สำนักวิชาอื่น');
    assert.equal(calls.read[0].major, 'สาขาอื่น');
    assert.equal(calls.read[0].curriculumYear, null);
    assert.equal(result.outcome, 'grounded');
});

test('course catalog and actual offerings use different retrieval scopes', async () => {
    const database = mockDatabase({ noKeys: true });
    const repository = createAcademicRepository(database);
    const advisor = createAIAdvisor({ repository, complete: async () => assert.fail('academic facts must come from Oracle') });
    const byCode = await advisor.chat({ message: 'TEST1001' });
    assert.match(byCode.reply, /2\.5 credits/);
    assert.deepEqual(database.calls.at(-1).binds, { courseCode: 'TEST1001' });
    const byName = await advisor.chat({ message: 'ค้นหาวิชา "รายวิชาจำลอง"' });
    assert.equal(byName.outcome, 'grounded');
    assert.deepEqual(database.calls.at(-1).binds, { courseName: 'รายวิชาจำลอง' });
    assert.ok(database.calls.every(call => !/FROM ALL_CONSTRAINTS|EXP_CLASS"/.test(call.sql)));

    const offeredDb = mockDatabase({ noTimetableKey: true, offeringRows: [
        { COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: '2.5', CLASSID: 'fixture-class', SECTION: 'A' }
    ] });
    const direct = createAIAdvisor({ repository: createAcademicRepository(offeredDb) });
    const result = await direct.chat({ message: 'Is TEST1001 offered in academic year 2569, term 2?' });
    assert.match(result.reply, /section A/);
    assert.match(result.reply, /details must be verified/);
    assert.deepEqual(result.actions, []);
    assert.deepEqual(offeredDb.calls.at(-1).binds, { academicYear: 2569, semester: 2, level0: 1, courseId: 'fixture-course-1' });
    assert.doesNotMatch(offeredDb.calls.at(-1).sql, /EXP_STUDYPLAN|EXP_CLASSTIMETABLE/);
});

test('empty catalog results never use Groq to invent a course', async () => {
    const database = mockDatabase({ catalogRows: [], noKeys: true });
    const advisor = createAIAdvisor({ repository: createAcademicRepository(database), complete: async () => assert.fail('unexpected Groq request') });
    const result = await advisor.chat({ message: 'มีข้อมูลรหัสวิชา FAKE9999 ไหม' });
    assert.equal(result.outcome, 'course_not_found');
    assert.match(result.reply, /ไม่พบรายวิชา/);
    assert.deepEqual(result.actions, []);
});

test('schedule suggestions filter conflicts and stated availability before the model sees candidates', async () => {
    const blocked = setup();
    const result = await blocked.advisor.chat({ message: 'เพิ่มลงตาราง วันจันทร์ 10:00-12:00', context });
    assert.deepEqual(result.actions, []);
    assert.deepEqual(blocked.calls.messages, []);
    const conflict = await blocked.advisor.chat({
        message: 'เพิ่มลงตาราง', context, schedule: [{ day: 'จันทร์', start: '10:30', end: '11:00' }]
    });
    assert.deepEqual(conflict.actions, []);
    assert.deepEqual(blocked.calls.messages, []);
    const fitting = setup();
    const accepted = await fitting.advisor.chat({ message: 'เพิ่มลงตาราง วันจันทร์ 09:00-11:00', context });
    assert.equal(accepted.actions.length, 1);
});

test('enrollment re-reads Oracle and ignores proposed day/time/name', async () => {
    const { advisor, calls } = setup();
    const result = await advisor.validateCourses({ context, courses: [{ courseCode: 'TEST1001', section: 'A', classId: 'fixture-class-1', start: '01:00', courseName: 'fake' }] });
    assert.equal(calls.read.length, 1);
    assert.equal(calls.messages.length, 0);
    assert.equal(result.courses[0].meetings[0].start, '09:15');
    assert.equal(result.courses[0].courseName, offering.courseName);
});

test('enrollment rejects wrong/missing section, class and duplicate course', async () => {
    const { advisor } = setup();
    for (const requested of [
        { courseCode: 'TEST1001' }, { courseCode: 'TEST1001', section: '1' },
        { courseCode: 'TEST1001', section: 'A', classId: 'different' },
        { courseCode: 'TEST1002', section: 'A' }
    ]) {
        await assert.rejects(advisor.validateCourses({ context, courses: [requested] }));
    }
    await assert.rejects(advisor.validateCourses({ context, courses: [
        { courseCode: 'TEST1001', section: 'A' }, { courseCode: 'TEST1001', section: 'A' }
    ] }), error => error.code === 'DUPLICATE_COURSE');
});

test('incomplete day/time/credits never becomes an enrollment action', async () => {
    for (const changed of [{ section: '' }, { credits: null }, { meetings: [] },
        { meetings: [{ day: '1', start: '09:00', end: '10:00' }] },
        { meetings: [{ day: 'จันทร์', start: '25:00', end: '26:00' }] }]) {
        const data = { ...copy(evidence), offerings: [{ ...copy(offering), ...changed }] };
        const { advisor } = setup({ evidence: data });
        await assert.rejects(advisor.validateCourses({ context, courses: [{ courseCode: 'TEST1001', section: 'A' }] }));
    }
    assert.equal(creditValue(null), null);
    assert.equal(dayName(1), null);
    assert.equal(timeMinutes('09:15'), 555);
    assert.equal(completeOffering(offering), true);
});

test('repository verifies metadata, binds all filters and keeps every meeting', async () => {
    const database = mockDatabase();
    const result = await createAcademicRepository(database).read(context);
    assert.equal(result.offerings[0].meetings.length, 2);
    assert.equal(result.offerings[0].meetings[0].day, 'จันทร์');
    assert.equal(result.offerings[0].meetings[0].start, '09:15');
    assert.equal(result.plan[0].credits, 2.5);
    assert.equal(result.offerings[0].actionable, true);
    const program = database.calls.find(call => call.sql.includes('"EXP_PROGRAM" p'));
    assert.deepEqual(program.binds, { faculty: context.faculty, major: context.major, curriculumYear: context.curriculumYear });
    assert.match(program.sql, /REGEXP_REPLACE\(:major, '\[\[:space:\]\]\+', ' '\)/);
    assert.match(program.sql, /REGEXP_REPLACE\(p\.PROGRAMNAME, '-\[\[:space:\]\]\*\[0-9\]\{4\}/);
    assert.doesNotMatch(program.sql, /LIKE|PROGRAMYEAR DESC/);
    const offeringQuery = database.calls.find(call => call.sql.includes('cl.ACADYEAR = :academicYear'));
    assert.equal(offeringQuery.binds.academicYear, context.academicYear);
    assert.equal(offeringQuery.binds.yearLevel, context.yearLevel);
    assert.match(offeringQuery.sql, /cl\.ACADYEAR = :academicYear AND cl\.SEMESTER = :semester/);
    assert.match(offeringQuery.sql, /sp\.STUDENTYEAR = :yearLevel/);
    assert.doesNotMatch(offeringQuery.sql, /NVL|ROW_NUMBER|\* 5/);
    assert.equal(database.closed(), 1);
});

test('unverified schema prevents academic queries and releases connection', async () => {
    for (const option of [{ missingColumn: 'PROGRAMYEAR' }, { noKeys: true }]) {
        const database = mockDatabase(option);
        await assert.rejects(createAcademicRepository(database).read(context), error => error.code === 'SCHEMA_UNVERIFIED');
        assert.ok(database.calls.every(call => /FROM ALL_/.test(call.sql)));
        assert.equal(database.closed(), 1);
    }
});

test('schema errors identify missing columns separately from undeclared foreign keys', async () => {
    const missingColumn = mockDatabase({ missingColumn: 'PROGRAMYEAR' });
    await assert.rejects(createAcademicRepository(missingColumn).read(context), error =>
        error.code === 'SCHEMA_UNVERIFIED' && error.message.includes('EXP_PROGRAM.PROGRAMYEAR')
        && error.message.includes('current schema'));
    const missingKeys = mockDatabase({ noKeys: true });
    await assert.rejects(createAcademicRepository(missingKeys).read(context), error =>
        error.code === 'SCHEMA_UNVERIFIED' && error.message.includes('foreign key')
        && error.message.includes('EXP_STUDYPLAN.PROGRAMID')
        && error.message.includes('export'));
});

test('AVSREG verifies the reviewed numeric relationships without declared foreign keys', async () => {
    const database = mockDatabase({ exportSchema: true });
    const repository = createAcademicRepository(database);
    const result = await repository.read(context);
    assert.equal(result.offerings[0].actionable, true);
    assert.equal(result.offerings[0].meetings[0].day, 'จันทร์');
    assert.equal(result.offerings[0].meetings[0].start, '09:15');
    const check = database.calls.find(call => call.sql.includes('AS RELATION_ID'));
    assert.equal([...check.sql.matchAll(/AS RELATION_ID/g)].length, 8);
    assert.match(check.sql, /HAVING COUNT\(\*\) > 1/);
    assert.match(check.sql, /NOT EXISTS/);
    assert.match(database.calls.at(-1).sql, /"AVSREG"\."EXP_SYSTIMESLOT"/);
    assert.equal(database.closed(), 1);
    assert.ok(database.calls.every(call => /^\s*SELECT/.test(call.sql)));
});

test('AVSREG rejects incompatible key types and failed required integrity checks', async () => {
    for (const option of [{ badKeyType: 'EXP_STUDYPLAN.COURSEID' }, { failedExportRelations: [2] }]) {
        const database = mockDatabase({ exportSchema: true, ...option });
        await assert.rejects(createAcademicRepository(database).read(context), { code: 'SCHEMA_UNVERIFIED' });
        assert.ok(!database.calls.some(call => call.sql.includes('SELECT p.PROGRAMID')));
        assert.equal(database.closed(), 1);
    }
});

test('AVSREG keeps offering lookup available when the weekday dictionary fails verification', async () => {
    const database = mockDatabase({ exportSchema: true, failedExportRelations: [7] });
    const result = await createAcademicRepository(database).read(context);
    assert.equal(result.offerings[0].section, 'A');
    assert.equal(result.offerings[0].meetings[0].day, null);
    assert.equal(result.offerings[0].actionable, false);
    assert.match(result.warnings.join(' '), /รหัสวัน/);
});

test('partial and all-unresolved study plans remain distinct from an empty plan', async () => {
    const missing = { COURSECODE: null, COURSENAME: null, COURSEUNIT: null, UNRESOLVED_PLAN_ROWS: 2 };
    const known = { COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: 3, UNRESOLVED_PLAN_ROWS: 2 };
    for (const [planRows, outcome] of [
        [[known, missing], 'plan_partial'], [[missing], 'plan_incomplete'], [[], 'plan_not_found']
    ]) {
        const database = mockDatabase({ exportSchema: true, planRows });
        const advisor = createAIAdvisor({ repository: createAcademicRepository(database),
            complete: async () => assert.fail('Oracle plan facts must not depend on Groq') });
        const result = await advisor.chat({ context, message: 'ปี 3 เทอม 2 ต้องเรียนอะไรบ้าง' });
        assert.equal(result.outcome, outcome);
        if (outcome !== 'plan_not_found') assert.match(result.reply, /2 รายการ/);
        if (outcome === 'plan_partial') assert.match(result.reply, /TEST1001/);
        else assert.doesNotMatch(result.reply, /TEST1001/);
        assert.deepEqual(result.actions, []);
        const check = database.calls.find(call => call.sql.includes('AS RELATION_ID'));
        assert.doesNotMatch(check.sql, /EXP_CLASS/);
        const plan = database.calls.at(-1);
        assert.match(plan.sql, /LEFT JOIN "AVSREG"\."EXP_COURSE"/);
        assert.match(plan.sql, /OVER \(\) AS UNRESOLVED_PLAN_ROWS/);
        assert.deepEqual(plan.binds, { programId: 'fixture-program', yearLevel: 3, semester: 2 });
    }
});

test('missing lookup metadata produces incomplete facts without guessed days or times', async () => {
    const database = mockDatabase({ noDayKey: true, noTimeKeys: true, offeringRows: [
        { COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: 3, CLASSID: 'fixture-class-1', SECTION: null, WEEKDAY: 1, START_TIME: null, END_TIME: null }
    ] });
    const result = await createAcademicRepository(database).read(context);
    assert.equal(result.offerings[0].section, '');
    assert.equal(result.offerings[0].meetings[0].day, null);
    assert.equal(result.offerings[0].meetings[0].start, null);
    assert.equal(result.offerings[0].actionable, false);
    assert.equal(result.warnings.length, 2);
});

test('repository closes connections on failed plan queries and distinguishes empty plans', async () => {
    const failed = mockDatabase({ failQuery: 'SELECT DISTINCT c.COURSECODE' });
    await assert.rejects(createAcademicRepository(failed).read(context));
    assert.equal(failed.closed(), 1);
    const empty = mockDatabase({ planRows: [], offeringRows: [] });
    const result = await createAcademicRepository(empty).read(context);
    assert.deepEqual(result.plan, []);
    assert.deepEqual(result.offerings, []);
});

test('catalog variants and oversized retrievals are rejected explicitly', async () => {
    const row = { COURSECODE: 'TEST1001', COURSENAME: 'version one', COURSEUNIT: 3 };
    const duplicate = mockDatabase({ planRows: [row, { ...row, COURSENAME: 'version two' }] });
    await assert.rejects(createAcademicRepository(duplicate).read(context), error => error.code === 'DATA_AMBIGUOUS');
    const oversized = mockDatabase({ planRows: Array.from({ length: 201 }, () => row) });
    await assert.rejects(createAcademicRepository(oversized).read(context), error => error.code === 'RESULT_LIMIT');
});

test('signed-in profile answers a year/term plan request naturally and keeps scope on follow-up', async () => {
    const { advisor, calls } = setup();
    const identity = { status: 'verified', profile: {
        firstName: 'ทดสอบ', lastName: '', faculty: context.faculty, major: context.major,
        freeTime: '', learningStyle: '', yearLevel: 3, curriculumYear: null
    } };
    for (const message of ['สวัสดีครับ ช่วยแนะนำวิชาสาขาของปี1เทอม2 ให้หน่อยครับ', 'ช่วยแนะนำวิชาสาขาของปี1 เทอม2 ให้ผมหน่อยครับ']) {
        const first = await advisor.chat({ message, context: {} }, identity);
        assert.equal(first.outcome, 'grounded', message);
        assert.equal(first.context.major, context.major);
        assert.equal(first.context.yearLevel, 1);
        assert.equal(first.context.semester, 2);
        assert.match(first.reply, /^ได้เลยครับ จากแผนการเรียนหลักสูตร สาขาทดสอบ \(ปีหลักสูตร 2565\) ชั้นปีที่ 1 ภาคเรียนที่ 2 มีรายวิชาดังนี้ครับ/);
        assert.doesNotMatch(first.reply, /กรุณาระบุ|ขอทราบ|สาขาทดสอบ-2565/);
        assert.match(first.reply, /รายการนี้เป็นแผนตามหลักสูตร ยังไม่ใช่รายวิชาที่เปิดสอนจริง/);

        const history = [{ role: 'user', content: message }, { role: 'assistant', content: first.reply }];
        const next = await advisor.chat({ message: 'แล้วเทอม 3 ล่ะครับ', context: first.conversationContext, history }, identity);
        assert.equal(next.outcome, 'grounded');
        assert.equal(next.context.major, context.major);
        assert.equal(next.context.yearLevel, 1);
        assert.equal(next.context.semester, 3);
        assert.doesNotMatch(next.reply, /กรุณาระบุ|ขอทราบ/);
    }
    assert.equal(calls.messages.length, 0);
});

test('plan reply shows a credit total only when every listed credit is verified', async () => {
    const plan = [{ courseCode: 'TEST1001', courseName: 'ก', credits: 3 }, { courseCode: 'TEST1002', courseName: 'ข', credits: 1 }];
    const known = setup({ evidence: { ...evidence, plan } });
    const result = await known.advisor.chat({ message: 'แนะนำวิชา ปี 3 เทอม 2', context });
    assert.match(result.reply, /รวม 4 หน่วยกิต/);
    const unknown = setup({ evidence: { ...evidence, plan: [plan[0], { ...plan[1], credits: null }] } });
    const partial = await unknown.advisor.chat({ message: 'แนะนำวิชา ปี 3 เทอม 2', context });
    assert.doesNotMatch(partial.reply, /รวม \d+ หน่วยกิต/);
});

test('academic year accepts "ปีการศึกษาที่" and the missing-year prompt shows the format', async () => {
    assert.equal(contextFromRequest({ context }, 'ปีการศึกษาที่ 2569 เทอม 2').academicYear, 2569);
    const { advisor } = setup();
    const result = await advisor.chat({ message: 'แล้ววิชาไหนเปิดสอนบ้าง', context: { ...context, academicYear: null } });
    assert.equal(result.outcome, 'context_required');
    assert.match(result.reply, /ปีการศึกษา 25xx/);
});

const historicalRow = (overrides = {}) => ({ COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: '2.5',
    CLASSID: 'old-1', SECTION: '3', SOURCE_YEAR: 2568, SOURCE_SEMESTER: 2, WEEKDAY: '10', START_TIME: '13:00', END_TIME: '15:55', ...overrides });

test('an unpublished term uses real sections of the same course and semester from the nearest earlier year', async () => {
    const database = mockDatabase({ termPublished: false, historicalRows: [historicalRow()],
        planRows: [{ COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: '2.5' }, { COURSECODE: 'TEST1002', COURSENAME: 'ข', COURSEUNIT: '3' }],
        alternativeRows: [{ COURSECODE: 'TEST1002', LATEST_TERM: 25683 }] });
    const result = await createAcademicRepository(database).read(context, { includeOfferings: true });
    assert.deepEqual(JSON.parse(JSON.stringify(result.term)), { academicYear: 2569, semester: 2, published: false,
        mode: 'simulate', sourceAcademicYear: null, sourceSemester: null });
    assert.equal(result.offerings.length, 1);
    assert.deepEqual([result.offerings[0].academicYear, result.offerings[0].semester], [2569, 2]);
    assert.deepEqual([result.offerings[0].reference, result.offerings[0].sourceAcademicYear, result.offerings[0].sourceSemester], [true, 2568, 2]);
    assert.equal(result.offerings[0].actionable, true);
    assert.deepEqual(result.courseStatus, { TEST1001: 'reference', TEST1002: 'unpublished' });
    // TEST1002 only has times in 2568/3: offered as a choice, never used automatically.
    assert.deepEqual(result.alternativeTerms, { TEST1002: { academicYear: 2568, semester: 3 } });
    const historical = database.calls.find(call => call.sql.includes('/* historical */'));
    assert.deepEqual([historical.binds.sourceSemester, historical.binds.beforeYear], [2, 2569]);
    assert.match(historical.sql, /h\.COURSEID = cl\.COURSEID AND h\.SEMESTER = :sourceSemester AND h\.ACADYEAR < :beforeYear/);
    assert.match(result.sources.at(-1).label, /เวลาอ้างอิงจาก 2568\/2/);
});

test('without historical sections nothing is invented and actual-only mode skips history', async () => {
    const database = mockDatabase({ termPublished: false });
    const result = await createAcademicRepository(database).read(context, { includeOfferings: true });
    assert.deepEqual(result.offerings, []);
    assert.deepEqual(result.courseStatus, { TEST1001: 'unpublished' });
    const actualOnly = mockDatabase({ historicalRows: [historicalRow()], offeringRows: [] });
    const strict = await createAcademicRepository(actualOnly).read(context, { includeOfferings: true, source: { mode: 'actual' } });
    assert.deepEqual(strict.offerings, []);
    assert.deepEqual(strict.courseStatus, { TEST1001: 'not_offered' });
    assert.ok(!actualOnly.calls.some(call => call.sql.includes('/* historical */')));
});

test('actual sections win; history only fills courses without verified times; explicit source term is bound', async () => {
    const database = mockDatabase({ historicalRows: [historicalRow(), historicalRow({ COURSECODE: 'TEST1002', COURSENAME: 'ข', COURSEUNIT: '3', CLASSID: 'old-2', SOURCE_SEMESTER: 3 })],
        planRows: [{ COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: '2.5' }, { COURSECODE: 'TEST1002', COURSENAME: 'ข', COURSEUNIT: '3' }] });
    const result = await createAcademicRepository(database).read(context, { includeOfferings: true,
        source: { mode: 'simulate', sourceAcademicYear: 2568, sourceSemester: 3 } });
    assert.deepEqual(result.offerings.map(group => [group.courseCode, group.classId, Boolean(group.reference)]),
        [['TEST1001', 'fixture-class-1', false], ['TEST1002', 'old-2', true]]);
    assert.deepEqual(result.courseStatus, { TEST1001: 'offered', TEST1002: 'reference' });
    const historical = database.calls.find(call => call.sql.includes('/* historical */'));
    assert.deepEqual(historical.binds, { sourceYear: 2568, sourceSemester: 3, level0: 1, programId: 'fixture-program', yearLevel: 3, planSemester: 2 });
});

test('a published term separates offered, incomplete and not offered courses', async () => {
    const database = mockDatabase({ planRows: [
        { COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: '2.5' },
        { COURSECODE: 'TEST1002', COURSENAME: 'ข', COURSEUNIT: '3' },
        { COURSECODE: 'TEST1003', COURSENAME: 'ค', COURSEUNIT: '3' }],
    offeringRows: [
        { COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: '2.5', CLASSID: 'c1', SECTION: '1', WEEKDAY: '10', START_TIME: '09:00', END_TIME: '10:00' },
        { COURSECODE: 'TEST1003', COURSENAME: 'ค', COURSEUNIT: '3', CLASSID: 'c3', SECTION: '1', WEEKDAY: null, START_TIME: null, END_TIME: null }] });
    const result = await createAcademicRepository(database).read(context, { includeOfferings: true });
    assert.equal(result.term.published, true);
    assert.deepEqual(result.courseStatus, { TEST1001: 'offered', TEST1002: 'not_offered', TEST1003: 'incomplete' });
});

test('offered terms come from EXP_CLASS and exclude semester 0', async () => {
    const database = mockDatabase();
    const terms = await createAcademicRepository(database).readTerms();
    assert.deepEqual(terms, [{ academicYear: 2568, semester: 3, classes: 10 }, { academicYear: 2569, semester: 1, classes: 12 }]);
    assert.match(database.calls.at(-1).sql, /SEMESTER BETWEEN 1 AND 3/);
    assert.equal(database.closed(), 1);
});

test('advisor reply warns that offerings are a reference schedule and explains missing courses', async () => {
    const { advisor } = setup({ evidence: { ...evidence,
        offerings: [{ ...offering, reference: true, sourceAcademicYear: 2568, sourceSemester: 2 }],
        term: { academicYear: 2569, semester: 2, published: false, mode: 'simulate' },
        courseStatus: { TEST1001: 'reference', TEST1002: 'unpublished' },
        alternativeTerms: { TEST1002: { academicYear: 2568, semester: 3 } } } });
    const result = await advisor.chat({ message: 'ปี 3 เทอม 2 มีกลุ่มเรียนอะไรเปิดบ้าง', context });
    assert.equal(result.outcome, 'grounded');
    assert.match(result.reply, /ปีการศึกษา 2569 ภาคเรียน 2 ยังไม่มีตารางสอนจริงใน Oracle/);
    assert.match(result.reply, /ยังไม่ยืนยันการเปิดสอนปี 2569/);
    assert.match(result.reply, /TEST1001 .*กลุ่ม A .*เวลาอ้างอิงจากปี 2568 เทอม 2 \(จำลอง\)/);
    assert.match(result.reply, /TEST1002 — ไม่มีข้อมูลเวลาเรียนที่ตรวจสอบได้ มีเวลาเรียนล่าสุดที่ตรวจสอบได้ในปี 2568 เทอม 3 หากต้องการใช้ ให้เลือกเป็นแหล่งเวลาเอง/);
});

// ---- Natural advisor V5 acceptance ----
function profileSetup(options = {}) {
    const result = setup(options);
    const identity = { status: 'verified', profile: { firstName: 'ทดสอบ', lastName: '', faculty: context.faculty, major: context.major,
        freeTime: '', learningStyle: '', yearLevel: 3, curriculumYear: null } };
    return { ...result, identity };
}

test('V5: plan question uses the profile, follow-up keeps it, and the advisor never asks for the major', async () => {
    const { advisor, identity, calls } = profileSetup();
    const first = await advisor.chat({ message: 'ช่วยแนะนำวิชาปี 1 เทอม 3 หน่อยครับ', context: {} }, identity);
    assert.deepEqual([first.outcome, first.context.major, first.context.yearLevel, first.context.semester], ['grounded', context.major, 1, 3]);
    const history = [{ role: 'user', content: 'ช่วยแนะนำวิชาปี 1 เทอม 3 หน่อยครับ' }, { role: 'assistant', content: first.reply }];
    const next = await advisor.chat({ message: 'แล้วเทอม 2 ล่ะ', context: first.conversationContext, history }, identity);
    assert.deepEqual([next.context.major, next.context.yearLevel, next.context.semester], [context.major, 1, 2]);
    assert.doesNotMatch(first.reply + next.reply, /ขอทราบ|กรุณาระบุ/);
    assert.equal(calls.read.length, 2);
});

test('V5: elective questions read the curriculum structure instead of asking for a course code', async () => {
    const { identity } = profileSetup();
    let asked;
    const structured = createAIAdvisor({
        repository: { async readStructure(input) { asked = input; return { status: 'found',
            program: { name: 'สาขาทดสอบ - 2565', curriculumYear: 2565 }, sources: [{ id: 'oracle-structure', label: 'structure' }],
            conditions: [
                { id: '2.', description: 'หมวดวิชาเฉพาะ', credits: 113, type: 'H', courseCount: 0 },
                { id: '2.2', description: 'วิชาเลือก', credits: 64, type: 'C', courseCount: 0 },
                { id: '2.2.01', description: 'TST01 0500 ชุดวิชาทดสอบหนึ่ง', credits: 8, type: 'Y', courseCount: 2 },
                { id: '2.2.02', description: 'TST01 0600 ชุดวิชาทดสอบสอง', credits: 8, type: 'Y', courseCount: 2 }] }; } },
        complete: async () => { throw new Error('model must not be called'); }
    });
    for (const message of ['แล้วมีวิชาเลือกอะไรน่าสนใจอีกบ้างครับ', 'ตั้งแต่ปี 1 เทอม 3 ขึ้นไปเขาให้เลือกชุดวิชาเองใช่ไหมครับ']) {
        const result = await structured.chat({ message, context: {} }, identity);
        assert.equal(result.outcome, 'grounded', message);
        assert.equal(asked.major, context.major);
        assert.match(result.reply, /วิชาเลือก — 64 หน่วยกิต \(มี 2 ชุดวิชา ชุดละ 8 หน่วยกิต\)/);
        assert.match(result.reply, /• TST01 0500 ชุดวิชาทดสอบหนึ่ง — 8 หน่วยกิต/);
        assert.match(result.reply, /ไม่ได้ระบุว่าต้องเริ่มเลือกชุดวิชาตั้งแต่ชั้นปีหรือภาคเรียนใด/);
        assert.doesNotMatch(result.reply, /รหัสวิชาหรือชื่อวิชา/);
    }
});

test('V5: academic year 2569 never becomes the curriculum year; "ปี 2569 เทอม 1" is an academic year', async () => {
    const { advisor, identity, calls } = profileSetup();
    const result = await advisor.chat({ message: 'ปี 2569 เทอม 1 วิชาในแผนปี 1 เปิดกลุ่มไหนบ้าง', context: {} }, identity);
    assert.equal(calls.read[0].academicYear, 2569);
    assert.equal(calls.read[0].curriculumYear, null);
    assert.equal(calls.read[0].semester, 1);
    assert.equal(result.context.curriculumYear, 2565);
    const bare = await advisor.chat({ message: '2569', context: { ...context, academicYear: null },
        history: [{ role: 'user', content: 'ปี 3 เทอม 2 มีกลุ่มเรียนอะไรเปิดบ้าง' }, { role: 'assistant', content: 'ขอทราบปีการศึกษา เพิ่มเติมอีกนิดนะครับ' }] }, identity);
    assert.equal(bare.context.academicYear, 2569);
    assert.equal(bare.context.curriculumYear, 2565);
});

test('V5: scheduling without a year shows the plan with a button prompt; the planner year is used when present', async () => {
    const { advisor, identity, calls } = profileSetup();
    const plan = await advisor.chat({ message: 'ช่วยจัดตารางเรียนปีหนึ่งเทอม 3 ของผมหน่อยครับ', context: {} }, identity);
    assert.equal(plan.outcome, 'grounded');
    assert.match(plan.reply, /กดปุ่ม “จัดลงตาราง” ด้านล่างแล้วเลือกปีการศึกษา/);
    assert.equal(calls.read[0].academicYear, null);
    const planned = await advisor.chat({ message: 'ช่วยจัดตารางเรียนปี 1 เทอม 3 ให้หน่อย', context: {}, selectedAcademicYear: 2569 }, identity);
    assert.equal(planned.context.academicYear, 2569);
    assert.doesNotMatch(planned.reply, /ขอทราบ/);
});

test('V5: chat understands historical time requests, actual-only requests and days to avoid', async () => {
    const reads = [];
    const advisor = createAIAdvisor({
        repository: { async read(input, options) { reads.push({ input, options }); return structuredClone(evidence); } },
        complete: async () => JSON.stringify({ ...selection, classIds: [] })
    });
    const base = { message: '', context, schedule: [] };
    await advisor.chat({ ...base, message: 'ช่วยใช้เวลาเรียนปี 2568 เทอม 3 มาเป็นตัวอย่างจัดตารางหน่อยครับ' });
    assert.deepEqual(reads[0].options.source, { mode: 'simulate', sourceAcademicYear: 2568, sourceSemester: 3 });
    assert.equal(reads[0].input.semester, context.semester);
    await advisor.chat({ ...base, message: 'จัดตารางโดยใช้ข้อมูลจริงเท่านั้น' });
    assert.equal(reads[1].options.source.mode, 'actual');
    const avoid = await advisor.chat({ ...base, message: 'อยากได้ตารางที่ไม่มีเรียนวันศุกร์ ช่วยเพิ่มวิชาลงตาราง' });
    assert.deepEqual(avoid.scheduleOptions, { excludeDays: ['ศุกร์'] });
    await assert.rejects(advisor.chat({ ...base, message: 'แผนเรียน', source: { mode: 'invent' } }), { code: 'INVALID_SOURCE' });
});

test('V5: short replies continue the last offer and faculty+major typed together match the profile', async () => {
    const { advisor, identity, calls } = profileSetup();
    const offer = 'รายการนี้เป็นแผนตามหลักสูตร ยังไม่ใช่รายวิชาที่เปิดสอนจริง หากต้องการ ผมช่วยตรวจกลุ่มเรียนที่เปิดสอนหรือช่วยจัดตารางเรียนให้ได้ครับ';
    const history = [{ role: 'user', content: 'แนะนำวิชาปี 1 เทอม 3' }, { role: 'assistant', content: offer }];
    const yes = await advisor.chat({ message: 'ครับ', context: { ...context, yearLevel: 1, semester: 3, academicYear: null }, history, selectedAcademicYear: 2569 }, identity);
    assert.equal(yes.outcome, 'grounded');
    assert.match(yes.reply, /ข้อมูลเปิดสอน ปีการศึกษา 2569 ภาคเรียน 3/);
    const no = await advisor.chat({ message: 'ไม่เอาครับ', context, history }, identity);
    assert.equal(no.outcome, 'conversation');
    // Same shape as the real screenshot: faculty and program typed together without a "สาขา" label.
    const major = 'วิทยาการทดสอบบัณฑิต (เทคโนโลยีจำลอง)';
    const own = { ...identity, profile: { ...identity.profile, major } };
    const typed = await advisor.chat({ message: `${context.faculty} ${major} ปี 1 เทอม 3 ต้องเรียนอะไรบ้าง`, context: {} }, own);
    assert.equal(typed.context.major, major);
    assert.equal(calls.read.at(-1).faculty, context.faculty);
    assert.equal(calls.read.at(-1).yearLevel, 1);
});

// ---- Oracle verification follow-up (2026-11-21) ----
test('every class query is limited to the configured EXP_LEVELID (undergraduate by default)', async () => {
    const database = mockDatabase({ termPublished: false, historicalRows: [historicalRow()] });
    await createAcademicRepository(database).read(context, { includeOfferings: true });
    const classQueries = database.calls.filter(call => /EXP_CLASS"? (?:cl|h)\b|AS TERM_CLASSES|AS LATEST_TERM/.test(call.sql));
    // term check + historical lookup (outer cl and inner h are in the same statement)
    assert.ok(classQueries.length >= 2);
    assert.match(database.calls.find(call => call.sql.includes('/* historical */')).sql, /h\.LEVELID IN \(:level0\)[\s\S]*cl\.LEVELID IN \(:level0\)/);
    for (const call of classQueries) {
        assert.match(call.sql, /LEVELID IN \(:level0\)/);
        assert.equal(call.binds.level0, 1);
    }
    await createAcademicRepository(database).readTerms();
    assert.match(database.calls.at(-1).sql, /SEMESTER BETWEEN 1 AND 3 AND LEVELID IN \(:level0\)/);
    const multi = mockDatabase();
    await createAcademicRepository(multi, { levelIds: [1, 4] }).read(context, { includeOfferings: true });
    const actual = multi.calls.find(call => call.sql.includes('cl.ACADYEAR = :academicYear'));
    assert.match(actual.sql, /cl\.LEVELID IN \(:level0, :level1\)/);
    assert.deepEqual([actual.binds.level0, actual.binds.level1], [1, 4]);
});

test('class level config rejects anything but EXP_LEVELID integers', () => {
    const { parseLevelIds } = require('../src/config/academic');
    assert.deepEqual(parseLevelIds(undefined), [1]);
    assert.deepEqual(parseLevelIds('1, 4,4'), [1, 4]);
    assert.throws(() => parseLevelIds('1;DROP'), /CLASS_LEVEL_IDS/);
    assert.throws(() => parseLevelIds(''), /CLASS_LEVEL_IDS/);
});

test('a meeting ends at the start of the slot after TIMESLOTTO (registrar: 08:00–12:00, not 11:55)', async () => {
    const database = mockDatabase();
    await createAcademicRepository(database).read(context, { includeOfferings: true });
    const actual = database.calls.find(call => call.sql.includes('cl.ACADYEAR = :academicYear'));
    assert.match(actual.sql, /ts_to\.TIMESLOT = ct\.TIMESLOTTO \+ 1/);
    assert.match(actual.sql, /ts_from\.TIMESLOT = ct\.TIMESLOTFROM\n/);
});

// ---- GE / free elective recommendations from the term catalog ----
function catalogAdvisor(published = false, historicalOnly = false, sourceSemester = 2) {
    const group = (code, section, day, extra = {}) => ({ courseCode: code, courseName: code, credits: 2, classId: `${code}-${section}`,
        section, academicYear: 2569, semester: 2, meetings: [{ day, start: '13:00', end: '15:00' }], actionable: true, ...extra });
    const course = (code, category, sections) => ({ courseCode: code, courseName: `วิชา ${code}`, credits: 2, category, sections,
        status: sections.length ? 'offered' : 'unpublished' });
    const catalog = { status: 'found', program: { name: 'สาขาทดสอบ - 2565', curriculumYear: 2565 },
        term: { academicYear: 2569, semester: 2, published }, sources: [{ id: 'oracle-offerings', label: 'catalog' }],
        courses: [
            course('GEN1002', 'genEd', [group('GEN1002', '3', 'พฤหัสบดี', { reference: true, sourceAcademicYear: 2568, sourceSemester })]),
            course('GEN1001', 'genEd', [group('GEN1001', '1', 'พฤหัสบดี'), group('GEN1001', '2', 'จันทร์')]),
            course('GEN1003', 'genEd', [group('GEN1003', '1', 'จันทร์')]),
            course('GEN1004', 'genEd', []),
            course('GEN1005', 'genEd', [group('GEN1005', '1', 'พฤหัสบดี', { actionable: false, meetings: [{ day: null, start: null, end: null }] })]),
            course('FREE101', 'free', [group('FREE101', '1', 'พุธ')]),
            course('FREE102', 'free', [group('FREE102', '1', 'ศุกร์')]),
            course('FREE103', 'free', [group('FREE103', '1', 'จันทร์')]),
            course('MAJ1001', 'major', [group('MAJ1001', '1', 'พฤหัสบดี')])] };
    if (historicalOnly) catalog.courses = catalog.courses.filter(item => item.sections.some(section => section.reference));
    const reads = [];
    const advisor = createAIAdvisor({
        repository: { async readTermCatalog(input, source) { reads.push({ input, source }); return structuredClone(catalog); } },
        complete: async () => { throw new Error('model must not be called'); }
    });
    const identity = { status: 'verified', profile: { firstName: 'ทดสอบ', faculty: context.faculty, major: context.major,
        yearLevel: 3, curriculumYear: null, freeTime: '', learningStyle: '' } };
    return { advisor, reads, identity };
}

test('V7 recognizes spoken category answers and only displays a different source term when explicitly chosen', async () => {
    const { advisor, identity } = catalogAdvisor(false, true, 3);
    const body = { message: 'มีวิชาอื่นอีกไหม เทอม 2', selectedAcademicYear: 2569, presentation: 'conversation' };
    const clarify = await advisor.chat(body, identity, {});
    assert.equal(clarify.conversationState.pendingClarification.field, 'courseCategory');
    for (const alias of ['GE', 'G E', 'วิชา GE', 'วิชาศึกษาทั่วไป', 'วิชาเจอี', 'ข้อแรกครับ']) {
        const result = await advisor.chat({ message: alias }, identity, clarify.conversationState);
        assert.equal(result.conversationState.courseCategory, 'genEd', alias);
        assert.equal(result.conversationState.pendingClarification, null);
        assert.equal(result.outcome, 'no_more_courses');
        assert.equal(result.academicDetails, undefined);
    }
    const accepted = await advisor.chat({ message: 'วิชาเจอี', source: { mode: 'simulate', sourceAcademicYear: 2568, sourceSemester: 3 } },
        identity, clarify.conversationState);
    assert.equal(accepted.academicDetails.cards[0].groups[0].sourceSemester, 3);
    assert.match(accepted.reply, /ใช้จำลองตาราง/);
    const nextTerm = await advisor.chat({ message: 'แล้วเทอมหน้าล่ะ' }, identity, accepted.conversationState);
    assert.equal(nextTerm.context.semester, 3);
    const free = await advisor.chat({ message: 'free elective' }, identity, clarify.conversationState);
    assert.equal(free.conversationState.courseCategory, 'free');
    const changedTopic = await advisor.chat({ message: 'ผมชื่ออะไร' }, identity, clarify.conversationState);
    assert.equal(changedTopic.outcome, 'personal_profile');
    assert.equal(changedTopic.conversationState.pendingClarification, null);
});

test('V6 presents actual GE sections before using historical options and labels the original term', async () => {
    const body = { message: 'ช่วยแนะนำวิชาศึกษาทั่วไปเทอม 2 วันพฤหัส', selectedAcademicYear: 2569, presentation: 'conversation' };
    const actual = catalogAdvisor(true);
    const current = await actual.advisor.chat(body, actual.identity);
    assert.deepEqual(current.academicDetails.cards.map(card => card.code), ['GEN1001']);
    assert.doesNotMatch(current.reply, /เวลาอ้างอิง|EXP_|\[oracle-offerings\]/);
    const historical = catalogAdvisor(false, true);
    const reference = await historical.advisor.chat(body, historical.identity);
    assert.match(reference.reply, /ใช้จำลองตาราง/);
    assert.deepEqual(reference.academicDetails.cards[0].groups[0], { section: '3', reference: true, sourceAcademicYear: 2568,
        sourceSemester: 2, meetings: [{ day: 'พฤหัสบดี', start: '13:00', end: '15:00' }] });
    assert.deepEqual(reference.actions, []);
});

test('GE on Thursday lists only general-education courses with a verified Thursday section, real ones first', async () => {
    const { advisor, reads, identity } = catalogAdvisor();
    const result = await advisor.chat({ message: 'เทอมนี้ผมอยากลงวิชา GE ในวันพฤหัส', context: {}, selectedAcademicYear: 2569, selectedSemester: 2 }, identity);
    assert.equal(result.outcome, 'grounded');
    assert.deepEqual([reads[0].input.academicYear, reads[0].input.semester, reads[0].input.major], [2569, 2, context.major]);
    assert.match(result.reply, /วิชาศึกษาทั่วไป \(GE\) ของหลักสูตร สาขาทดสอบ ที่มีกลุ่มเรียนวันพฤหัสบดี ในปีการศึกษา 2569 ภาคเรียนที่ 2/);
    assert.match(result.reply, /ยังไม่มีตารางสอนจริงใน Oracle/);
    assert.ok(result.reply.indexOf('GEN1001') < result.reply.indexOf('GEN1002'));
    assert.match(result.reply, /กลุ่ม 1 — พฤหัสบดี 13:00–15:00\n/);
    assert.match(result.reply, /กลุ่ม 3 — พฤหัสบดี 13:00–15:00 \(เวลาอ้างอิงปี 2568 เทอม 2\)/);
    assert.doesNotMatch(result.reply, /GEN1003|GEN1004|GEN1005|FREE10|MAJ1001|กลุ่ม 2 — จันทร์/);
});

test('free electives on several days, follow-up keeps the category, and no match explains other days', async () => {
    const { advisor, identity } = catalogAdvisor(true);
    const message = 'เทอม 2 ผมอยากลงวิชาเสรีวันพุธ พฤหัส ศุกร์';
    const free = await advisor.chat({ message, context: {}, selectedAcademicYear: 2569 }, identity);
    assert.match(free.reply, /วิชาเลือกเสรีของหลักสูตร สาขาทดสอบ ที่มีกลุ่มเรียนวันพุธ พฤหัสบดี ศุกร์/);
    assert.match(free.reply, /FREE101[\s\S]*FREE102/);
    assert.doesNotMatch(free.reply, /FREE103|GEN100|ยังไม่มีตารางสอนจริง/);
    const history = [{ role: 'user', content: message }, { role: 'assistant', content: free.reply }];
    const saturday = await advisor.chat({ message: 'แล้ววันเสาร์ล่ะ', context: free.conversationContext, history, selectedAcademicYear: 2569 }, identity);
    assert.match(saturday.reply, /ไม่พบวิชาเลือกเสรีที่มีกลุ่มเรียนพร้อมเวลาที่ตรวจสอบได้ในวันเสาร์ .*แต่มี 3 วิชาที่เรียนวันอื่น/);
});

test('category questions ask only for a missing academic year; credit questions stay on the curriculum structure', async () => {
    const { advisor, identity, reads } = catalogAdvisor();
    const ask = await advisor.chat({ message: 'ช่วยแนะนำวิชา ge ที่เปิดในเทอมที่ 2 ให้หน่อยครับ', context: {} }, identity);
    assert.equal(ask.outcome, 'context_required');
    assert.match(ask.reply, /ขอทราบปีการศึกษา/);
    assert.equal(reads.length, 0);
    const { routeMessage } = require('../src/services/advisorIntent');
    assert.equal(routeMessage('วิชาเลือกเสรีต้องเรียนกี่หน่วยกิต', []).intent, 'curriculum_structure');
    assert.equal(routeMessage('หมายถึงวิชาศึกษาทั่วไปที่ขึ้นต้นด้วย IST', []).category, 'genEd');
    assert.equal(routeMessage('เปลี่ยนหน้า page ใหม่', []).category, null);
});

// ---- 1. course description questions ----
test('"what is this course about" says Oracle has no description, never guesses, and adds placement and term status', async () => {
    let options;
    const advisor = createAIAdvisor({
        repository: { async readCourse(search, input, config) {
            options = { search, input, config };
            return { program: null, plan: [{ courseCode: 'IST201510', courseName: 'ชุมชนเสมือนจริง', courseNameEng: 'VIRTUAL COMMUNITY', credits: 2 }],
                offerings: [{ courseCode: 'IST201510', courseName: 'ชุมชนเสมือนจริง', credits: 2, classId: 'c1', section: '1', actionable: true,
                    reference: true, sourceAcademicYear: 2568, sourceSemester: 2, meetings: [{ day: 'พฤหัสบดี', start: '08:00', end: '10:00' }] }],
                term: { academicYear: 2569, semester: 2, published: false }, courseStatus: { IST201510: 'reference' },
                placement: { programFound: true, conditions: [{ id: '1.3', description: 'กลุ่มวิชาศึกษาทั่วไปแบบเลือก', heading: 'หมวดวิชาศึกษาทั่วไป' }] },
                sources: [{ id: 'oracle-catalog', label: 'catalog' }], warnings: [] };
        } },
        complete: async () => { throw new Error('model must not be called'); }
    });
    const identity = { status: 'verified', profile: { firstName: 'ท', faculty: context.faculty, major: context.major, yearLevel: 3 } };
    const result = await advisor.chat({ message: 'IST201510 เรียนเกี่ยวกับอะไรครับ', context: {}, selectedAcademicYear: 2569, selectedSemester: 2 }, identity);
    assert.deepEqual(options.search, { code: 'IST201510' });
    assert.deepEqual([options.config.includeOfferings, options.config.strictOfferings], [true, false]);
    assert.equal(options.input.major, context.major);
    assert.match(result.reply, /IST201510 ชุมชนเสมือนจริง \(VIRTUAL COMMUNITY\) — 2 หน่วยกิต/);
    assert.match(result.reply, /ยังไม่มีคำอธิบายรายวิชา .*ผมจะไม่เดาเนื้อหาจากชื่อวิชา/);
    assert.match(result.reply, /หมวดในหลักสูตรของคุณ: หมวดวิชาศึกษาทั่วไป › กลุ่มวิชาศึกษาทั่วไปแบบเลือก/);
    assert.match(result.reply, /ปีการศึกษา 2569 ภาคเรียนที่ 2: ยังไม่มีเวลาเรียนจริง มีเวลาอ้างอิง 1 กลุ่มจาก 2568\/2/);
    assert.match(result.reply, /กลุ่ม 1 — พฤหัสบดี 08:00–10:00 \(เวลาอ้างอิงปี 2568 เทอม 2\)/);
    assert.match(result.reply, /reg\.sut\.ac\.th/);
});

test('course lookup reads the English name and the placement in the student program (read-only, bound keys)', async () => {
    const database = mockDatabase({ catalogRows: [{ COURSEID: 'cid-1', COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSENAMEENG: 'MOCK COURSE', COURSEUNIT: '2' }],
        courseCategoryRows: [{ CONDITIONID: '1.3', DESCRIPTION: 'กลุ่มเลือก', HEADING_DESCRIPTION: 'หมวดวิชาศึกษาทั่วไป' }] });
    const result = await createAcademicRepository(database).readCourse({ code: 'TEST1001' }, { ...context }, { includeOfferings: false });
    assert.equal(result.plan[0].courseNameEng, 'MOCK COURSE');
    assert.deepEqual(JSON.parse(JSON.stringify(result.placement.conditions)), [{ id: '1.3', description: 'กลุ่มเลือก', heading: 'หมวดวิชาศึกษาทั่วไป' }]);
    const placementCall = database.calls.find(call => call.sql.includes('AS HEADING_DESCRIPTION'));
    assert.deepEqual(placementCall.binds, { programId: 'fixture-program', courseId: 'cid-1' });
    assert.match(placementCall.sql, /ps\.PROGRAMID = cip\.PROGRAMID AND ps\.CONDITIONID = cip\.CONDITIONID/);
    assert.ok(database.calls.every(call => /^\s*SELECT/.test(call.sql)));
    const anonymous = mockDatabase();
    await createAcademicRepository(anonymous).readCourse({ code: 'TEST1001' }, { ...context, faculty: '', major: '' }, {});
    assert.ok(!anonymous.calls.some(call => call.sql.includes('AS HEADING_DESCRIPTION')));
});

// ---- 2/3. category list wording, filters, ranking and paging ----
function bigCatalogAdvisor() {
    const meeting = (day, start, end) => ({ day, start, end });
    const group = (code, section, meetings, extra = {}) => ({ courseCode: code, courseName: code, credits: 3, classId: `${code}-${section}`,
        section, meetings, actionable: true, ...extra });
    const free = [];
    for (let index = 1; index <= 13; index++) {
        const code = `FREE${String(index).padStart(3, '0')}`;
        free.push({ courseCode: code, courseName: index === 7 ? 'การจัดการธุรกิจดิจิทัล' : `วิชาเสรี ${index}`, credits: index % 2 ? 3 : 2,
            category: 'free', status: 'offered',
            sections: index === 13 ? [group(code, '1', [meeting('พุธ', '09:00', '12:00')]), group(code, '2', [meeting('พุธ', '13:00', '16:00')]),
                group(code, '3', [meeting('พุธ', '13:00', '16:00')])]
                : [group(code, '1', [meeting('พุธ', index % 2 ? '13:00' : '09:00', index % 2 ? '16:00' : '12:00')])] });
    }
    const catalog = { status: 'found', program: { name: 'สาขาทดสอบ - 2565', curriculumYear: 2565 },
        term: { academicYear: 2569, semester: 1, published: true }, sources: [], courses: free };
    const advisor = createAIAdvisor({ repository: { readTermCatalog: async () => structuredClone(catalog) },
        complete: async () => { throw new Error('model must not be called'); } });
    const identity = { status: 'verified', profile: { firstName: 'ท', faculty: context.faculty, major: context.major, yearLevel: 3 } };
    const ask = (message, history = []) => advisor.chat({ message, context: {}, history, selectedAcademicYear: 2569, selectedSemester: 1 }, identity);
    return { ask };
}

test('category header has no stray space, ranks multi-section courses first and pages with "ขอดูเพิ่ม"', async () => {
    const { ask } = bigCatalogAdvisor();
    const first = await ask('ช่วยแนะนำวิชาเสรีที่เปิดเทอม 1 ให้หน่อยครับ');
    // FREE013 (3 credits, 3 sections) leads; FREE002 (2 credits) still ranks above any 1-credit course.
    assert.match(first.reply, /ที่มีกลุ่มเรียนในปีการศึกษา 2569 ภาคเรียนที่ 1 มีดังนี้ครับ/);
    assert.match(first.reply, /เรียงจาก: เปิดสอนจริงก่อน → กลุ่มที่เรียนเฉพาะวันที่ขอ → วิชา 2 หน่วยกิตขึ้นไป → วิชาที่เปิดหลายกลุ่ม/);
    assert.match(first.reply, /\[oracle-offerings\]\n• FREE013/);
    assert.match(first.reply, /แสดงวิชาที่ 1–10 จากทั้งหมด 13 วิชา พิมพ์ "ขอดูเพิ่ม" เพื่อดูวิชาถัดไป/);
    assert.match(first.reply, /กรองเพิ่มได้ เช่น "ช่วงบ่าย"/);
    const history = [{ role: 'user', content: 'ช่วยแนะนำวิชาเสรีที่เปิดเทอม 1 ให้หน่อยครับ' }, { role: 'assistant', content: first.reply }];
    const second = await ask('ขอดูเพิ่ม', history);
    assert.match(second.reply, /แสดงวิชาที่ 11–13 จากทั้งหมด 13 วิชา$/m);
    assert.doesNotMatch(second.reply, /FREE001 |กรองเพิ่มได้/);
    const third = await ask('ขอดูเพิ่ม', [...history, { role: 'user', content: 'ขอดูเพิ่ม' }, { role: 'assistant', content: second.reply }]);
    assert.match(third.reply, /แสดงครบทั้ง 13 วิชาแล้วครับ/);
});

test('time of day, credits and a name keyword narrow the list; an impossible filter is relaxed and explained', async () => {
    const { ask } = bigCatalogAdvisor();
    const afternoon = await ask('วิชาเสรีวันพุธ ช่วงบ่าย 3 หน่วยกิต');
    assert.match(afternoon.reply, /ที่มีกลุ่มเรียนวันพุธ ช่วงบ่าย ในปีการศึกษา 2569 ภาคเรียนที่ 1 \(3 หน่วยกิต\)/);
    assert.doesNotMatch(afternoon.reply, /09:00–12:00/);
    assert.doesNotMatch(afternoon.reply, /— 2 หน่วยกิต/);
    const keyword = await ask('วิชาเสรีเกี่ยวกับธุรกิจที่เปิดวันพุธ');
    assert.match(keyword.reply, /ชื่อวิชามีคำว่า "ธุรกิจ"/);
    assert.match(keyword.reply, /FREE007 การจัดการธุรกิจดิจิทัล/);
    assert.doesNotMatch(keyword.reply, /FREE001/);
    const evening = await ask('วิชาเสรีวันพุธช่วงเย็น');
    assert.match(evening.reply, /ไม่พบกลุ่มที่อยู่ในช่วงเย็น จึงแสดงช่วงเวลาอื่นแทน/);
    assert.match(evening.reply, /FREE013/);
    const history = [{ role: 'user', content: 'วิชาเสรีวันพุธ' }, { role: 'assistant', content: 'รายการ' }];
    const refined = await ask('ขอช่วงเช้า', history);
    assert.match(refined.reply, /วันพุธ ช่วงเช้า/);
    assert.doesNotMatch(refined.reply, /13:00–16:00/);
});
