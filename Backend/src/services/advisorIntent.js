const { dayName } = require('./academicData');

const COURSE_CODE = /(?:^|[^a-zA-Z0-9])([a-zA-Z]{2,8}-?\d{3,8}|[A-Z]{2,8} \d{3,8}|\d{6,8})(?![a-zA-Z0-9])/;
const DAY = /(?:วัน)?(จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์|อาทิตย์)|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
// Course categories come from the program structure (EXP_PROGRAMSTRUCTURE headings).
const GEN_ED = /(?:^|[^a-z0-9])(?:g[\s.]*e|gen\s*-?\s*ed)(?![a-z0-9])|ศึกษาทั่วไป|เจ\s*อี|จี\s*อี|\bgeneral education\b/i;
const FREE_ELECTIVE = /เสรี|\bfree electives?\b/i;
const STRUCTURE_ONLY = /โครงสร้าง|กี่หน่วยกิต|หน่วยกิตรวม|\bhow many credits\b/i;
const DAY_WORDS = [['จันทร์', /จันทร์|\bmon(?:day)?\b/i], ['อังคาร', /อังคาร|\btue(?:sday)?\b/i], ['พุธ', /พุธ|\bwed(?:nesday)?\b/i],
    ['พฤหัสบดี', /พฤหัส|\bthu(?:rsday)?\b/i], ['ศุกร์', /ศุกร์|\bfri(?:day)?\b/i], ['เสาร์', /เสาร์|\bsat(?:urday)?\b/i],
    ['อาทิตย์', /อาทิตย์|\bsun(?:day)?\b/i]];

function courseCategory(message) {
    const normalized = message.normalize('NFKC');
    const ge = GEN_ED.test(normalized), free = FREE_ELECTIVE.test(normalized);
    if (ge && free) return null;
    if (ge) return 'genEd';
    if (free) return 'free';
    return null;
}

// Every weekday named in the message ("พุธ พฤหัส ศุกร์"), in week order.
function mentionedDays(message) {
    return DAY_WORDS.filter(([, pattern]) => pattern.test(message)).map(([day]) => day);
}

// "IST201510 เรียนเกี่ยวกับอะไร": the student wants the course description.
const DESCRIBE = /เกี่ยวกับอะไร|เรียนเกี่ยวกับ|สอนอะไร|สอนเกี่ยวกับ|เนื้อหา|คำอธิบาย|คืออะไร|\bsyllabus\b|\bdescription\b|\bwhat is\b.{0,40}\babout\b/i;
// "ขอดูเพิ่ม", "อีก", "ถัดไป": next page of the last category list.
const MORE = /^(?:ขอ)?(?:ดู)?(?:เพิ่ม(?:เติม)?|อีก|ต่อ|ถัดไป|หน้าถัดไป)(?:$|\s|ครับ|ค่ะ|คะ|หน่อย|นะ|อีก|บ้าง|ได้|ไหม)|^(?:show )?more\b|^next\b/i;
const MORE_COURSES = /(?:^|มี|ขอ|เอา|แนะนำ)(?:วิชา|ตัวเลือก)(?:อื่น(?:อีก)?|เพิ่มเติม|ที่ไม่ซ้ำ)|มี(?:วิชา|ตัวเลือก)?(?:อื่น)?อีก(?:มั้ย|ไหม|หรือเปล่า)|(?:นอกเหนือ|นอก)จาก(?:ที่แนะนำ|นี้|นี่)|(?:ขอ|เอา|แนะนำ)อีก|อีก\s*[0-9๐-๙]+\s*วิชา|ไม่เอาวิชาเดิม|ไม่ซ้ำ|(?:ขอ|เอา|แนะนำ).{0,24}(?:เพิ่มอีก|เพิ่มเติม)|\b(?:any others?|more courses|different courses)\b/i;
const NEXT_TERM = /เทอมหน้า|ภาคเรียนหน้า|\bnext (?:term|semester)\b/i;
const CATEGORY_CORRECTION = /^\s*(?:ไม่ใช่|หมายถึง|ขอเปลี่ยนเป็น|เปลี่ยนเป็น|I meant)\b|^\s*(?:ไม่ใช่|หมายถึง|ขอเปลี่ยนเป็น|เปลี่ยนเป็น)/i;

