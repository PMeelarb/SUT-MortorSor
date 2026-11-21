const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const studentId = 'B6712345';
const user = { id: 'fixture-auth-1', app_metadata: { student_id: studentId } };
const selfServiceUser = { id: 'ab000000-0000-4000-8000-000000000001',
    user_metadata: { student_id: studentId, student_profile: {
        reported_student_id: studentId, first_name: 'Registered', last_name: 'Student',
        faculty: 'Registered faculty', major: 'Registered major'
    } } };
const selfServiceKey = 'U-AB000000000040008000000000000001';

function browser(auth = {}) {
    const navigation = [];
    const alerts = [];
    const listeners = [];
    const elements = new Map();
    const storage = new Map([['sut_student_id', 'OLD-ACCOUNT']]);
    const supabaseClient = { auth };
    const sandbox = {
        supabaseClient, supabase: { createClient: () => supabaseClient },
        sutSupabaseConfig: { url: 'https://fixture.example.test', publishableKey: 'fixture-publishable' },
        location: { replace: url => navigation.push(url) },
        localStorage: {
            getItem: name => storage.get(name) ?? null,
            setItem: (name, value) => storage.set(name, value),
            removeItem: name => storage.delete(name)
        },
        document: {
            body: { inert: true },
            addEventListener: (event, callback) => {
                if (event === 'DOMContentLoaded') listeners.push(callback);
            },
            getElementById: id => elements.get(id),
            querySelector: () => null,
            querySelectorAll: () => []
        },
        console: { warn() {} },
        showAppNotice: message => alerts.push(message)
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    const load = (...files) => {
        for (const file of files) vm.runInContext(
            fs.readFileSync(path.join(__dirname, '../../Frontend', file), 'utf8'), sandbox, { filename: file }
        );
    };
    const ready = () => Promise.all(listeners.map(listener => listener()));
    load('js/student-session.js');
    return { sandbox, elements, storage, navigation, alerts, load, ready };
}

for (const scenario of ['linked', 'unlinked', 'invalid']) {
    test(`login handles ${scenario} credentials with an Auth-scoped identity`, async () => {
        const signOut = [];
        const { elements, storage, navigation, alerts, load, ready } = browser({
            async signInWithPassword({ email, password }) {
                assert.equal(email, 'fixture@example.test');
                assert.equal(password, 'fixture-password');
                if (scenario === 'invalid') return { error: new Error('invalid credentials') };
                const account = scenario === 'linked' ? user : selfServiceUser;
                return { data: { user: account, session: { access_token: 'fixture-token' } } };
            },
            async signOut({ scope }) { signOut.push(scope); return { error: null }; }
        });
        const button = { disabled: false, textContent: 'เข้าสู่ระบบ' };
        const password = { value: 'fixture-password' };
        let submit;
        elements.set('form-login', { querySelector: () => button, addEventListener: (_, handler) => { submit = handler; } });
        elements.set('login-email', { value: ' fixture@example.test ' });
        elements.set('login-password', password);
        load('auth.js');
        await ready();
        await submit({ preventDefault() {} });
        assert.deepEqual(navigation, scenario === 'invalid' ? [] : ['index.html']);
        if (scenario === 'linked') assert.equal(storage.get('sut_student_id'), studentId);
        if (scenario === 'unlinked') assert.equal(storage.get('sut_student_id'), selfServiceKey);
        assert.deepEqual(signOut, []);
        assert.equal(alerts.length, scenario === 'invalid' ? 1 : 0);
        assert.equal(password.value, '');
        assert.equal(button.disabled, false);
    });
}

for (const scenario of ['session issued', 'email confirmation required', 'obfuscated existing account']) {
    test(`registration handles ${scenario} without writing a legacy profile from a submitted student ID`, async () => {
        let supplied;
        const { sandbox, elements, navigation, storage, load, ready } = browser({
            signUp: async credentials => {
                supplied = credentials;
                if (scenario === 'obfuscated existing account') {
                    return { data: { user: { id: 'obfuscated', identities: [] }, session: null } };
                }
                return { data: { user: { ...selfServiceUser, identities: [{}] },
                    session: scenario === 'session issued' ? { access_token: 'fixture' } : null } };
            }
        });
        sandbox.fetch = async () => ({ json: async () => ({ status: 'error', error: 'fixture' }) });
        sandbox.supabaseClient.from = () => assert.fail('registration must not write to public.profiles');
        let notice;
        sandbox.Swal = { fire: async message => { notice = message; } };
        const button = { disabled: false, innerText: 'สมัครสมาชิก' };
        let submit;
        elements.set('form-register', { querySelector: () => button, addEventListener: (_, handler) => { submit = handler; },
            reset() {} });
        const filled = {
            'reg-studentid': studentId, 'reg-firstname': 'Fixture', 'reg-lastname': 'Student',
            'reg-email': 'fixture@example.test', 'reg-password': 'fixture-password', 'register-faculty': 'Faculty',
            'register-major': 'Major', 'login-email': ''
        };
        for (const [id, value] of Object.entries(filled)) elements.set(id, { value });
        load('auth.js');
        await ready();
        await submit({ preventDefault() {} });
        assert.equal(supplied.options.data.student_profile.reported_student_id, studentId);
        assert.equal(supplied.options.data.student_profile.major, 'Major');
        assert.equal(elements.get('reg-password').value, '');
        if (scenario === 'session issued') {
            assert.deepEqual(navigation, ['index.html']);
            assert.equal(storage.get('sut_student_id'), selfServiceKey);
            assert.equal(notice, undefined);
        } else {
            assert.deepEqual(navigation, []);
            assert.equal(notice.icon, 'info');
            assert.match(notice.text, scenario === 'obfuscated existing account' ? /บัญชีเดิม/ : /โปรเจกต์ Supabase/);
        }
    });
}

test('missing profile RPC shows registration fields read-only until a stored profile is available', async () => {
    const { sandbox, elements, storage, navigation, load, ready } = browser({
        getUser: async () => ({ data: { user: selfServiceUser } }),
        onAuthStateChange() {}
    });
    const queries = [];
    let provisionResult = { error: { code: 'PGRST202', message: 'fixture sensitive detail' } };
    let row = null;
    elements.set('profile-load-notice', {});
    elements.set('profile-load-message', {});
    elements.set('display-student-id', {});
    elements.set('display-profile-name', {});
    elements.set('profile-fullname', {});
    elements.set('profile-faculty', {});
    elements.set('profile-major', {});
    elements.set('profile-age', {});
    elements.set('save-profile-btn', { addEventListener() {} });
    sandbox.initReviewSystem = () => {};
    sandbox.fetchCourses = async () => {};
    sandbox.loadSchedule = () => {};
    sandbox.supabaseClient.from = table => ({ select: () => ({ eq: (field, key) => ({ maybeSingle: async () => {
        queries.push([table, field, key]);
        return { data: row };
    } }) }) });
    sandbox.supabaseClient.rpc = async (operation, parameters) => {
        assert.equal(operation, 'ensure_self_service_profile');
        assert.equal(parameters, undefined);
        if (provisionResult.data === selfServiceKey) {
            row = { first_name: 'From Supabase', faculty: 'Fixture faculty', major: 'Fixture major' };
        }
        return provisionResult;
    };
    load('js/profile-session.js', 'js/initialization.js');
    await ready();
    await sandbox.aiProfileReady;
    assert.equal(sandbox.document.body.inert, false);
    assert.equal(storage.get('sut_student_id'), selfServiceKey);
    assert.deepEqual(navigation, []);
    assert.equal(elements.get('profile-load-notice').hidden, false);
    assert.match(elements.get('profile-load-message').textContent, /แสดงข้อมูลที่ลงทะเบียนไว้.*PGRST202/);
    assert.equal(elements.get('display-student-id').textContent, studentId);
    assert.equal(elements.get('display-profile-name').textContent, 'Registered Student');
    assert.equal(elements.get('profile-fullname').value, 'Registered Student');
    assert.equal(elements.get('profile-faculty').value, 'Registered faculty');
    assert.equal(elements.get('profile-major').value, 'Registered major');
    assert.equal(elements.get('profile-major').readOnly, true);
    assert.equal(elements.get('profile-age').readOnly, true);
    assert.equal(elements.get('save-profile-btn').disabled, true);
    assert.equal(sandbox.aiAcademicProfile.major, '');

    provisionResult = { data: studentId };
    await sandbox.fetchStudentProfileOnLogin();
    assert.equal(queries.length, 2);
    assert.match(elements.get('profile-load-message').textContent, /PROFILE_KEY_MISMATCH/);
    assert.equal(sandbox.aiAcademicProfile.major, '');

    provisionResult = { data: selfServiceKey };
    await sandbox.fetchStudentProfileOnLogin();
    assert.deepEqual(queries, Array(4).fill(['profiles', 'student_id', selfServiceKey]));
    assert.equal(elements.get('profile-load-notice').hidden, true);
    assert.equal(elements.get('save-profile-btn').disabled, false);
    assert.equal(elements.get('profile-fullname').value, 'From Supabase');
    assert.equal(elements.get('profile-faculty').value, 'Fixture faculty');
    assert.equal(elements.get('profile-major').value, 'Fixture major');
    assert.equal(elements.get('profile-major').readOnly, false);
    assert.equal(elements.get('profile-age').readOnly, false);
    assert.equal(sandbox.aiAcademicProfile.major, 'Fixture major');
    assert.deepEqual(navigation, []);
});

for (const scenario of [
    { name: 'missing registration metadata', metadata: {}, code: 'PGRST202' },
    { name: 'a provisioning permission error', metadata: selfServiceUser.user_metadata, code: '42501' }
]) {
    test(`profile keeps the error visible for ${scenario.name}`, async () => {
        const { sandbox, elements, load } = browser({
            getUser: async () => ({ data: { user: { ...selfServiceUser, user_metadata: scenario.metadata } } }),
            onAuthStateChange() {}
        });
        elements.set('profile-load-message', {});
        elements.set('profile-fullname', { value: '' });
        elements.set('save-profile-btn', {});
        sandbox.supabaseClient.from = () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) });
        sandbox.supabaseClient.rpc = async () => ({ error: { code: scenario.code } });
        load('js/profile-session.js', 'js/initialization.js');
        await sandbox.checkUserSession();
        await sandbox.fetchStudentProfileOnLogin();
        assert.equal(elements.get('profile-load-message').textContent, `Supabase เตรียมโปรไฟล์ไม่สำเร็จ (${scenario.code})`);
        assert.equal(elements.get('profile-fullname').value, '');
        assert.equal(elements.get('save-profile-btn').disabled, true);
    });
}

