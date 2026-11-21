// Shared validation for retrieved Oracle facts and AI course actions.
const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];

class AdvisorError extends Error {
    constructor(code, message, status = 422) {
        super(message);
        this.code = code;
        this.status = status;
    }
}

function courseKey(value) {
    return String(value ?? '').replace(/\s+/g, '').toUpperCase();
}

function dayName(value) {
    const text = String(value ?? '').trim().replace(/^วัน/, '');
    const english = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    if (DAYS.includes(text)) return text;
    if (text === 'พฤหัส') return 'พฤหัสบดี';
    const index = english.indexOf(text.toUpperCase());
    return index < 0 ? null : DAYS[index];
}

function timeMinutes(value) {
    const match = /^(\d{1,2}):(\d{2})(?::00)?$/.exec(String(value ?? '').trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0)) return null;
    return hours * 60 + minutes;
}

function creditValue(value) {
    // Oracle may store COURSEUNIT as either NUMBER or text such as 3(3-0-6).
    const match = /^(\d+(?:\.\d+)?)(?:\s*\([^)]*\))?$/.exec(String(value ?? '').trim());
    return match ? Number(match[1]) : null;
}

function clockTime(value) {
    const minutes = timeMinutes(value);
    if (minutes === null) return null;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function completeOffering(course) {
    return Boolean(course.classId && course.section && course.courseCode && course.courseName)
        && creditValue(course.credits) !== null
        && Array.isArray(course.meetings) && course.meetings.length > 0
        && course.meetings.every(meeting => {
            const start = timeMinutes(meeting.start);
            const end = timeMinutes(meeting.end);
            return DAYS.includes(meeting.day) && start !== null && end !== null && start < end;
        });
}

module.exports = { AdvisorError, courseKey, dayName, timeMinutes, clockTime, creditValue, completeOffering };