function moreCourseCount(message) {
    const count = /(?:อีก|more)\s*([0-9๐-๙]{1,3})\s*(?:วิชา|courses?)/i.exec(message)?.[1];
    const value = Number(count?.replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - '๐'.charCodeAt(0))));
    return Number.isInteger(value) && value > 0 ? Math.min(value, 30) : null;
}
const PERIODS = [['morning', /เช้า|\bmorning\b/i], ['afternoon', /บ่าย|\bafternoon\b/i], ['evening', /เย็น|ค่ำ|\bevening\b/i]];
const NO_MORNING = /ไม่(?:อยาก|ต้องการ|เอา)?(?:มี)?(?:เรียน|ลง)?\s*(?:ช่วงเช้า|เช้า|ก่อนเที่ยง)|เลี่ยง(?:เรียน|ช่วง)?เช้า|\b(?:no|avoid) morning/i;
const CLEAR_MORNING = /(?:เรียน)?เช้า(?:ได้|ก็ได้)|\bmornings? (?:are )?(?:ok|fine)\b/i;
const KEEP_DAY_FREE = /(?:(?<!เวลา)ว่าง|เว้น|ไม่(?:อยาก|เอา|ต้องการ|มี)?(?:มี)?(?:เรียน|ลง))\s*(?:วัน)?(?:จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์)|\b(?:free on|no classes on)\s+/i;
const ALL_DETAILS = /(?:ดู|ขอ|แสดง).{0,16}(?:ทั้งหมด|ทุกรายวิชา|ทุกกลุ่ม)|\b(?:all sections|full details|all courses)\b/i;
const KEYWORD_STOP = /ที่|วัน|เทอม|ภาคเรียน|ใน|ช่วง|ครับ|ค่ะ|คะ|หน่อย|บ้าง|ไหม|ให้|และ|หรือ|เปิด|\d/;

// Optional narrowing for GE / free-elective lists: time of day, credits, a word in the course name.
function categoryFilters(message) {
    const period = NO_MORNING.test(message) ? null : PERIODS.find(([, pattern]) => pattern.test(message))?.[0] ?? null;
    const credits = Number(/(\d{1,2})\s*(?:หน่วยกิต|credits?\b)/i.exec(message)?.[1]) || null;
    const raw = /เกี่ยวกับ(?:การ|ด้าน)?\s*([ก-๙A-Za-z][ก-๙A-Za-z ]{0,40})/.exec(message)?.[1] || '';
    const keyword = raw.split(KEYWORD_STOP)[0].trim();
    return { period, credits, keyword: keyword.length >= 2 && !/^อะไร/.test(keyword) ? keyword : null };
}

const hasFilter = filters => Boolean(filters.period || filters.credits || filters.keyword);
const FOLLOW_UP = /^(?:แล้ว|งั้น|ต่อจาก|อันนั้น|วิชานี้|วิชานั้น|วิชาพวกนี้|กลุ่มนี้|what about|and\b|how about|those\b|that course|it\b)/i;
const CLARIFICATION = /^(?:ปี(?:หลักสูตร|การศึกษา)?\s*\d|ชั้นปี|เทอม\s*\d|ภาคเรียน\s*\d|สำนักวิชา|สาขา|(?:academic|curriculum) year\b|year\s*\d|semester\s*\d|term\s*\d|faculty\s*:|major\s*:)/i;
const ADD_TO_SCHEDULE = /(?:เพิ่ม(?:วิชา|ลงตาราง)|จัด(?:วิชา|ลง|ตาราง)|ลงตาราง|add\b.{0,50}\b(?:class|course|schedule|timetable)|build\b.{0,20}\b(?:schedule|timetable))/i;
const STRUCTURE = /ชุดวิชา|วิชาเลือก|โครงสร้างหลักสูตร|หมวดวิชา|หน่วยกิตรวม|เรียนกี่หน่วยกิต|\belectives?\b|\bcurriculum structure\b|\bmodules?\b/i;
const THAI_NUMBER_WORDS = ['หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า', 'สิบ',
    'สิบเอ็ด', 'สิบสอง', 'สิบสาม', 'สิบสี่', 'สิบห้า', 'สิบหก', 'สิบเจ็ด', 'สิบแปด', 'สิบเก้า', 'ยี่สิบ'];
