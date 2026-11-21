// ==========================================
// AI requests use their own context and never use the legacy course cache
// as evidence for an enrollment action.
async function getAdvisorAccessToken() {
    if (typeof supabaseClient === 'undefined' || !supabaseClient.auth?.getSession) return null;
    const verified = typeof verifiedStudentSession === 'undefined' ? null : verifiedStudentSession;
    let result;
    try {
        result = await supabaseClient.auth.getSession();
    } catch {
        // Chat can continue without profile access if the session service is temporarily unavailable.
    }
    const session = result?.data?.session;
    if (verified && (verifiedStudentSession?.userId !== verified.userId
        || (!result?.error && result?.data && session?.user?.id !== verified.userId))) {
        throw new Error('บัญชีเปลี่ยนระหว่างเรียก AI กรุณาลองใหม่');
    }
    return !verified || result?.error ? null : session?.access_token || null;
}

async function requestAIEndpoint(path, payload, token) {
    let response;
    try {
        const url = new URL(`${window.aiChatConfig.apiBaseUrl.replace(/\/$/, '')}${path}`);
        const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if (token && ((!localHttp && url.protocol !== 'https:') || url.username || url.password)) {
            throw new Error('Advisor authentication requires HTTPS');
        }
        response = await fetch(url.href, {
            method: payload === undefined ? 'GET' : 'POST',
            headers: {
                ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
            signal: AbortSignal.timeout(30000),
            redirect: 'error',
            cache: 'no-store'
        });
    } catch {
        throw new Error('เชื่อมต่อระบบ AI ไม่สำเร็จ กรุณาลองใหม่');
    }
    let result;
    try {
        result = await response.json();
    } catch {
        throw new Error('ระบบ AI ส่งข้อมูลกลับมาไม่สมบูรณ์ กรุณาลองใหม่');
    }
    if (!response.ok || result?.status !== 'success') {
        throw new Error(typeof result?.error === 'string' ? result.error : 'ไม่สามารถยืนยันข้อมูลจากระบบ AI ได้');
    }
    return result;
}

window.requestAIChat = async payload => requestAIEndpoint('/api/aichat', payload, await getAdvisorAccessToken());
window.requestAIProfile = async () => requestAIEndpoint('/api/ai/profile', undefined, await getAdvisorAccessToken());
window.validateAICourses = payload => requestAIEndpoint('/api/ai/courses/validate', payload);

// 2. ฟังก์ชันดึงข้อมูลวิชาหลัก (แยกระบบป้องกันบั๊กชนกัน)
// ==========================================
async function fetchCourses() {
    await Promise.all([fetchLegacyTimetable(), fetchMasterCourses()]);
}

// ส่วนที่ 1: ดึงข้อมูลตารางเรียน (ถ้าดึงไม่ได้ ให้ข้ามไปเลย ห้ามพาเว็บพัง)
async function fetchLegacyTimetable() {
    // Legacy exam lookup cache for rows added before section validation. The
    // academic year is the planner's selection, never a hardcoded year.
    const academicYear = window.planTerm?.academicYear;
    const semester = currentSemester;
    const isActive = () => academicYear === window.planTerm?.academicYear && semester === currentSemester;
    if (!academicYear) {
        allCourses = [];
        return;
    }
    try {
        const timetableUrl = `${window.aiChatConfig.apiBaseUrl.replace(/\/$/, '')}/api/timetable?acadyear=${encodeURIComponent(academicYear)}&semester=${encodeURIComponent(semester)}`;
        const response = await fetch(timetableUrl, { headers: { 'ngrok-skip-browser-warning': 'true' } });
        if (response.ok) {
            const result = await response.json();
            if (isActive()) allCourses = extractRows(result).map(normalizeCourseRow).filter(c => c.COURSECODE);
        } else {
            if (isActive()) allCourses = [];
        }
    } catch (error) {
        console.warn('⚠️ ข้ามการดึงตารางเรียนส่วนแรก:', error.message);
        if (isActive()) allCourses = [];
    }
}
globalThis.document?.addEventListener('planterm:change', () => {
    fetchLegacyTimetable().then(() => {
        if (typeof updateSelectedCoursesCart === 'function') updateSelectedCoursesCart();
    });
});

// Share catalog names across initialization and reviews. Section selection reads fresh evidence.
let masterCourseRequest;
function getMasterCourseRows() {
    masterCourseRequest ||= (async () => {
        const response = await fetch(`${window.aiChatConfig.apiBaseUrl.replace(/\/$/, '')}/api/courses`);
        const result = await response.json();
        if (!response.ok || result.status !== 'success') throw new Error('โหลดรายชื่อวิชาไม่สำเร็จ');
        masterCourses = extractRows(result).map(normalizeCourseRow).filter(course => course.COURSECODE);
        return masterCourses;
    })().catch(error => {
        masterCourseRequest = undefined;
        throw error;
    });
    return masterCourseRequest;
}

async function fetchMasterCourses() {
    try {
        await getMasterCourseRows();
    } catch (error) {
        console.error('ดึงรายวิชาเข้าช่องค้นหาไม่สำเร็จ:', error.message);
    }
}
