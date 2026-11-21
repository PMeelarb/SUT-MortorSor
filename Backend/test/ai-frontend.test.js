const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { context, offering } = require('./fixtures/academic');

class Element {
    constructor() { this.style = {}; this.children = []; this.listeners = {}; this.value = ''; this.textContent = ''; }
    appendChild(child) { this.children.push(child); child.parent = this; }
    append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    set innerHTML(value) { throw new Error('Unexpected HTML rendering in AI Chat'); }
}

function browser() {
    const elements = new Map();
    for (const id of ['ai-msg-input', 'ai-chat-history', 'profile-faculty', 'profile-major', 'profile-year-level', 'semester-text']) elements.set(id, new Element());
    elements.get('profile-faculty').value = context.faculty;
    elements.get('profile-major').value = context.major;
    elements.get('profile-year-level').value = '1';
    elements.get('semester-text').textContent = 'เทอมที่ 2';
    const yearTab = new Element();
    yearTab.textContent = 'ปี 3';
    const alerts = [];
    const storage = new Map([['sut_student_id', 'fixture-student']]);
    let confirmCount = 0;
    let redraws = 0;
    const sandbox = {
        document: { getElementById: id => elements.get(id), querySelector: selector => selector === '.year-tab.active' ? yearTab : null, createElement: () => new Element(), addEventListener() {} },
        localStorage: { getItem: name => storage.get(name) ?? null },
        selectedCoursesData: [], selectedCourseIds: [], scheduleCache: {},
        currentYearLevel: 3, currentSemester: 2, selectedMajor: context.major,
        aiChatContext: { ...context },
        aiAcademicProfile: { faculty: context.faculty, major: context.major, yearLevel: 3 },
        normalizeCourseCodeKey: value => String(value ?? '').replace(/\s+/g, '').toUpperCase(),
        showAppNotice: text => alerts.push(text),
        confirmAppAction: async () => { confirmCount++; return true; },
        showSuccessModal() {},
        updateDatabaseTimetableAndCredits() { redraws++; },
        validateAICourses: async () => ({ status: 'success', context: { ...context }, courses: [structuredClone(offering)] })
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    for (const file of ['ai-chat.js', 'ai-schedule.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../../Frontend/js', file), 'utf8'), sandbox, { filename: file });
    }
    return { sandbox, elements, yearTab, alerts, storage, confirms: () => confirmCount, redraws: () => redraws };
}

test('the themed dialog keeps previews as text and waits for explicit confirmation or cancellation', async () => {
    const body = new Element();
    const active = { isConnected: true, focus() {} };
    const sandbox = { document: { body, activeElement: active, addEventListener() {}, createElement(tag) {
        const node = new Element();
        Object.assign(node, { tag, dataset: {}, setAttribute() {}, focus() {}, showModal() { this.open = true; },
            close(value) { this.returnValue = value; this.listeners.close(); } });
        return node;
    } } };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    runFile(sandbox, 'notifications.js');
    const answer = sandbox.confirmAppAction('วิชา <b>ตัวอย่าง</b>\n13:00–15:00');
    await Promise.resolve();
    const dialog = body.children[0];
    assert.equal(dialog.open, true);
    assert.equal(dialog.children[1].textContent, 'วิชา <b>ตัวอย่าง</b>\n13:00–15:00');
    dialog.children.at(-1).children[0].listeners.click();
    assert.equal(await answer, false);
    const confirmed = sandbox.confirmAppAction('ยืนยัน');
    await Promise.resolve();
    body.children[0].children.at(-1).children[1].listeners.click();
    assert.equal(await confirmed, true);
    assert.equal(body.children.length, 0);
});

test('initial timetable and master catalog requests overlap and share the master response', async () => {
    const pending = new Map();
    const sandbox = { currentSemester: 2, planTerm: { academicYear: 2569 }, aiChatConfig: { apiBaseUrl: 'http://localhost:3000' },
        fetch: url => new Promise(resolve => pending.set(url, resolve)), console, extractRows: r => r.data, normalizeCourseRow: r => r };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    runFile(sandbox, 'api.js');
    const loading = sandbox.fetchCourses();
    const master = sandbox.getMasterCourseRows();
    const urls = [...pending.keys()];
    assert.equal(urls.length, 2);
    const courseUrl = urls.find(url => url.endsWith('/api/courses'));
    pending.get(courseUrl)({ ok: true, json: async () => ({ status: 'success', data: [{ COURSECODE: 'TEST1001' }] }) });
    assert.equal((await master)[0].COURSECODE, 'TEST1001');
    pending.get(urls.find(url => url.includes('/api/timetable?')))({ ok: true, json: async () => ({ data: [] }) });
    await loading;
    assert.equal(sandbox.getMasterCourseRows(), master);
});

