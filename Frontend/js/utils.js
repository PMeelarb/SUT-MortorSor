// ==========================================
// 🔧 ตัวช่วย Normalize ข้อมูลจาก API / Database
// ==========================================
const firstValue = (obj, keys, fallback = '') => {
    for (const key of keys) {
        if (obj && obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== '') {
            return obj[key];
        }
    }
    return fallback;
};

const normalizeCourseCodeKey = (value) => String(value ?? '').replace(/\s+/g, '').toUpperCase();

const normalizeDayName = (value) => {
    if (value === undefined || value === null) return '-';
    const raw = String(value).trim();
    if (!raw || raw === '-') return '-';

    const key = raw.toUpperCase().replace(/\./g, '');
    const dayMap = {
        'MON': 'จันทร์', 'MONDAY': 'จันทร์', '1': 'จันทร์',
        'TUE': 'อังคาร', 'TUES': 'อังคาร', 'TUESDAY': 'อังคาร', '2': 'อังคาร',
        'WED': 'พุธ', 'WEDNESDAY': 'พุธ', '3': 'พุธ',
        'THU': 'พฤหัสบดี', 'THUR': 'พฤหัสบดี', 'THURS': 'พฤหัสบดี', 'THURSDAY': 'พฤหัสบดี', '4': 'พฤหัสบดี',
        'FRI': 'ศุกร์', 'FRIDAY': 'ศุกร์', '5': 'ศุกร์',
        'SAT': 'เสาร์', 'SATURDAY': 'เสาร์', '6': 'เสาร์',
        'SUN': 'อาทิตย์', 'SUNDAY': 'อาทิตย์', '7': 'อาทิตย์'
    };
    return dayMap[key] || raw;
};

const normalizeTime = (value) => {
    if (value === undefined || value === null) return '';
    let raw = String(value).trim();
    if (!raw || raw === '-') return '';
    const isoMatch = raw.match(/T(\d{1,2}):(\d{2})/);
    if (isoMatch) return `${isoMatch[1].padStart(2, '0')}:${isoMatch[2]}`;
    const colonMatch = raw.match(/^(\d{1,2})[:.](\d{2})/);
    if (colonMatch) return `${colonMatch[1].padStart(2, '0')}:${colonMatch[2]}`;
    if (/^\d{3,4}$/.test(raw)) return `${raw.padStart(4, '0')}${raw.slice(0, 2)}:${raw.slice(2, 4)}`;
    if (/^\d{1,2}$/.test(raw)) return `${raw.padStart(2, '0')}:00`;
    return raw;
};

const getCourseCode = (c) => String(firstValue(c, ['COURSECODE', 'COURSE_CODE', 'coursecode'], '')).trim();
const getCourseName = (c) => String(firstValue(c, ['COURSENAME', 'COURSE_NAME', 'coursename'], '')).trim();
const getCourseNameEng = (c) => String(firstValue(c, ['COURSENAME_ENG', 'COURSE_NAME_ENG'], '')).trim();
const getDay = (c) => normalizeDayName(firstValue(c, ['DAY_NAME', 'DAYNAME', 'WEEKDAY'], '-'));
const getStart = (c) => normalizeTime(firstValue(c, ['START_TIME', 'STARTTIME', 'TIMEFROM'], ''));
const getEnd = (c) => normalizeTime(firstValue(c, ['END_TIME', 'ENDTIME', 'TIMETO'], ''));
const getCredit = (c) => firstValue(c, ['COURSEUNIT', 'COURSE_UNIT', 'CREDIT', 'courseunit'], '0');
const getSection = (c) => String(firstValue(c, ['SECTION', 'SECTION_NO', 'SECTIONNO', 'SEC', 'GROUP_NO'], '1')).trim();
const getMidDate = (c) => firstValue(c, ['MID_DATE', 'mid_date', 'MIDDATE'], '');
const getMidStart = (c) => normalizeTime(firstValue(c, ['MID_START', 'mid_start'], ''));
const getMidEnd = (c) => normalizeTime(firstValue(c, ['MID_END', 'mid_end'], ''));
const getFinDate = (c) => firstValue(c, ['FIN_DATE', 'fin_date', 'FINDATE'], '');
const getFinStart = (c) => normalizeTime(firstValue(c, ['FIN_START', 'fin_start'], ''));
const getFinEnd = (c) => normalizeTime(firstValue(c, ['FIN_END', 'fin_end'], ''));

function normalizeCourseRow(row = {}) {
    return {
        ...row,
        COURSECODE: getCourseCode(row), COURSENAME: getCourseName(row), COURSENAME_ENG: getCourseNameEng(row),
        COURSEUNIT: getCredit(row), SECTION: getSection(row), DAY_NAME: getDay(row), START_TIME: getStart(row), END_TIME: getEnd(row),
        MID_DATE: getMidDate(row), MID_START: getMidStart(row), MID_END: getMidEnd(row), FIN_DATE: getFinDate(row), FIN_START: getFinStart(row), FIN_END: getFinEnd(row)
    };
}

function extractRows(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];
    const preferredKeys = ['data', 'rows', 'results', 'items', 'timetable', 'schedules', 'courses'];
    for (const key of preferredKeys) {
        if (Array.isArray(payload[key])) return payload[key];
        if (payload[key] && typeof payload[key] === 'object') {
            const nested = extractRows(payload[key]);
            if (nested.length) return nested;
        }
    }
    return [];
}

function showSuccessModal(title, desc) {
    document.getElementById('success-alert-title').innerText = title;
    document.getElementById('success-alert-desc').innerText = desc;
    document.getElementById('modal-success-alert').style.display = 'flex';
}