test('an existing account profile loads without calling provisioning and read errors stay on the page', async () => {
    const { sandbox, elements, navigation, load } = browser({
        getUser: async () => ({ data: { user: selfServiceUser } }),
        onAuthStateChange() {}
    });
    elements.set('profile-load-message', {});
    elements.set('profile-major', {});
    let result = { data: { major: 'Saved major' } };
    let provisioned = false;
    sandbox.supabaseClient.rpc = async () => { provisioned = true; };
    sandbox.supabaseClient.from = () => ({ select: () => ({ eq: (_, key) => ({ maybeSingle: async () => {
        assert.equal(key, selfServiceKey);
        return result;
    } }) }) });
    load('js/profile-session.js', 'js/initialization.js');
    assert.equal(await sandbox.checkUserSession(), true);
    await sandbox.fetchStudentProfileOnLogin();
    assert.equal(elements.get('profile-major').value, 'Saved major');

    result = { error: { code: '42501' } };
    await sandbox.fetchStudentProfileOnLogin();
    assert.equal(elements.get('profile-load-message').textContent, 'Supabase อ่านโปรไฟล์ไม่สำเร็จ (42501)');
    assert.equal(sandbox.aiAcademicProfile.major, '');
    assert.equal(provisioned, false);
    assert.deepEqual(navigation, []);
});