test('V7 continues a real HTTP chat across clarification, more results, filters, term and account changes', async t => {
    const express = require('express');
    const { once } = require('node:events');
    const { createAIAdvisor } = require('../src/services/aiAdvisor');
    const { createAIChatController } = require('../src/controllers/aiChatController');
    const reads = [];
    const profile = { faculty: context.faculty, major: context.major, yearLevel: 3, curriculumYear: 2565 };
    const advisor = createAIAdvisor({
        repository: { async readTermCatalog(input, source) {
            reads.push({ ...input, source });
            const courses = Array.from({ length: 20 }, (_, index) => {
                const category = index < 18 ? 'genEd' : 'free';
                const courseCode = `FIX${String(index).padStart(4, '0')}`;
                const start = index % 2 === 0 ? '09:00' : '13:00';
                return { courseCode, category, courseName: 'Fixture course', credits: 2, sections: [{ section: '1', actionable: true,
                    meetings: [{ day: 'พุธ', start, end: start === '09:00' ? '11:00' : '15:00' }] }] };
            });
            return { program: { programId: 'fixture-program', name: context.major, curriculumYear: 2565 }, courses, sources: [], term: { published: true } };
        } },
        complete: async () => '{"approach":"overview"}'
    });
    const app = express();
    app.use(express.json());
    app.post('/api/aichat', createAIChatController(advisor, async token => ({ status: 'verified', userId: token, profile })).chat);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const origin = `http://127.0.0.1:${server.address().port}/api/aichat`;
    const send = async (token, payload) => {
        const response = await fetch(origin, { method: 'POST', headers: { Authorization: token, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload) });
        assert.equal(response.status, 200);
        return response.json();
    };

    const { sandbox, elements } = browser();
    let account = 'Bearer fixture-a';
    sandbox.verifiedStudentSession = { userId: 'fixture-a' };
    sandbox.planTerm = { academicYear: 2569 };
    const requests = [];
    let response;
    sandbox.requestAIChat = async payload => {
        requests.push(JSON.parse(JSON.stringify(payload)));
        response = await send(account, payload);
        return response;
    };
    const ask = async message => {
        elements.get('ai-msg-input').value = message;
        await sandbox.sendAIMessage();
        assert.equal(requests.at(-1).message, message);
        return response;
    };
    const codes = reply => reply.academicDetails?.cards.map(card => card.code) || [];

    const clarify = await ask('อยากทราบว่ามีวิชาอื่นอีกมั้ยครับนอกจากนี่ เทอม 2');
    assert.match(clarify.reply, /GE.*วิชาเลือกเสรี/);
    assert.equal(reads.length, 0);
    const first = await ask('วิชา g e ครับผม');
    assert.equal(first.conversationId, clarify.conversationId);
    assert.doesNotMatch(first.reply, /หมายถึง/);
    assert.deepEqual(requests[1].history.map(item => item.content), [requests[0].message, clarify.reply]);
    assert.equal(codes(first).length, 10);
    sandbox.selectedCoursesData = [{ code: 'FIX0014' }];
    const more = await ask('ขออีก 5 วิชา');
    assert.equal(codes(more).length, 5);
    assert.ok(codes(more).every(code => !codes(first).includes(code)));
    assert.ok(!codes(more).includes('FIX0014'));
    const rest = await ask('ไม่เอาวิชาเดิม ขอแบบไม่เรียนเช้า');
    assert.ok(codes(rest).length > 0);
    assert.ok(rest.academicDetails.cards.every(card => ![...codes(first), ...codes(more)].includes(card.code)
        && card.groups.every(group => group.meetings.every(meeting => meeting.start === '13:00'))));
    const exhausted = await ask('มีอีกไหม');
    assert.equal(exhausted.outcome, 'no_more_courses');
    assert.deepEqual(codes(exhausted), []);
    const nextTerm = await ask('แล้วเทอม 3 ล่ะ');
    assert.equal(nextTerm.context.semester, 3);
    assert.equal(nextTerm.context.academicYear, 2569);
    assert.equal(nextTerm.context.major, profile.major);
    assert.ok(nextTerm.academicDetails.cards.every(card => card.groups[0].meetings[0].start === '13:00'));
    const corrected = await ask('ไม่ใช่ครับ ผมหมายถึงวิชาเลือกเสรี');
    assert.equal(corrected.context.semester, 3);
    assert.deepEqual(codes(corrected), ['FIX0019']);
    assert.equal(corrected.conversationState, undefined);

    const replay = await send('Bearer fixture-b', { ...requests.at(-1), message: 'มีอีกไหม', conversationId: first.conversationId });
    assert.notEqual(replay.conversationId, first.conversationId);
    assert.match(replay.reply, /หมายถึง.*GE/);

    sandbox.verifiedStudentSession = { userId: 'fixture-b' };
    account = 'Bearer fixture-b';
    const other = await ask('ขออีก 5 วิชา');
    assert.notEqual(other.conversationId, first.conversationId);
    assert.equal(requests.at(-1).conversationId, undefined);
    assert.deepEqual(requests.at(-1).history, []);
    const spelled = await ask('วิชาศึกษาทั่วไปครับผม');
    assert.doesNotMatch(spelled.reply, /หมายถึง/);
    assert.equal(codes(spelled).length, 5);
    assert.equal(reads.at(-1).semester, 2);
    const others = await ask('มีอีกไหม');
    assert.ok(codes(others).length > 0);
    assert.ok(codes(others).every(code => !codes(spelled).includes(code)));
});

test('the existing timetable context keeps the selected academic years', () => {
    const { sandbox } = browser();
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.getAIChatContext())), context);
    // Profile year is 1 while active table is year 3. It cannot override the view.
    assert.equal(sandbox.getAIChatContext().yearLevel, 3);
});

test('V6 keeps all groups and sources in collapsed disclosures by default', async () => {
    const { sandbox, elements } = browser();
    const groups = Array.from({ length: 8 }, (_, index) => ({ section: `${index + 1}`, meetings: offering.meetings }));
    sandbox.requestAIChat = async payload => {
        assert.equal(payload.presentation, 'conversation');
        return { reply: 'เจอวิชาที่ตรงเงื่อนไขครับ', context, sources: [{ label: 'Oracle EXP_CLASS' }],
            academicDetails: { cards: [{ code: 'TEST1001', name: '<b>Fixture</b>', credits: 2, groups }] } };
    };
    elements.get('ai-msg-input').value = 'ขอวิชาที่เปิดเทอมนี้';
    await sandbox.sendAIMessage();
    const reply = elements.get('ai-chat-history').children.at(-1);
    const card = reply.children.find(node => node.className === 'advisor-course-list').children[0];
    assert.equal(card.children[0].textContent, 'TEST1001 <b>Fixture</b>');
    const sections = card.children.find(node => node.className === 'advisor-result-details');
    assert.equal(sections.children[0].textContent, 'ดูทุกกลุ่มเรียน (8)');
    assert.ok(!sections.open);
    assert.equal(sections.children.slice(1).length, 8);
    const sources = reply.children.find(node => node.className === 'advisor-sources');
    assert.ok(!sources.open);
    assert.equal(sources.children[0].textContent, 'แหล่งข้อมูล');
});

test('schedule actions target the active year tab', () => {
    const { sandbox } = browser();
    sandbox.aiAcademicProfile.yearLevel = 4;
    assert.equal(sandbox.getAIChatContext().yearLevel, 4);
    assert.equal(sandbox.getAIChatContext({ forSchedule: true }).yearLevel, 3);
});

test('chat sends immediately without legacy Supabase profile data or the local account marker', async () => {
    const { sandbox, elements } = browser();
    let finish;
    let payload;
    sandbox.aiProfileReady = new Promise(resolve => { finish = resolve; });
    sandbox.requestAIChat = async request => {
        payload = request;
        return { reply: 'fixture', context: request.context, actions: [] };
    };
    elements.get('ai-msg-input').value = 'สวัสดีครับ';
    const pending = sandbox.sendAIMessage();
    assert.equal(payload.message, 'สวัสดีครับ');
    assert.deepEqual(Object.keys(payload.context), []);
    assert.doesNotMatch(JSON.stringify(payload), /fixture-student|สาขาทดสอบ/);
    finish();
    await pending;
});