const NUMBER_WORD = [...THAI_NUMBER_WORDS].reverse().join('|');
const YEAR_LEVEL = new RegExp(`(?:ชั้นปี|ปี|\\byear(?: level)?\\s+)[\\s:：]*(?:ที่\\s*)?([0-9๐-๙]{1,2}(?![0-9๐-๙])|${NUMBER_WORD})`, 'i');
const SEMESTER = new RegExp(`(?:ภาคเรียน|เทอม|\\bsemester|\\bterm)[\\s:：]*(?:ที่\\s*)?([0-9๐-๙]+|${NUMBER_WORD})`, 'i');
const THAI_GREETING = '(?:สวัสดี|หวัดดี|ดีจ้า|ขอบคุณ|ขอบใจ)(?:\\s*(?:ครับ|ค่ะ|คะ|ฮะ|นะ|จ้า))*';
const GREETING = new RegExp(`^(?:(?:${THAI_GREETING}[\\s!?.…🙏😊]*)+|(?:hi|hello|hey|thanks|thank you)(?: there)?[\\s!?.…🙏😊]*)$`, 'iu');

function academicNumbers(message) {
    const number = value => {
        if (!value) return undefined;
        const word = THAI_NUMBER_WORDS.indexOf(value);
        return word >= 0 ? word + 1 : value.replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - '๐'.charCodeAt(0)));
    };
    return { yearLevel: number(YEAR_LEVEL.exec(message)?.[1]), semester: number(SEMESTER.exec(message)?.[1]) };
}

function isClarification(message) {
    return CLARIFICATION.test(message) || YEAR_LEVEL.exec(message)?.index === 0 || SEMESTER.exec(message)?.index === 0;
}

const PROFILE_FIELDS = {
    name: /ชื่อ(?:จริง)?(?:ว่า)?\s*อะไร|นามสกุล|\b(?:full name|name|surname)\b/i,
    faculty: /สำนักวิชา|\bfaculty\b/i,
    major: /สาขา|\bmajor\b/i,
    yearLevel: /ชั้นปี|(?:อยู่|เรียน)ปี(?:ที่)?\s*(?:ไหน|อะไร)|\byear level\b/i,
    curriculumYear: /ปีหลักสูตร|\bcurriculum year\b/i,
    freeTime: /(?:ช่วง)?เวลาว่าง|ว่างเมื่อไหร่|\b(?:availability|free time)\b/i,
    learningStyle: /สไตล์การเรียน|รูปแบบการเรียน|\blearning style\b/i
};

function requestedProfileFields(message) {
    return Object.keys(PROFILE_FIELDS).filter(field => PROFILE_FIELDS[field].test(message));
}