test('an older Auth account without profile metadata provisions its own row before schedule loads', async () => {
    const { sandbox, elements, load, ready } = browser({
        getUser: async () => ({ data: { user: { id: selfServiceUser.id } } }),
        onAuthStateChange() {}
    });
    const calls = [];
    let stored = null;
    elements.set('profile-load-notice', {});
    elements.set('profile-fullname', {});
    elements.set('save-profile-btn', { addEventListener() {} });
    sandbox.initReviewSystem = () => {};
    sandbox.fetchCourses = async () => {};
    sandbox.loadSchedule = () => calls.push('schedule');
    sandbox.supabaseClient.from = table => ({ select: fields => ({ eq: (_, key) => ({ maybeSingle: async () => {
        assert.equal(table, 'profiles');
        assert.equal(fields, 'student_id,first_name,last_name,faculty,major,age,free_time,mbti,learning_style,social_media');
        assert.equal(key, selfServiceKey);
        calls.push('read');
        return { data: stored };
    } }) }) });
    sandbox.supabaseClient.rpc = async (name, args) => {
        assert.equal(name, 'ensure_self_service_profile');
        assert.equal(args, undefined);
        calls.push('create');
        stored = { first_name: '', last_name: '' };
        return { data: selfServiceKey };
    };
    load('js/profile-session.js', 'js/initialization.js');
    await ready();
    assert.deepEqual(calls, ['read', 'create', 'read', 'schedule']);
    assert.equal(elements.get('profile-fullname').readOnly, false);
    assert.equal(elements.get('save-profile-btn').disabled, false);
    assert.equal(elements.get('profile-load-notice').hidden, true);
});