test('an explicitly requested year remains the conversation target', async () => {
    const { sandbox, elements } = browser();
    const payloads = [];
    sandbox.requestAIChat = async request => {
        payloads.push(request);
        return { reply: 'fixture', context: { ...request.context, yearLevel: 1 }, actions: [] };
    };
    elements.get('ai-msg-input').value = 'แนะนำวิชา ปี 1';
    await sandbox.sendAIMessage();
    elements.get('ai-msg-input').value = 'แล้ววิชาไหนเปิดวันจันทร์';
    await sandbox.sendAIMessage();
    assert.equal(payloads[1].context.yearLevel, 1);
    assert.equal(payloads[1].history[0].content, 'แนะนำวิชา ปี 1');
    assert.equal(sandbox.getAIChatContext({ forSchedule: true }).yearLevel, 3);
});

test('missing profile never supplies a made-up faculty or major', () => {
    const { sandbox, elements } = browser();
    elements.get('profile-faculty').value = '';
    elements.get('profile-major').value = '';
    sandbox.selectedMajor = '';
    sandbox.aiAcademicProfile = { faculty: '', major: '' };
    sandbox.aiChatContext = {};
    const result = sandbox.getAIChatContext();
    assert.equal(result.faculty, '');
    assert.equal(result.major, '');
    assert.equal(result.curriculumYear, null);
});

test('viewing a friend profile cannot replace the signed-in academic context', () => {
    const { sandbox, elements } = browser();
    elements.get('profile-faculty').value = 'different fixture faculty';
    elements.get('profile-major').value = 'different fixture major';
    assert.equal(sandbox.getAIChatContext().faculty, context.faculty);
    assert.equal(sandbox.getAIChatContext().major, context.major);
});

test('profile initialization provides only the signed-in academic fields and clears failed loads', async () => {
    const { sandbox } = browser();
    sandbox.verifiedStudentSession = { userId: 'fixture-auth-user', studentId: 'fixture-student' };
    let fail = false;
    sandbox.supabaseClient = { from: table => {
        assert.equal(table, 'profiles');
        return { select: () => ({ eq: () => ({ maybeSingle: async () => fail
            ? { error: new Error('fixture error') }
            : { data: { faculty: 'fixture faculty', major: 'fixture major' } } }) }) };
    } };
    sandbox.console = { warn() {} };
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../Frontend/js/initialization.js'), 'utf8'), sandbox);
    await sandbox.fetchStudentProfileOnLogin();
    assert.equal(sandbox.aiAcademicProfile.major, 'fixture major');
    assert.deepEqual(Object.keys(sandbox.aiAcademicProfile).sort(), ['faculty', 'major', 'yearLevel']);
    assert.equal(sandbox.aiAcademicProfile.yearLevel, 1);
    fail = true;
    await sandbox.fetchStudentProfileOnLogin();
    assert.equal(sandbox.aiAcademicProfile.major, '');
    assert.equal(sandbox.selectedMajor, '');
});

test('demo trigger goes to Backend, latest message occurs once, and HTML is displayed as text', async () => {
    const { sandbox, elements } = browser();
    const calls = [];
    sandbox.requestAIChat = async payload => {
        calls.push(structuredClone(payload));
        return { reply: '<img src=x onerror=alert(1)>', context: { ...context }, actions: [], sources: [] };
    };
    sandbox.chatHistoryContext.push({ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'prior reply' });
    elements.get('ai-msg-input').value = 'แนะนำวิชา ปี 3';
    await sandbox.sendAIMessage();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].message, 'แนะนำวิชา ปี 3');
    assert.ok(!calls[0].history.some(item => item.content === calls[0].message));
    const displayed = elements.get('ai-chat-history').children.at(-1).children.at(-1);
    assert.equal(displayed.textContent, '<img src=x onerror=alert(1)>');
    elements.get('ai-msg-input').value = 'เพิ่มวิชา';
    await sandbox.sendAIMessage();
    assert.ok(calls[1].history.some(item => item.content === 'แนะนำวิชา ปี 3'));
    assert.ok(!calls[1].history.some(item => item.content === 'เพิ่มวิชา'));
});

test('concurrent send is ignored and stale view response supplies no action button', async () => {
    const { sandbox, elements } = browser();
    let resolve;
    let calls = 0;
    sandbox.requestAIChat = () => { calls++; return new Promise(done => { resolve = done; }); };
    elements.get('ai-msg-input').value = 'แนะนำ';
    const first = sandbox.sendAIMessage();
    await Promise.resolve();
    elements.get('ai-msg-input').value = 'ข้อความที่สอง';
    await sandbox.sendAIMessage();
    elements.get('semester-text').textContent = 'เทอมที่ 3';
    resolve({ reply: 'fixture reply', context: { ...context }, actions: [{ courseCode: 'TEST1001', classId: offering.classId, section: 'A' }] });
    await first;
    assert.equal(calls, 1);
    assert.equal(elements.get('ai-chat-history').children.at(-1).children.length, 2);
    assert.equal(sandbox.chatHistoryContext.length, 2);
});

test('changing the local account marker drops in-flight replies and clears conversation state', async () => {
    const { sandbox, elements, storage } = browser();
    let resolve;
    sandbox.requestAIChat = () => new Promise(done => { resolve = done; });
    elements.get('ai-msg-input').value = 'first account message';
    const pending = sandbox.sendAIMessage();
    storage.set('sut_student_id', 'second-fixture-account');
    resolve({ reply: 'first account reply', context });
    await pending;
    assert.equal(elements.get('ai-chat-history').children.length, 0);
    assert.equal(sandbox.chatHistoryContext.length, 0);
    sandbox.requestAIChat = async request => {
        assert.deepEqual(Object.keys(request.context), []);
        assert.equal(request.history.length, 0);
        return { reply: 'second account reply', context: {} };
    };
    elements.get('ai-msg-input').value = 'second account message';
    await sandbox.sendAIMessage();
    assert.equal(elements.get('ai-chat-history').children.at(-1).children.at(-1).textContent, 'second account reply');
});

