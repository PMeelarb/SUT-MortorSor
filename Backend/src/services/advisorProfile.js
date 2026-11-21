// Supabase Auth supplies the account UID or a verified link to a legacy student ID.
// Only the fields used by the advisor are read from the matching profile.
function studyYear(studentId, now) {
    if (typeof studentId !== 'string') return null;
    const admitted = /^[A-Z](\d{2})\d{5}$/.exec(studentId)?.[1];
    if (!admitted) return null;
    const year = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Bangkok' }).format(now));
    const level = year + 543 - (2500 + Number(admitted)) + 1;
    return level >= 1 && level <= 20 ? level : null;
}

function identityFromAuthUser(user) {
    if (!user?.id || user.is_anonymous) return null;
    const linked = user.app_metadata?.student_id;
    if (typeof linked === 'string' && /^[A-Z0-9-]{1,32}$/.test(linked)) {
        return { studentId: linked, yearSource: linked };
    }
    if (typeof user.id !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(user.id)) return null;
    return {
        studentId: 'U-' + user.id.replace(/-/g, '').toUpperCase(),
        yearSource: user.user_metadata?.student_profile?.reported_student_id || ''
    };
}

function validateSupabaseConfig(url, publicKey) {
    let origin;
    try {
        origin = new URL(url?.trim());
    } catch {
        return { error: 'SUPABASE_URL_INVALID' };
    }
    if (origin.protocol !== 'https:' || origin.username || origin.password
        || origin.pathname !== '/' || origin.search || origin.hash) {
        return { error: 'SUPABASE_URL_INVALID' };
    }

    const key = typeof publicKey === 'string' ? publicKey.trim() : '';
    if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return { origin, key };
    const legacyPayload = /^[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/.exec(key)?.[1];
    if (legacyPayload) {
        try {
            const claims = JSON.parse(Buffer.from(legacyPayload, 'base64url').toString('utf8'));
            const projectRef = /^([a-z0-9]+)\.supabase\.co$/.exec(origin.hostname)?.[1];
            // This validates configuration shape. Supabase verifies credentials on the request.
            if (claims?.role === 'anon' && (!projectRef || !claims.ref || claims.ref === projectRef)) {
                return { origin, key };
            }
        } catch {
            return { error: 'SUPABASE_PUBLISHABLE_KEY_INVALID' };
        }
    }
    return { error: 'SUPABASE_PUBLISHABLE_KEY_INVALID' };
}

function createAdvisorProfileReader({ url, publicKey, fetcher = fetch, now = () => new Date(), onConfigError }) {
    const config = validateSupabaseConfig(url, publicKey);
    if (config.error) onConfigError?.(config.error);
    return async function readProfile(authorization) {
        const token = /^Bearer ([A-Za-z0-9._-]{1,8192})$/i.exec(authorization || '')?.[1];
        if (!token) return { status: 'sign_in_required' };
        if (config.error) return { status: 'configuration_error' };
        const headers = { apikey: config.key, Authorization: `Bearer ${token}` };
        try {
            const signal = AbortSignal.timeout(5000);
            const request = path => fetcher(new URL(path, config.origin), {
                headers, signal, redirect: 'error', cache: 'no-store'
            });
            const auth = await request('/auth/v1/user');
            if ([401, 403].includes(auth.status)) {
                const error = await auth.json?.().catch(() => null);
                if (error?.message === 'Invalid API key' || error?.code === 'UNAUTHORIZED_INVALID_API_KEY') {
                    return { status: 'configuration_error' };
                }
                return { status: 'sign_in_required' };
            }
            if (!auth.ok) return { status: 'database_unavailable' };
            const user = await auth.json();
            if (user?.is_anonymous || !user?.id) return { status: 'sign_in_required' };
            const identity = identityFromAuthUser(user);
            if (!identity) return { status: 'profile_not_found' };
            const query = new URLSearchParams({
                select: 'first_name,last_name,faculty,major,free_time,learning_style', student_id: `eq.${identity.studentId}`, limit: '2'
            });
            const result = await request(`/rest/v1/profiles?${query}`);
            if (!result.ok) return { status: 'database_unavailable' };
            const rows = await result.json();
            if (Array.isArray(rows) && rows.length === 0) return { status: 'profile_not_found' };
            if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object'
                || Array.isArray(rows[0])) return { status: 'database_unavailable' };
            const row = rows[0];
            const text = value => typeof value === 'string' ? value.trim().slice(0, 300) : '';
            const level = Number(user.app_metadata?.year_level);
            const curriculum = Number(user.app_metadata?.curriculum_year);
            return { status: 'verified', userId: user.id, profile: {
                firstName: text(row.first_name), lastName: text(row.last_name), faculty: text(row.faculty), major: text(row.major),
                freeTime: text(row.free_time), learningStyle: text(row.learning_style),
                yearLevel: Number.isInteger(level) && level >= 1 && level <= 20 ? level : studyYear(identity.yearSource, now()),
                curriculumYear: Number.isInteger(curriculum) && curriculum >= 1900 && curriculum <= 3000 ? curriculum : null
            } };
        } catch {
            return { status: 'database_unavailable' };
        }
    };
}

function profileWelcome(profile, english = false) {
    const prefix = english ? `Hello${profile.firstName ? `, ${profile.firstName}` : ''}.`
        : `สวัสดีครับ${profile.firstName ? ` คุณ${profile.firstName}` : ''}`;
    if (english) {
        const details = [profile.yearLevel ? `year ${profile.yearLevel}` : '', profile.major, profile.faculty].filter(Boolean);
        return [prefix, details.length ? `Your profile shows ${details.join(', ')}.` : '', 'How can I help with your studies?'].filter(Boolean).join(' ');
    }
    const study = [profile.yearLevel ? `อยู่ชั้นปีที่ ${profile.yearLevel}` : '',
        profile.major ? `เรียน${/^สาขา/.test(profile.major) ? '' : 'สาขา'}${profile.major}` : '', profile.faculty].filter(Boolean);
    return `${prefix} ${study.length ? `จากโปรไฟล์ คุณ${study.join(' ')}ครับ ` : ''}วันนี้อยากให้ช่วยวางแผนเรื่องไหนครับ`;
}

function profileAccessMessage(status, english = false) {
    const messages = {
        configuration_error: ['AI Advisor ยังตั้งค่าการเชื่อมต่อ Supabase ไม่สมบูรณ์ครับ', 'The advisor’s Supabase configuration is incomplete or invalid.'],
        profile_not_found: ['AI Advisor ยังไม่พบโปรไฟล์ของบัญชีนี้ใน Supabase ครับ', 'No profile was found for this account in Supabase.'],
        database_unavailable: ['ตอนนี้ AI Advisor อ่านโปรไฟล์จาก Supabase ไม่สำเร็จ กรุณาลองอีกครั้งครับ', 'The advisor could not read your profile from Supabase. Please try again.']
    };
    return (messages[status] || ['เข้าสู่ระบบเพื่อให้แชตใช้ข้อมูลโปรไฟล์และค้นแผนการเรียนของคุณจาก Oracle ครับ', 'Sign in to use your profile and find your study plan in Oracle.'])[english ? 1 : 0];
}

module.exports = { createAdvisorProfileReader, profileWelcome, profileAccessMessage };