test('saving checks that Supabase updated the current profile before displaying success', async () => {
    const { sandbox, elements, alerts, load } = browser({
        getUser: async () => ({ data: { user } }),
        onAuthStateChange() {}
    });
    const successes = [];
    let saved = null;
    elements.set('save-profile-btn', { innerHTML: 'เสร็จสิ้น' });
    sandbox.showSuccessModal = title => successes.push(title);
    sandbox.supabaseClient.from = table => {
        assert.equal(table, 'profiles');
        return {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { major: 'Fixture' } }) }) }),
            update: () => ({ eq: (field, key) => {
                assert.equal(field, 'student_id');
                assert.equal(key, studentId);
                return { select: () => ({ maybeSingle: async () => ({ data: saved }) }) };
            } })
        };
    };
    load('js/profile-session.js', 'js/initialization.js');
    await sandbox.checkUserSession();
    await sandbox.fetchStudentProfileOnLogin();
    await sandbox.saveProfile();
    assert.equal(alerts.length, 1);
    assert.deepEqual(successes, []);

    saved = { student_id: studentId };
    await sandbox.saveProfile();
    assert.deepEqual(successes, ['สำเร็จ!']);
});

test('viewing a friend uses only the directory and clears private fields from the form', async () => {
    const { sandbox, elements, load } = browser({
        getUser: async () => ({ data: { user } }),
        onAuthStateChange() {}
    });
    const calls = [];
    const name = '<em>Fixture friend</em>';
    elements.set('profile', { style: {}, classList: { add() {} }, querySelectorAll: () => [] });
    for (const id of ['profile-fullname', 'profile-age', 'profile-year-level', 'display-profile-name',
        'display-student-id', 'save-profile-btn', 'profile-load-message']) {
        elements.set(id, { style: {} });
    }
    sandbox.supabaseClient.from = table => ({ select: fields => ({ eq: (_, key) => ({ maybeSingle: async () => {
        calls.push([table, fields, key]);
        return { data: table === 'profiles'
            ? { first_name: 'Own fixture', age: '21', major: 'Own major' }
            : { first_name: name, age: 'not in the public projection', major: 'Private major' } };
    } }) }) });
    load('js/profile-session.js', 'js/initialization.js', 'js/community-members.js');
    await sandbox.checkUserSession();
    await sandbox.fetchStudentProfileOnLogin();
    assert.equal(elements.get('profile-age').value, '21');

    const friendId = 'B6812345';
    await sandbox.viewFriendProfile(friendId);
    assert.deepEqual(calls.at(-1), ['profile_directory', 'first_name,last_name', friendId]);
    assert.equal(elements.get('display-profile-name').textContent, name);
    assert.equal(elements.get('profile-age').value, '');
    assert.equal(elements.get('profile-year-level').value, '');
    assert.equal(sandbox.aiAcademicProfile.major, 'Own major');

    sandbox.restoreMyProfile();
    await sandbox.aiProfileReady;
    assert.equal(elements.get('profile-age').value, '21');
    assert.equal(elements.get('profile-year-level').readOnly, true);
});