test('fresh validation adds all meetings with exact minutes after confirmation', async () => {
    const { sandbox, confirms, redraws } = browser();
    const result = await sandbox.applyAICoursesList([{ courseCode: 'TEST1001', section: 'A', classId: offering.classId }]);
    assert.equal(result, true);
    assert.equal(confirms(), 1);
    assert.equal(redraws(), 1);
    assert.equal(sandbox.selectedCoursesData.length, 2);
    assert.equal(sandbox.selectedCoursesData[0].startMinutes, 555);
    assert.equal(sandbox.selectedCoursesData[0].start, 9.25);
    assert.equal(sandbox.selectedCoursesData[0].credits, 2.5);
    assert.equal(sandbox.scheduleCache['3_2'].data.length, 2);
});

test('cancelled confirmation and validation failures leave schedule intact', async () => {
    const { sandbox } = browser();
    sandbox.confirmAppAction = () => false;
    assert.equal(await sandbox.applyAICoursesList([{ courseCode: 'TEST1001', section: 'A' }]), false);
    assert.equal(sandbox.selectedCoursesData.length, 0);
    sandbox.validateAICourses = async () => { throw new Error('fixture Oracle failure'); };
    assert.equal(await sandbox.applyAICoursesList([{ courseCode: 'TEST1001', section: 'A' }]), false);
    assert.equal(sandbox.selectedCoursesData.length, 0);
});

test('changed term, user or schedule during validation cannot commit a stale action', async () => {
    for (const change of ['term', 'user', 'schedule']) {
        const { sandbox, elements, storage, confirms } = browser();
        sandbox.validateAICourses = async () => {
            if (change === 'term') elements.get('semester-text').textContent = 'เทอมที่ 3';
            if (change === 'user') storage.set('sut_student_id', 'fixture-other');
            if (change === 'schedule') sandbox.selectedCoursesData.push({ code: 'TEST9999', no_time: true });
            return { context: { ...context }, courses: [structuredClone(offering)] };
        };
        assert.equal(await sandbox.applyAICoursesList([{ courseCode: 'TEST1001', section: 'A' }]), false);
        assert.equal(confirms(), 0);
        assert.ok(!sandbox.selectedCoursesData.some(course => course.classId === offering.classId));
    }
});

test('precise overlap is blocked, adjacent classes and similar codes are allowed', () => {
    const { sandbox } = browser();
    const existing = [{ code: 'TEST100', day: 'จันทร์', start: 8, end: 9.25 }];
    assert.equal(sandbox.prepareAICourseRows([structuredClone(offering)], existing, context).length, 2);
    existing[0].end = 9.5;
    assert.throws(() => sandbox.prepareAICourseRows([structuredClone(offering)], existing, context), /ทับซ้อน/);
    assert.throws(() => sandbox.prepareAICourseRows([structuredClone(offering)], [{ code: 'TEST1001 (G.A)' }], context), /มีอยู่/);
});

test('incomplete meetings and wrong academic year reject the entire batch', () => {
    const { sandbox } = browser();
    const invalid = structuredClone(offering);
    invalid.meetings[1].day = null;
    assert.throws(() => sandbox.prepareAICourseRows([invalid], [], context), /วันหรือเวลา/);
    assert.throws(() => sandbox.prepareAICourseRows([{ ...offering, academicYear: 2570 }], [], context), /ปีการศึกษา/);
    assert.throws(() => sandbox.prepareAICourseRows([offering], [{ academicYear: 2568 }], context), /ปีการศึกษาอื่น/);
    assert.equal(sandbox.selectedCoursesData.length, 0);
});

