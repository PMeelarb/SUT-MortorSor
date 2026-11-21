// Automatic planning uses only verified offerings and the same confirmation
// and fresh Oracle validation as AI Chat.
const AUTO_PLAN_STATUS_TEXT = {
    not_offered: 'ไม่เปิดสอนในปีการศึกษาและภาคเรียนนี้',
    incomplete: 'มีกลุ่มเรียนแต่ข้อมูลวันหรือเวลายังไม่ครบ',
    unpublished: 'ไม่มีข้อมูลเวลาเรียนที่ตรวจสอบได้'
};

// Shared by the timetable button and the AI Chat plan button. Returns true only
// when verified courses were added and saved; throws on retrieval errors.
window.autoScheduleForContext = async function(context, source = window.getPlanSource?.(), { excludeDays = [] } = {}) {
    const snapshot = JSON.stringify(context);
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries({ ...context, ...(source || {}) })) {
        if (value !== null && value !== undefined && value !== '') query.set(name, value);
    }
    const response = await fetch(`${window.aiChatConfig.apiBaseUrl.replace(/\/$/, '')}/api/recommend?${query}`);
    const result = await response.json();
    if (!response.ok || result.status !== 'success') throw new Error(result.error || 'ค้นแผนการเรียนไม่สำเร็จ');
    if (snapshot !== JSON.stringify(window.getAIChatContext({ forSchedule: true }))) throw new Error('ชั้นปี เทอม หรือหลักสูตรเปลี่ยนไป กรุณาลองใหม่');
    if (!result.data?.length) {
        window.showAppNotice(result.unresolvedPlanRows > 0
            ? `แผนการเรียนมี ${result.unresolvedPlanRows} รายการที่ยืนยันรหัสวิชาไม่ได้ จึงยังจัดตารางให้ไม่ได้`
            : 'ไม่พบแผนการเรียนที่ตรงกับบริบทใน Oracle กรุณาตรวจสำนักวิชา สาขา ปีหลักสูตร ชั้นปี และภาคเรียน');
        return false;
    }
    const working = selectedCoursesData.map(course => ({ ...course }));
    const actions = [];
    const skipped = [];
    for (const course of result.data) {
        const code = normalizeCourseCodeKey(course.COURSECODE);
        if (working.some(item => normalizeCourseCodeKey(item.courseCode || item.code.split(' (G.')[0]) === code)) continue;
        const usable = result.offerings.filter(group => group.courseCode === code && group.actionable);
        const groups = usable.filter(group => !group.meetings.some(meeting => excludeDays.includes(meeting.day)));
        if (usable.length && !groups.length) skipped.push(`${code} — ทุกกลุ่มมีเรียนวันที่ต้องการเว้น (${excludeDays.join(', ')})`);
        let chosen = false;
        for (const group of groups) {
            try {
                const rows = prepareAICourseRows([group], working, context);
                working.push(...rows);
                actions.push({ courseCode: code, classId: group.classId, section: group.section });
                chosen = true;
                break;
            } catch (error) {
                // Retain the reason. A different real group may fit.
                skipped.push(`${code} กลุ่ม ${group.section} — ${error.message}`);
            }
        }
        if (!chosen && !usable.length) {
            const other = result.alternativeTerms?.[code];
            skipped.push(`${code} — ${AUTO_PLAN_STATUS_TEXT[result.courseStatus?.[code]] || 'ยังไม่พบกลุ่มที่มีวัน เวลา และหน่วยกิตครบ'}`
                + (other ? ` (มีเวลาเรียนล่าสุดปี ${other.academicYear} เทอม ${other.semester} เลือกเป็นแหล่งเวลาเองได้)` : ''));
        }
    }
    if (!actions.length) {
        window.showAppNotice(skipped.join('\n') || 'วิชาตามแผนที่เพิ่มได้มีอยู่ในตารางแล้ว');
        return false;
    }
    const added = await window.applyAICoursesList(actions, context, source);
    if (!added) return false;
    // "Added" is reported only once the timetable was really saved.
    const saved = await window.saveSchedule();
    if (skipped.length) window.showAppNotice('ข้อจำกัดระหว่างจัดตาราง\n' + skipped.join('\n'));
    return saved !== false;
};

window.handleAutoRecommend = async function() {
    const button = document.getElementById('auto-plan-btn');
    if (!button || button.disabled) return;
    const originalText = button.innerHTML;
    button.disabled = true;
    button.textContent = 'กำลังค้นแผนการเรียนและกลุ่มเปิดสอน…';
    try {
        await window.autoScheduleForContext(window.getAIChatContext({ forSchedule: true }));
    } catch (error) {
        window.showAppNotice(error.message);
    } finally {
        button.innerHTML = originalText;
        button.disabled = false;
    }
};