test('protected startup waits for Supabase before loading the current profile and schedule', async () => {
    let finish;
    const { sandbox, storage, navigation, load, ready } = browser({
        getUser: () => new Promise(resolve => { finish = resolve; }),
        onAuthStateChange() {}
    });
    const calls = [];
    sandbox.supabaseClient.from = table => {
        assert.equal(table, 'profiles');
        return { select: () => ({ eq: (field, id) => {
            calls.push(['profile', field, id]);
            return { maybeSingle: async () => ({ data: { first_name: 'Fixture', major: 'Fixture major' } }) };
        } }) };
    };
    sandbox.initReviewSystem = () => {};
    sandbox.fetchCourses = async () => {};
    sandbox.loadSchedule = () => calls.push(['schedule', storage.get('sut_student_id')]);
    load('js/profile-session.js', 'js/initialization.js', 'js/page-events.js');
    const boot = ready();
    assert.equal(sandbox.document.body.inert, true);
    assert.deepEqual(calls, []);
    finish({ data: { user } });
    await boot;
    await sandbox.aiProfileReady;
    assert.deepEqual(calls, [['profile', 'student_id', studentId], ['schedule', studentId]]);
    assert.equal(sandbox.document.body.inert, false);
    assert.deepEqual(navigation, []);
});

test('a legacy student ID cannot open the protected page without Supabase Auth', async () => {
    const { sandbox, storage, navigation, load } = browser({ getUser: async () => ({ data: { user: null } }) });
    load('js/profile-session.js');
    assert.equal(await sandbox.checkUserSession(), false);
    assert.equal(storage.has('sut_student_id'), false);
    assert.deepEqual(navigation, ['auth.html']);
});

test('logout ends only the current Supabase session and clears the local student marker', async () => {
    const scopes = [];
    let change;
    const { sandbox, elements, storage, navigation, load, ready } = browser({
        getUser: async () => ({ data: { user } }),
        onAuthStateChange: handler => { change = handler; },
        async signOut({ scope }) {
            scopes.push(scope);
            change('SIGNED_OUT', null);
            return { error: null };
        }
    });
    let click;
    let confirmLogout;
    sandbox.confirmAppAction = () => new Promise(resolve => { confirmLogout = resolve; });
    elements.set('logout-btn', { addEventListener: (_, handler) => { click = handler; } });
    load('js/profile-session.js', 'js/community-core.js', 'js/logout.js');
    await sandbox.checkUserSession();
    await ready();
    const pending = click({ preventDefault() {} });
    assert.deepEqual(scopes, []);
    confirmLogout(true);
    await pending;
    assert.deepEqual(scopes, ['local']);
    assert.equal(storage.has('sut_student_id'), false);
    assert.deepEqual(navigation, ['auth.html']);
});

test('logout retries only when Supabase kept the local session after an error', async () => {
    let session = { user };
    const { sandbox, storage, navigation, alerts, load } = browser({
        getUser: async () => ({ data: { user } }),
        onAuthStateChange() {},
        signOut: async () => ({ error: new Error('fixture network error') }),
        getSession: async () => ({ data: { session } })
    });
    load('js/profile-session.js', 'js/logout.js');
    await sandbox.checkUserSession();
    await sandbox.executeLogout();
    assert.equal(storage.get('sut_student_id'), studentId);
    assert.deepEqual(navigation, []);
    assert.equal(alerts.length, 1);
    session = null;
    await sandbox.executeLogout();
    assert.equal(storage.has('sut_student_id'), false);
    assert.deepEqual(navigation, ['auth.html']);
    assert.equal(alerts.length, 1);
});

test('a different Supabase account invalidates the open student page', async () => {
    let change;
    const { sandbox, storage, navigation, load } = browser({
        getUser: async () => ({ data: { user } }),
        onAuthStateChange: handler => { change = handler; }
    });
    load('js/profile-session.js');
    await sandbox.checkUserSession();
    sandbox.document.body.inert = false;
    change('SIGNED_IN', { user: { id: 'fixture-auth-2', app_metadata: { student_id: 'B6812345' } } });
    assert.equal(sandbox.document.body.inert, true);
    assert.equal(storage.has('sut_student_id'), false);
    assert.deepEqual(navigation, ['index.html']);
});