test('API helpers use the configured base URL and expose server errors', async () => {
    const requests = [];
    const sandbox = {
        AbortSignal,
        URL,
        window: { aiChatConfig: { apiBaseUrl: 'http://fixture.invalid/' } },
        fetch: async (url, options) => {
            requests.push({ url, options });
            return { ok: true, json: async () => ({ status: 'success' }) };
        }
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../Frontend/js/api.js'), 'utf8'), sandbox);
    await sandbox.window.requestAIChat({ message: 'fixture', context });
    assert.equal(requests[0].url, 'http://fixture.invalid/api/aichat');
    assert.deepEqual(JSON.parse(requests[0].options.body).context, context);
    sandbox.fetch = async () => ({ ok: false, json: async () => ({ error: 'fixture retrieval failed' }) });
    await assert.rejects(sandbox.window.validateAICourses({ context, courses: [] }), /fixture retrieval failed/);
    sandbox.fetch = async () => { throw new Error('private network error'); };
    await assert.rejects(sandbox.window.requestAIChat({ message: 'fixture' }), /เชื่อมต่อระบบ AI ไม่สำเร็จ/);
    sandbox.fetch = async () => ({ ok: false, json: async () => { throw new Error('private parser error'); } });
    await assert.rejects(sandbox.window.requestAIChat({ message: 'fixture' }), /ส่งข้อมูลกลับมาไม่สมบูรณ์/);
});

test('advisor requests use the current Auth session and ignore the legacy storage marker', async () => {
    const { sandbox, storage } = browser();
    sandbox.URL = URL;
    sandbox.AbortSignal = AbortSignal;
    sandbox.aiChatConfig = { apiBaseUrl: 'http://localhost:3000' };
    const requests = [];
    sandbox.fetch = async (url, options) => {
        requests.push({ url, options });
        return { ok: true, json: async () => ({ status: 'success' }) };
    };
    sandbox.verifiedStudentSession = { userId: 'fixture-auth-a', studentId: 'fixture-student' };
    let authUser = 'fixture-auth-a';
    sandbox.supabaseClient = { auth: { getSession: async () => ({ data: { session: {
        access_token: 'fixture-token', user: { id: authUser }
    } } }) } };
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../Frontend/js/api.js'), 'utf8'), sandbox);
    await sandbox.requestAIProfile();
    await sandbox.requestAIChat({ message: 'แนะนำวิชา' });
    assert.equal(requests[0].url, 'http://localhost:3000/api/ai/profile');
    assert.equal(requests[0].options.method, 'GET');
    assert.equal(requests[1].options.headers.Authorization, 'Bearer fixture-token');
    assert.doesNotMatch(requests[1].options.body, /fixture-token|fixture-student/);
    storage.set('sut_student_id', 'other-account');
    await sandbox.requestAIProfile();
    assert.equal(requests[2].options.headers.Authorization, 'Bearer fixture-token');
    const pending = sandbox.requestAIChat({ message: 'สวัสดีครับ' });
    sandbox.verifiedStudentSession = { userId: 'fixture-auth-b', studentId: 'new-account' };
    await assert.rejects(pending, /บัญชีเปลี่ยน/);
    assert.equal(requests.length, 3);
    await assert.rejects(sandbox.requestAIProfile(), /บัญชีเปลี่ยน/);
    authUser = 'fixture-auth-b';
    await sandbox.requestAIChat({ message: 'สวัสดีครับ' });
    assert.equal(requests[3].options.headers.Authorization, 'Bearer fixture-token');
});

test('advisor renders the verified welcome as text and discards a stale welcome', async () => {
    const { sandbox, elements, storage } = browser();
    const welcome = new Element();
    welcome.textContent = 'สวัสดีครับ';
    elements.set('ai-welcome-text', welcome);
    sandbox.requestAIProfile = async () => ({ welcome: 'สวัสดีครับ <b>Fixture</b>' });
    await sandbox.refreshAIWelcome();
    assert.equal(welcome.textContent, 'สวัสดีครับ <b>Fixture</b>');
    let resolve;
    sandbox.requestAIProfile = () => new Promise(done => { resolve = done; });
    const pending = sandbox.refreshAIWelcome();
    storage.set('sut_student_id', 'new-account');
    resolve({ welcome: 'สวัสดีครับ คนเดิม' });
    await pending;
    assert.equal(welcome.textContent, 'สวัสดีครับ');
    sandbox.requestAIProfile = async () => ({ profileStatus: 'configuration_error', profileMessage: 'ยังตั้งค่า Supabase ไม่สมบูรณ์' });
    await sandbox.refreshAIWelcome();
    assert.match(welcome.textContent, /ยังตั้งค่า Supabase ไม่สมบูรณ์/);
});

test('minute formatting and fractional timetable grid preserve actual times', () => {
    const sandbox = { window: {}, document: {}, console };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../Frontend/js/utils.js'), 'utf8'), sandbox);
    assert.equal(sandbox.formatScheduleHour(9.25), '09:15');
    assert.equal(sandbox.formatScheduleHour(10.75), '10:45');
    assert.equal(sandbox.escapeCourseHTML('<img>'), '&lt;img&gt;');
    const html = [];
    const grid = { style: {}, insertAdjacentHTML: (position, value) => html.push(value), lastElementChild: { addEventListener() {} } };
    sandbox.document.getElementById = () => grid;
    sandbox.window.formatCourseCodeDisplay = code => code;
    sandbox.courseColorMap = {};
    sandbox.classColors = ['#fff'];
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../Frontend/js/timetable.js'), 'utf8'), sandbox);
    sandbox.drawTimetableGrid([{ id: 'fixture', code: 'TEST1001', day: 'จันทร์', start: 9.25, end: 10.75, credits: 2.5 }]);
    assert.match(html.at(-1), /09:15-10:45/);
    assert.doesNotMatch(html.at(-1), /grid-column: [\d]+\./);
});

test('automatic plan uses verified groups and saves only after confirmed fresh validation', async () => {
    const { sandbox, elements } = browser();
    const button = { innerHTML: 'จัดตาราง', textContent: '', disabled: false };
    elements.set('auto-plan-btn', button);
    sandbox.URLSearchParams = URLSearchParams;
    sandbox.aiChatConfig = { apiBaseUrl: 'http://fixture.invalid' };
    let saves = 0;
    sandbox.saveSchedule = async () => { saves++; };
    const validate = sandbox.validateAICourses;
    sandbox.validateAICourses = async request => ({ ...await validate(request), unresolvedPlanRows: 2 });
    let confirmation;
    sandbox.confirmAppAction = text => { confirmation = text; return true; };
    let url;
    sandbox.fetch = async requested => {
        url = requested;
        return { ok: true, json: async () => ({ status: 'success',
            data: [{ COURSECODE: 'TEST1001' }], offerings: [structuredClone(offering)] }) };
    };
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../Frontend/js/auto-recommend.js'), 'utf8'), sandbox);
    await sandbox.handleAutoRecommend();
    assert.match(url, /curriculumYear=2565/);
    assert.match(url, /academicYear=2569/);
    assert.equal(sandbox.selectedCoursesData.length, 2);
    assert.equal(sandbox.selectedCoursesData[0].section, 'A');
    assert.match(confirmation, /2 รายการที่ยืนยันรหัสวิชาไม่ได้/);
    assert.equal(saves, 1);
    assert.equal(button.disabled, false);
});

function planReplyFixture(overrides = {}) {
    return { status: 'success', outcome: 'grounded', reply: 'แผน', actions: [],
        sources: [{ id: 'oracle-plan', label: 'Oracle plan' }],
        context: { ...context, academicYear: null, yearLevel: 1, semester: 2 }, ...overrides };
}

test('a verified plan reply offers a button for its own year and term', async () => {
    const { sandbox, elements } = browser();
    sandbox.requestAIChat = async () => planReplyFixture();
    let requested;
    sandbox.scheduleAIPlan = async planContext => { requested = planContext; return true; };
    elements.get('ai-msg-input').value = 'แนะนำวิชาปี 1 เทอม 2';
    await sandbox.sendAIMessage();
    const bubble = elements.get('ai-chat-history').children.at(-1);
    const button = bubble.children.find(child => child.type === 'button');
    assert.equal(button.textContent, 'จัดลงตาราง ชั้นปี 1 เทอม 2');
    await button.listeners.click();
    assert.equal(requested.yearLevel, 1);
    assert.equal(requested.semester, 2);
    assert.equal(button.textContent, 'จัดลงตารางแล้ว');
});

test('no plan button without Oracle plan evidence or a complete context', async () => {
    for (const reply of [planReplyFixture({ sources: [{ id: 'oracle-catalog', label: 'catalog' }] }),
        planReplyFixture({ outcome: 'context_required' }),
        planReplyFixture({ context: { ...context, curriculumYear: null, yearLevel: 1, semester: 2 } })]) {
        const { sandbox, elements } = browser();
        sandbox.requestAIChat = async () => reply;
        sandbox.scheduleAIPlan = async () => true;
        elements.get('ai-msg-input').value = 'แนะนำวิชา';
        await sandbox.sendAIMessage();
        const bubble = elements.get('ai-chat-history').children.at(-1);
        assert.ok(!bubble.children.some(child => child.type === 'button'));
    }
});

function termTabs(sandbox, elements, yearTab) {
    const tabs = [1, 2, 3].map(year => {
        const tab = year === 3 ? yearTab : new Element();
        tab.textContent = `ชั้นปี ${year}`;
        tab.classList = { items: new Set(year === 3 ? ['active'] : []),
            add(name) { this.items.add(name); }, remove(name) { this.items.delete(name); } };
        return tab;
    });
    sandbox.document.querySelectorAll = selector => selector === '.year-tab' ? tabs : [];
    sandbox.document.querySelector = selector => selector === '.year-tab.active'
        ? tabs.find(tab => tab.classList.items.has('active')) || null : null;
    let loads = 0;
    sandbox.loadSchedule = async () => { loads++; sandbox.selectedCoursesData = []; };
    sandbox.aiChatConfig = { apiBaseUrl: 'http://fixture.invalid' };
    sandbox.fetch = async url => {
        assert.equal(url, 'http://fixture.invalid/api/terms');
        return { ok: true, json: async () => ({ status: 'success', terms: [
            { academicYear: 2568, semester: 2, classes: 5 }, { academicYear: 2568, semester: 3, classes: 5 },
            { academicYear: 2569, semester: 1, classes: 9 }] }) };
    };
    return { tabs, loads: () => loads };
}

test('plan button asks for the academic year, switches to the plan term and runs the verified planner', async () => {
    const { sandbox, elements, yearTab } = browser();
    const { tabs, loads } = termTabs(sandbox, elements, yearTab);
    sandbox.selectedCoursesData = [{ id: 'kept' }];
    sandbox.selectedCourseIds = ['kept'];
    sandbox.chooseAppOption = () => ' ๒๕๖๙ ';
    let planned;
    sandbox.autoScheduleForContext = async active => { planned = active; return true; };
    const added = await sandbox.scheduleAIPlan({ ...context, academicYear: null, yearLevel: 1, semester: 3 });
    assert.equal(added, true);
    assert.equal(loads(), 1);
    assert.ok(tabs[0].classList.items.has('active'));
    assert.equal(elements.get('semester-text').textContent, 'เทอมที่ 3');
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.scheduleCache['3_2'].ids)), ['kept']);
    assert.equal(planned.academicYear, 2569);
    assert.equal(planned.yearLevel, 1);
    assert.equal(planned.semester, 3);
    assert.equal(planned.curriculumYear, context.curriculumYear);
});