function courseSearch(message) {
    const code = message.match(COURSE_CODE)?.[1];
    if (code) return { code: code.replace(/ /g, '').toUpperCase() };
    const quoted = hasNamedCourse(message) ? message.match(/["“]([^"”]{2,120})["”]/)?.[1] : null;
    const name = quoted || message.match(/(?:ชื่อวิชา\s*[:：]?\s*|(?:ค้นหา|หาข้อมูล|ข้อมูล|รายละเอียด)\s*(?:ราย)?วิชา\s*|(?:course name\s*[:：]|(?:find|look up|search for) (?:the )?course)\s+)([^\n?？]{2,120})/i)?.[1]
        || message.match(/(?:^|\s)(?:วิชา|the course\s+)([^\n?？]{2,120}?)(?=\s*(?:เปิดสอน|เปิดไหม|(?:is )?offered\b|เรียนเกี่ยวกับ|เกี่ยวกับอะไร|สอนอะไร|คืออะไร))/i)?.[1];
    const term = name?.trim();
    return term && !/^(?:ไหน|อะไร|นี้|นั้น|เหล่านี้|บ้าง|this|that|which)$/i.test(term) ? { name: term } : null;
}

function hasNamedCourse(message) {
    return /(?:ราย)?วิชา\s*["“]|course\s*["“]|ชื่อวิชา|course name|(?:ค้นหา|หาข้อมูล|ข้อมูล|รายละเอียด)\s*(?:ราย)?วิชา|(?:find|look up|search for) (?:the )?course/i.test(message);
}

function classify(message) {
    if (GREETING.test(message)) return 'greeting';
    if (/(?:รู้จัก(?:ผม|ฉัน|เรา|หนู)|รู้ไหม.{0,20}(?:ผม|ฉัน)|(?:โปรไฟล์|ข้อมูลส่วนตัว)(?:ของ)?(?:ผม|ฉัน|เรา)?|\b(?:do you know me|who am i|my profile)\b)/i.test(message)) return 'user_profile';
    if (/วิชาบังคับก่อน|วิชาที่ต้อง(?:ผ่าน|เรียนก่อน)|ต้องผ่านวิชา|ต้องเรียน.+ก่อน|\bprerequisites?\b/i.test(message)) return 'prerequisite';
    // "วิชา GE วันพฤหัส", "วิชาเสรีที่เปิดเทอม 2": offered courses of one category.
    if (courseCategory(message) && !STRUCTURE_ONLY.test(message)) return 'category_offering';
    // "IST201510 เรียนเกี่ยวกับอะไร" is about one course, not a study plan.
    if (DESCRIBE.test(message) && courseSearch(message)) return 'course_information';
    if (ADD_TO_SCHEDULE.test(message) || /ตารางเรียน|เวลา(?:เรียน)?ชน|\bschedule recommendation\b|\btimetable\b/i.test(message)) return 'schedule';
    if (STRUCTURE.test(message)) return 'curriculum_structure';
    if (requestedProfileFields(message).length
        && /(?:ผม|ฉัน|เรา|หนู|\bmy\b|ชื่ออะไร|เรียนสาขาอะไร|อยู่ชั้นปีไหน)/i.test(message)
        && /(?:อะไร|ไหน|เท่าไหร่|เมื่อไหร่|กี่โมง|หรือเปล่า|ไหม|\bmy\b)/i.test(message)
        && !/แนะนำวิชา|แผน(?:การ)?เรียน|ต้องเรียน|เปิดสอน|\b(?:study plan|courses|offerings|sections)\b/i.test(message)) return 'user_profile';
    if (/เปิด(?:สอน|ให้ลง|เทอม|ปี|ไหม|วัน)|กลุ่ม(?:เรียน|ไหน|อะไร)|\b(?:offered|offering|sections?)\b|(?:วิชา|เรียน|class).{0,40}(?:เวลาไหน|กี่โมง|วันไหน|วันอะไร|วันจันทร์|วันอังคาร|วันพุธ|วันพฤหัสบดี|วันศุกร์|วันเสาร์|วันอาทิตย์)/i.test(message)) return 'course_offering';
    if (/แผน(?:การ)?เรียน|หลักสูตร|แนะนำวิชา|วิชาสาขา|วิชาบังคับ|ควร(?:ลง|เรียน)วิชา|ต้องเรียนอะไร|เรียน(?:อะไร|วิชาอะไร)บ้าง|ต้อง(?:ลง|เรียน)วิชา|\bstudy plan\b|\bcurriculum\b|\bwhat (?:courses|classes|should i take|do i need to take)\b/i.test(message)) return 'study_plan';
    if (COURSE_CODE.test(message) || hasNamedCourse(message)
        || /รหัสวิชา|หน่วยกิต|\bcourse (?:code|information|details)\b|\bcredits?\b/i.test(message)) return 'course_information';
    return 'general';
}

function routeMessage(message, history, state) {
    let intent = classify(message);
    const clarification = isClarification(message);
    const userTurns = history.filter(item => item.role === 'user').map(item => item.content);
    const lastTopic = [...userTurns].reverse().map(classify).find(item => !['greeting', 'general'].includes(item));
    // "ขอดูเพิ่ม", "ช่วงบ่าย", "3 หน่วยกิต" right after a GE / free-elective list refine that list.
    const pendingCategory = state?.pendingClarification?.field === 'courseCategory';
    const option = pendingCategory && /^(?:ข้อ|ตัวเลือก|ตัว|อัน)(?:ที่)?\s*(แรก|หนึ่ง|สอง|[12๑๒])(?:\s*(?:ครับ|ค่ะ|คะ|ผม))*[\s.!]*$/i.exec(message)?.[1];
    const explicitCategory = courseCategory(message) || (option ? (/แรก|หนึ่ง|[1๑]/.test(option) ? 'genEd' : 'free') : null);
    const more = MORE.test(message.trim()) || MORE_COURSES.test(message) || Boolean(explicitCategory && /เพิ่ม|\bmore\b/i.test(message));
    const nextTerm = NEXT_TERM.test(message);
    const correcting = explicitCategory && CATEGORY_CORRECTION.test(message);
    const timeRefinement = NO_MORNING.test(message) || CLEAR_MORNING.test(message)
        || (KEEP_DAY_FREE.test(message) && mentionedDays(message).length > 0);
    const refinesCategory = (lastTopic === 'category_offering' || state?.currentIntent === 'category_offering') && !explicitCategory && !courseSearch(message)
        && (more || timeRefinement || hasFilter(categoryFilters(message)) || mentionedDays(message).length > 0);
    if (refinesCategory) intent = 'category_offering';
    const showAll = ALL_DETAILS.test(message);
    const followUp = FOLLOW_UP.test(message) || clarification || refinesCategory || showAll || nextTerm || more || (timeRefinement && intent === 'general')
        || /^\s*(?:วัน)?(?:จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์|อาทิตย์)(?:ล่ะ|ละ|ไหม)?[?？.\s]*$/i.test(message);
    const academicFollowUp = followUp && (YEAR_LEVEL.test(message) || SEMESTER.test(message));
    const previous = history.filter(item => item.role === 'user').map(item => ({
        intent: classify(item.content), search: courseSearch(item.content), message: item.content
    })).reverse().find(item => !['greeting', 'general'].includes(item.intent)
        && !(academicFollowUp && item.intent === 'user_profile')
        && !(item.intent === 'study_plan' && isClarification(item.message)
            && !/แผน|ต้องเรียน|แนะนำวิชา|study plan|what courses/i.test(item.message)));
    if (followUp) {
        if (previous && (intent === 'general' || (clarification && intent === 'study_plan'))) {
            intent = DAY.test(message) && ['study_plan', 'course_offering', 'course_information', 'schedule'].includes(previous.intent)
                ? 'course_offering' : previous.intent;
        }
    }
    const continuingPlan = followUp && ['study_plan', 'course_offering', 'course_information', 'schedule'].includes(previous?.intent);
    if (showAll && lastTopic === 'category_offering') intent = 'category_offering';
    const academicThread = continuingPlan ? [...userTurns.slice(userTurns.lastIndexOf(previous.message)), message] : [message];
    const noMorning = academicThread.reduce((avoid, turn) => CLEAR_MORNING.test(turn) ? false : avoid || NO_MORNING.test(turn), false);
    const preserveTimeFilter = continuingPlan && academicThread.slice(0, -1).some(turn => KEEP_DAY_FREE.test(turn));
    if (intent === 'study_plan' && continuingPlan && (timeRefinement || noMorning || preserveTimeFilter)) intent = 'course_offering';
    const search = courseSearch(message) || (followUp ? previous?.search : null) || null;
    const match = KEEP_DAY_FREE.test(message) ? null : message.match(DAY) || (clarification && !KEEP_DAY_FREE.test(previous?.message || '') ? previous?.message.match(DAY) : null);
    const add = ADD_TO_SCHEDULE.test(message) || (intent === 'schedule' && followUp && ADD_TO_SCHEDULE.test(previous?.message || ''));
    const section = message.match(/(?:กลุ่ม|เซกชัน|\bsection\b)\s*[:#]?\s*([A-Za-z0-9-]{1,16})(?![A-Za-z0-9-])/i)?.[1];
    // A follow-up such as "แล้วเทอม 3 ล่ะ" keeps the category, days and filters of the
    // earlier question; every later refinement since that question is applied in order.
    const continuing = followUp && previous?.intent === 'category_offering'
        && (!state?.currentIntent || state.currentIntent === 'category_offering');
    const thread = continuing ? [...userTurns.slice(userTurns.lastIndexOf(previous.message)), message] : [message];
    const category = courseCategory(message) || (continuing ? courseCategory(previous.message) : null);
    const days = [...thread].reverse().filter(turn => !KEEP_DAY_FREE.test(turn)).map(mentionedDays).find(list => list.length) || [];
    const filters = thread.map(categoryFilters).reduce((merged, next) => ({
        period: next.period || merged.period, credits: next.credits || merged.credits, keyword: next.keyword || merged.keyword
    }), { period: null, credits: null, keyword: null });
    if (category && thread.some(turn => NO_MORNING.test(turn))) filters.period = null;
    // Page 1 for a new or refined list; each consecutive "ขอดูเพิ่ม" moves one page on.
    let page = 1;
    if (continuing && more) {
        page = 2;
        for (let index = userTurns.length - 1; index >= 0 && MORE.test(userTurns[index].trim()); index--) page++;
    }
    const explicitPlan = !explicitCategory && /วิชาสาขา|วิชาบังคับ|แผนการเรียน/.test(message);
    const resumesCategory = state?.currentIntent === 'category_offering'
        && !explicitPlan && ((followUp && ['general', 'study_plan', 'category_offering'].includes(intent)) || correcting || (pendingCategory && explicitCategory));
    const moreOnly = more && !nextTerm && ['general', 'category_offering', 'study_plan'].includes(intent) && !search
        && (!/วิชาสาขา|วิชาบังคับ/.test(message) || explicitCategory);
    const inferredCategory = explicitCategory || category || (resumesCategory ? state.courseCategory : null);
    if (resumesCategory || moreOnly) intent = 'category_offering';
    if (intent === 'general' && (clarification || nextTerm || academicFollowUp)
        && ['study_plan', 'course_offering', 'schedule'].includes(state?.currentIntent)) intent = state.currentIntent;
    return { intent, search, section, day: match ? dayName(match[1] || match[2]) : null, add, category: inferredCategory, days,
        filters, page, describe: DESCRIBE.test(message),
        noMorning: category ? thread.reduce((avoid, turn) => CLEAR_MORNING.test(turn) ? false : avoid || NO_MORNING.test(turn), false) : noMorning,
        restrictionTurns: category ? thread : academicThread, showAll, followUp, nextTerm, resumesCategory,
        more: Boolean(moreOnly || (resumesCategory && state.pendingClarification?.more)),
        moreCount: moreCourseCount(message) ?? (resumesCategory ? state.pendingClarification?.count : null),
        currentPreferences: { days: KEEP_DAY_FREE.test(message) ? [] : mentionedDays(message), filters: categoryFilters(message),
            noMorning: CLEAR_MORNING.test(message) ? false : NO_MORNING.test(message) ? true : null } };
}

module.exports = { routeMessage, requestedProfileFields, academicNumbers, courseCategory, mentionedDays, categoryFilters };