test('plan button stops on cancel, invalid year, missing tab or a different program', async () => {
    const run = async (prompt, plan) => {
        const { sandbox, elements, yearTab, alerts } = browser();
        termTabs(sandbox, elements, yearTab);
        sandbox.chooseAppOption = () => prompt;
        let calls = 0;
        sandbox.autoScheduleForContext = async () => { calls++; return true; };
        const added = await sandbox.scheduleAIPlan({ ...context, academicYear: null, yearLevel: 1, semester: 2, ...plan });
        return { added, calls, alerts };
    };
    const cancelled = await run(null);
    assert.deepEqual([cancelled.added, cancelled.calls, cancelled.alerts.length], [false, 0, 0]);
    const invalid = await run('569');
    assert.deepEqual([invalid.added, invalid.calls], [false, 0]);
    assert.match(invalid.alerts[0], /เลือกปีการศึกษาจากรายการ/);
    const missingTab = await run('2569', { yearLevel: 7 });
    assert.match(missingTab.alerts[0], /ไม่พบตารางชั้นปี 7/);
    const otherMajor = await run('2569', { major: 'สาขาอื่น' });
    assert.equal(otherMajor.calls, 0);
    assert.match(otherMajor.alerts[0], /ไม่ตรงกับแผน/);
});

test('academic year choices list published years and mark the unpublished latest year as reference', () => {
    const { sandbox } = browser();
    const terms = [{ academicYear: 2567, semester: 3, classes: 4 }, { academicYear: 2568, semester: 3, classes: 4 },
        { academicYear: 2569, semester: 1, classes: 9 }];
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.aiAcademicYearChoices(terms, 3))), [
        { year: 2567, label: '2567' }, { year: 2568, label: '2568' },
        { year: 2569, label: '2569 (ยังไม่ประกาศตาราง ใช้เวลาอ้างอิงปี 2568)' }]);
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.aiAcademicYearChoices(terms, 1))).map(choice => choice.year), [2569]);
});

test('reference sections are labelled in the confirmation and kept on the timetable rows', async () => {
    const { sandbox } = browser();
    let confirmation;
    sandbox.confirmAppAction = text => { confirmation = text; return true; };
    sandbox.validateAICourses = async () => ({ status: 'success', context: { ...context },
        courses: [{ ...structuredClone(offering), reference: true, sourceAcademicYear: 2568, sourceSemester: 2 }] });
    const added = await sandbox.applyAICoursesList([{ courseCode: 'TEST1001', classId: 'fixture-class-1', section: 'A' }], { ...context });
    assert.equal(added, true);
    assert.match(confirmation, /ข้อมูลจำลอง: 1 วิชาใช้เวลาเรียนอ้างอิงจาก ปี 2568 เทอม 2 ยังไม่ยืนยันเวลาเปิดสอนปีการศึกษา 2569 และใช้ลงทะเบียนจริงไม่ได้/);
    assert.match(confirmation, /กลุ่ม A \(เวลาอ้างอิง ปี 2568 เทอม 2\)/);
    // Saved rows keep the data type, source term and verification state.
    assert.ok(sandbox.selectedCoursesData.every(row => row.reference === true && row.dataType === 'historical_simulation'
        && row.sourceAcademicYear === 2568 && row.sourceSemester === 2 && row.verificationStatus === 'simulated'));
    const saved = JSON.parse(JSON.stringify(sandbox.selectedCoursesData));
    assert.deepEqual([saved[0].dataType, saved[0].sourceAcademicYear, saved[0].sourceSemester], ['historical_simulation', 2568, 2]);
});

test('automatic plan explains why a planned course was skipped', async () => {
    const { sandbox, elements, alerts } = browser();
    elements.set('auto-plan-btn', { innerHTML: 'จัดตาราง', textContent: '', disabled: false });
    sandbox.URLSearchParams = URLSearchParams;
    sandbox.aiChatConfig = { apiBaseUrl: 'http://fixture.invalid' };
    sandbox.fetch = async () => ({ ok: true, json: async () => ({ status: 'success',
        data: [{ COURSECODE: 'TEST1002' }], offerings: [], courseStatus: { TEST1002: 'not_offered' } }) });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../Frontend/js/auto-recommend.js'), 'utf8'), sandbox);
    await sandbox.handleAutoRecommend();
    assert.match(alerts[0], /TEST1002 — ไม่เปิดสอนในปีการศึกษาและภาคเรียนนี้/);
});

// ---- V5: shared planner term, course search and simulation labels ----
const runFile = (sandbox, file) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../Frontend/js', file), 'utf8'), sandbox, { filename: file });

function plannerBrowser() {
    const env = browser();
    const events = [];
    env.sandbox.document.dispatchEvent = event => events.push(event);
    env.sandbox.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
    env.sandbox.aiChatConfig = { apiBaseUrl: 'http://fixture.invalid' };
    env.sandbox.URLSearchParams = URLSearchParams;
    runFile(env.sandbox, 'plan-term.js');
    return { ...env, events };
}

test('V5: one planner state drives the schedule context, the timetable source and change events', () => {
    const { sandbox, events } = plannerBrowser();
    assert.equal(sandbox.getAIChatContext({ forSchedule: true }).academicYear, context.academicYear);
    sandbox.setPlanAcademicYear(2570);
    assert.equal(sandbox.planTerm.academicYear, 2570);
    assert.equal(sandbox.getAIChatContext({ forSchedule: true }).academicYear, 2570);
    assert.equal(events.at(-1).type, 'planterm:change');
    assert.equal(events.at(-1).detail.academicYear, 2570);
    sandbox.planTerm.sourceAcademicYear = 2568;
    sandbox.planTerm.sourceSemester = 3;
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.getPlanSource())), { mode: 'simulate', sourceAcademicYear: 2568, sourceSemester: 3 });
    sandbox.planTerm.mode = 'actual';
    assert.deepEqual(JSON.parse(JSON.stringify(sandbox.getPlanSource())), { mode: 'actual', sourceAcademicYear: null, sourceSemester: null });
});

test('V5: draft banner names simulated sources, missing times and a timetable published since', () => {
    const { sandbox, elements } = plannerBrowser();
    const notice = new Element();
    elements.set('plan-sim-notice', notice);
    sandbox.planTerm.loaded = true;
    sandbox.planTerm.terms = [{ academicYear: 2569, semester: 2, classes: 10 }];
    sandbox.selectedCoursesData = [
        { id: 'a', code: 'TEST1001 (G.A)', courseCode: 'TEST1001', reference: true, academicYear: 2569, sourceAcademicYear: 2568, sourceSemester: 2 },
        { id: 'b', code: 'TEST1003', no_time: true }];
    sandbox.refreshPlanNotice();
    const text = notice.children.map(child => child.textContent).join('\n');
    assert.match(text, /วิชาจำลอง 1 วิชา ใช้เวลาอ้างอิงจาก ปี 2568 เทอม 2 ยังไม่ใช่ตารางลงทะเบียนจริง/);
    assert.match(text, /ปีการศึกษา 2569 เทอม 2 มีตารางสอนจริงใน Oracle แล้ว/);
    assert.match(text, /มี 1 วิชาที่ไม่มีเวลาเรียน จึงตรวจเวลาชนกันได้ไม่ครบถ้วน/);
    assert.equal(notice.hidden, false);
});

function catalogBrowser() {
    const env = plannerBrowser();
    for (const id of ['courses-major', 'courses-gen', 'courses-free', 'search-major', 'search-gen', 'search-free']) env.elements.set(id, new Element());
    env.sandbox.planTerm.academicYear = 2569;
    env.sandbox.planTerm.sourceAcademicYear = 2568;
    env.sandbox.planTerm.sourceSemester = 2;
    env.sandbox.formatCourseCodeDisplay = code => code;
    runFile(env.sandbox, 'course-categories.js');
    const lists = {};
    env.sandbox.setupCourseSearchBox = (inputId, listId, courses, active) => { lists[listId] = { courses, active }; };
    return { ...env, lists };
}

const catalogCourse = (code, category, sections, status = 'offered') => ({ courseCode: code, courseName: code, credits: 3, category, status, sections });

test('V5: course search reads the planned term and source, and splits categories from the program structure', async () => {
    const { sandbox, lists } = catalogBrowser();
    let url;
    sandbox.fetch = async requested => {
        url = new URL(requested);
        return { ok: true, json: async () => ({ status: 'success', program: { name: 'p', curriculumYear: 2565 }, courses: [
            catalogCourse('MAJ1', 'major', [{ ...offering, courseCode: 'MAJ1' }]), catalogCourse('GEN1', 'genEd', []), catalogCourse('FREE1', 'free', [])] }) };
    };
    await sandbox.fetchAndSetupCourseCategories();
    assert.equal(url.pathname, '/api/catalog/offerings');
    assert.deepEqual(['academicYear', 'semester', 'mode', 'sourceAcademicYear', 'sourceSemester', 'major'].map(name => url.searchParams.get(name)),
        ['2569', '2', 'simulate', '2568', '2', context.major]);
    assert.deepEqual(Object.keys(lists).map(id => [id, lists[id].courses.map(course => course.courseCode)]),
        [['courses-major', ['MAJ1']], ['courses-gen', ['GEN1']], ['courses-free', ['FREE1']]]);
    assert.equal(lists['courses-major'].active.academicYear, 2569);
    assert.equal(sandbox.aiChatContext.curriculumYear, 2565);
});

test('V5: section labels separate real and historical times and never invent a time', () => {
    const { sandbox } = catalogBrowser();
    const term = { academicYear: 2569, semester: 1 };
    const real = { ...offering, section: '1', actionable: true, meetings: [{ day: 'จันทร์', start: '13:00', end: '16:00' }] };
    assert.equal(sandbox.sectionLabel(real, term), 'กลุ่ม 1 | จันทร์ 13:00–16:00 | ปี 2569 เทอม 1');
    assert.equal(sandbox.sectionLabel({ ...real, section: '3', reference: true, sourceAcademicYear: 2568, sourceSemester: 1 }, term),
        'เวลาอ้างอิง กลุ่ม 3 | จันทร์ 13:00–16:00 | จากปี 2568 เทอม 1');
    assert.equal(sandbox.sectionLabel({ ...real, actionable: false, meetings: [{ day: null, start: null, end: null }] }, term),
        'กลุ่ม 1 | ข้อมูลวันหรือเวลาไม่ครบ');
});

test('V5: picking a section validates with the planner source; a course without time is kept as interest only', async () => {
    const { sandbox } = catalogBrowser();
    sandbox.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', program: { name: 'p', curriculumYear: 2565 }, courses: [] }) });
    await sandbox.fetchAndSetupCourseCategories();
    let call;
    sandbox.applyAICoursesList = async (...args) => { call = args; return true; };
    let saves = 0;
    sandbox.saveSchedule = async () => { saves++; return true; };
    await sandbox.addCatalogSection({ courseCode: 'TEST1001' }, { ...offering, actionable: true }, null);
    assert.deepEqual(JSON.parse(JSON.stringify(call[0])), [{ courseCode: 'TEST1001', classId: 'fixture-class-1', section: 'A' }]);
    assert.deepEqual(JSON.parse(JSON.stringify(call[2])), { mode: 'simulate', sourceAcademicYear: 2568, sourceSemester: 2 });
    assert.equal(saves, 1);
    sandbox.updateDatabaseTimetableAndCredits = () => {};
    await sandbox.addInterestedCourse({ courseCode: 'TEST9009', courseName: 'วิชาที่สนใจ', credits: 3 }, { academicYear: 2569, yearLevel: 3, semester: 2 });
    const row = sandbox.selectedCoursesData.at(-1);
    assert.deepEqual([row.no_time, row.interestOnly, row.section, row.day, row.start, row.end], [true, true, '-', '-', 0, 0]);
    assert.doesNotMatch(row.code, /G\./);
});

test('identical catalog requests share one fetch while loading', async () => {
    const { sandbox } = catalogBrowser();
    let resolve;
    let calls = 0;
    sandbox.fetch = () => { calls++; return new Promise(done => { resolve = done; }); };
    const first = sandbox.fetchAndSetupCourseCategories();
    const second = sandbox.fetchAndSetupCourseCategories();
    assert.equal(calls, 1);
    resolve({ ok: true, json: async () => ({ status: 'success', program: { name: 'p', curriculumYear: 2565 }, courses: [] }) });
    await Promise.all([first, second]);
});

test('V5: the AI plan button forwards the chat source and days to avoid; "added" needs a successful save', async () => {
    const { sandbox, elements, yearTab } = browser();
    sandbox.document.querySelectorAll = selector => selector === '.year-tab' ? [yearTab] : [];
    yearTab.classList = { add() {}, remove() {} };
    yearTab.textContent = 'ชั้นปี 3';
    sandbox.setPlanAcademicYear = () => {};
    sandbox.planTerm = { academicYear: 2569 };
    sandbox.getPlanSource = () => ({ mode: 'simulate', sourceAcademicYear: null, sourceSemester: null });
    let args;
    sandbox.autoScheduleForContext = async (...received) => { args = received; return true; };
    await sandbox.scheduleAIPlan({ ...context, academicYear: null }, { source: { mode: 'simulate', sourceAcademicYear: 2568, sourceSemester: 3 }, excludeDays: ['ศุกร์'] });
    assert.equal(args[0].academicYear, 2569);
    assert.deepEqual(JSON.parse(JSON.stringify(args[1])), { mode: 'simulate', sourceAcademicYear: 2568, sourceSemester: 3 });
    assert.deepEqual(JSON.parse(JSON.stringify(args[2])), { excludeDays: ['ศุกร์'] });
    assert.equal(elements.get('semester-text').textContent, 'เทอมที่ 2');

    sandbox.URLSearchParams = URLSearchParams;
    sandbox.aiChatConfig = { apiBaseUrl: 'http://fixture.invalid' };
    sandbox.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', data: [{ COURSECODE: 'TEST1001' }],
        offerings: [structuredClone(offering)] }) });
    runFile(sandbox, 'auto-recommend.js');
    sandbox.saveSchedule = async () => false;
    assert.equal(await sandbox.autoScheduleForContext({ ...context }, null), false);
    const friday = { ...structuredClone(offering), meetings: [{ day: 'ศุกร์', start: '09:00', end: '10:00' }] };
    sandbox.fetch = async () => ({ ok: true, json: async () => ({ status: 'success', data: [{ COURSECODE: 'TEST1001' }], offerings: [friday] }) });
    sandbox.selectedCoursesData = [];
    assert.equal(await sandbox.autoScheduleForContext({ ...context }, null, { excludeDays: ['ศุกร์'] }), false);
});

test('V5: timetable slots and cart cards label simulated rows with their source term', () => {
    const sandbox = { window: {}, document: {}, console };
    vm.createContext(sandbox);
    runFile(sandbox, 'utils.js');
    const html = [];
    const grid = { style: {}, insertAdjacentHTML: (position, value) => html.push(value), lastElementChild: { addEventListener() {} } };
    sandbox.document.getElementById = () => grid;
    sandbox.window.formatCourseCodeDisplay = code => code;
    sandbox.courseColorMap = {};
    sandbox.classColors = ['#fff'];
    runFile(sandbox, 'timetable.js');
    sandbox.drawTimetableGrid([{ id: 'x', code: 'TEST1001 (G.3)', day: 'จันทร์', start: 13, end: 16, credits: 3,
        reference: true, sourceAcademicYear: 2568, sourceSemester: 1 }]);
    assert.match(html.at(-1), /is-simulated/);
    assert.match(html.at(-1), /จำลอง · 2568\/1/);
    assert.match(html.at(-1), /เวลาอ้างอิงจากปี 2568 เทอม 1 ยังไม่ยืนยันเวลาเปิดสอน/);
});

test('friend import never inserts hardcoded courses or invented times; missing sections stay empty', () => {
    const { sandbox, alerts } = browser();
    sandbox.selectedCoursesData = [];
    sandbox.allCourses = [{ COURSECODE: '1101041', COURSENAME: 'x', COURSEUNIT: '3' }];
    sandbox.masterCourses = sandbox.allCourses;
    sandbox.closeModal = () => {};
    runFile(sandbox, 'schedule-import.js');
    assert.equal(sandbox.confirmImportSchedule(), false);
    assert.deepEqual(sandbox.selectedCoursesData, []);
    assert.match(alerts.at(-1), /ยังนำเข้าตารางเรียนจากเพื่อนไม่ได้/);
    const utils = { window: {}, document: {}, console };
    vm.createContext(utils);
    runFile(utils, 'utils.js');
    assert.equal(vm.runInContext("getSection({ COURSECODE: 'X' })", utils), '');
    assert.equal(vm.runInContext('getSection({ SECTION: 3 })', utils), '3');
});
