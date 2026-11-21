// ==========================================
// 🔍 ระบบหมวดหมู่วิชา (วิชาสาขา, เลือกเสรี, ศึกษาทั่วไป)
// Categories come from the program structure in Oracle. Each course lists real
// sections of the planned term, or clearly labelled historical sections for a
// draft timetable. Sections, days and times are never invented here.
// ==========================================

// 1. ฟังก์ชันเปิด-ปิด กล่อง Accordion
window.toggleAccordion = function(headerElement) {
    const content = headerElement.nextElementSibling;
    const icon = headerElement.querySelector('i');

    if (content.classList.contains('open')) {
        content.classList.remove('open');
        content.style.display = 'none';
        icon.style.transform = 'rotate(0deg)';
    } else {
        content.classList.add('open');
        content.style.display = 'block';
        icon.style.transform = 'rotate(180deg)';
    }
};

const CATALOG_LISTS = [['major', 'search-major', 'courses-major'], ['genEd', 'search-gen', 'courses-gen'], ['free', 'search-free', 'courses-free']];
const CATALOG_PAGE = 50;
const CATALOG_SECTIONS_SHOWN = 8;
let catalogRequest = 0;
let catalogState = null;

function catalogMessage(listEl, text) {
    const message = document.createElement('div');
    message.className = 'catalog-empty';
    message.textContent = text;
    listEl.replaceChildren(message);
}

function catalogMeetings(group) {
    return group.meetings.map(meeting => `${meeting.day || '?'} ${meeting.start || '?'}–${meeting.end || '?'}`).join(', ');
}

function sectionLabel(group, context) {
    if (!group.actionable) return `กลุ่ม ${group.section || '?'} | ข้อมูลวันหรือเวลาไม่ครบ`;
    if (group.reference) return `เวลาอ้างอิง กลุ่ม ${group.section} | ${catalogMeetings(group)} | จากปี ${group.sourceAcademicYear} เทอม ${group.sourceSemester}`;
    return `กลุ่ม ${group.section} | ${catalogMeetings(group)} | ปี ${context.academicYear} เทอม ${context.semester}`;
}

const CATALOG_STATUS = {
    offered: ['catalog-badge is-real', 'เปิดสอนจริง'],
    reference: ['catalog-badge is-sim', 'จำลอง'],
    incomplete: ['catalog-badge is-warn', 'เวลาไม่ครบ'],
    not_offered: ['catalog-badge', 'ไม่เปิดเทอมนี้'],
    unpublished: ['catalog-badge', 'ไม่มีข้อมูลเวลา']
};

function renderCatalogCourse(course, context) {
    const item = document.createElement('div');
    item.className = 'course-item catalog-course';
    const head = document.createElement('div');
    head.className = 'catalog-course-head';
    const code = document.createElement('strong');
    code.textContent = window.formatCourseCodeDisplay(course.courseCode);
    const name = document.createElement('span');
    name.className = 'catalog-course-name';
    name.textContent = course.courseName || 'ไม่มีข้อมูลชื่อวิชา';
    const credits = document.createElement('span');
    credits.className = 'catalog-course-credits';
    credits.textContent = course.credits === null ? '(ไม่มีข้อมูลหน่วยกิต)' : `(${course.credits} หน่วยกิต)`;
    const [badgeClass, badgeText] = CATALOG_STATUS[course.status] || CATALOG_STATUS.unpublished;
    const badge = document.createElement('span');
    badge.className = badgeClass;
    badge.textContent = badgeText;
    head.append(code, name, credits, badge);
    item.append(head);

    const sections = document.createElement('div');
    sections.className = 'catalog-sections';
    if (!course.sections.length) {
        const none = document.createElement('span');
        none.className = 'catalog-none';
        none.textContent = 'ไม่มีข้อมูลเวลาเรียนที่ตรวจสอบได้';
        const keep = document.createElement('button');
        keep.type = 'button';
        keep.className = 'catalog-section is-interest';
        keep.textContent = 'เก็บเป็นวิชาที่สนใจ';
        keep.disabled = course.credits === null;
        keep.addEventListener('click', () => window.addInterestedCourse(course, context));
        sections.append(none, keep);
    }
    const render = limit => {
        sections.querySelectorAll('.catalog-section:not(.is-interest), .catalog-more').forEach(node => node.remove());
        for (const group of course.sections.slice(0, limit)) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `catalog-section${group.reference ? ' is-sim' : ''}`;
            chip.textContent = sectionLabel(group, context);
            chip.disabled = !group.actionable;
            if (group.reference) chip.title = `จำลอง — ยังไม่ยืนยันเวลาเปิดสอนปี ${context.academicYear}`;
            chip.addEventListener('click', () => window.addCatalogSection(course, group, chip));
            sections.append(chip);
        }
        if (course.sections.length > limit) {
            const more = document.createElement('button');
            more.type = 'button';
            more.className = 'catalog-more';
            more.textContent = `ดูทั้งหมด ${course.sections.length} กลุ่ม`;
            more.addEventListener('click', () => render(course.sections.length));
            sections.append(more);
        }
    };
    render(CATALOG_SECTIONS_SHOWN);
    if (course.sections.some(group => group.reference)) {
        const sim = document.createElement('div');
        sim.className = 'catalog-sim-note';
        sim.textContent = `จำลอง — ยังไม่ยืนยันเวลาเปิดสอนปี ${context.academicYear}`;
        item.append(sections, sim);
    } else {
        item.append(sections);
    }
    return item;
}

// 2. ฟังก์ชันสร้างรายการวิชาและระบบค้นหา (Search)
window.setupCourseSearchBox = function(inputId, listId, courses, context) {
    const inputEl = document.getElementById(inputId);
    const listEl = document.getElementById(listId);
    if (!inputEl || !listEl) return;
    const render = () => {
        const keyword = inputEl.value.toLowerCase().replace(/\s+/g, '');
        const matched = keyword ? courses.filter(course => course.courseCode.toLowerCase().includes(keyword)
            || String(course.courseName || '').toLowerCase().replace(/\s+/g, '').includes(keyword)) : courses;
        if (!matched.length) return catalogMessage(listEl, 'ไม่พบรายวิชาที่ค้นหาในหมวดหมู่นี้');
        listEl.replaceChildren(...matched.slice(0, CATALOG_PAGE).map(course => renderCatalogCourse(course, context)));
        if (matched.length > CATALOG_PAGE) {
            const more = document.createElement('div');
            more.className = 'catalog-empty';
            more.textContent = `แสดง ${CATALOG_PAGE} จาก ${matched.length} วิชา พิมพ์รหัสหรือชื่อเพื่อค้นหาเพิ่มเติม`;
            listEl.append(more);
        }
    };
    inputEl.oninput = render;
    render();
};

// Combine overlapping requests for the same catalog; section selection still validates fresh.
const catalogRequests = new Map();

// 3. โหลดรายวิชาของเทอมที่วางแผน
window.fetchAndSetupCourseCategories = async function() {
    const request = ++catalogRequest;
    const context = window.getAIChatContext({ forSchedule: true });
    const source = window.getPlanSource?.() || { mode: 'simulate' };
    const lists = CATALOG_LISTS.map(([, , listId]) => document.getElementById(listId)).filter(Boolean);
    if (!context.faculty || !context.major || !context.academicYear || !context.semester) {
        lists.forEach(listEl => catalogMessage(listEl, 'รอข้อมูลสาขาจากโปรไฟล์และปีการศึกษาที่จะจัดตาราง'));
        return;
    }
    lists.forEach(listEl => catalogMessage(listEl, 'กำลังค้นรายวิชาและกลุ่มเรียนจาก Oracle…'));
    try {
        const query = new URLSearchParams();
        for (const [name, value] of Object.entries({ ...context, ...source })) {
            if (value !== null && value !== undefined && value !== '') query.set(name, value);
        }
        const url = `${window.aiChatConfig.apiBaseUrl.replace(/\/$/, '')}/api/catalog/offerings?${query}`;
        if (!catalogRequests.has(url)) {
            catalogRequests.set(url, fetch(url).then(async response => {
                const result = await response.json();
                if (!response.ok || result?.status !== 'success') throw new Error(result?.error || 'ค้นรายวิชาไม่สำเร็จ');
                return result;
            }).finally(() => catalogRequests.delete(url)));
        }
        const result = await catalogRequests.get(url);
        if (request !== catalogRequest) return;
        if (!result.program) {
            lists.forEach(listEl => catalogMessage(listEl, result.outcome === 'ambiguous_program'
                ? 'พบหลักสูตรหลายปีใน Oracle กรุณาระบุปีหลักสูตรผ่าน AI Advisor ก่อน' : 'ไม่พบหลักสูตรของสาขาในโปรไฟล์ใน Oracle'));
            return;
        }
        // The catalog resolved the curriculum year; later adds validate against the same program.
        window.aiChatContext = { ...(window.aiChatContext || {}), faculty: context.faculty, major: context.major,
            curriculumYear: result.program.curriculumYear };
        const active = window.getAIChatContext({ forSchedule: true });
        catalogState = { context: active, source };
        for (const [category, inputId, listId] of CATALOG_LISTS) {
            window.setupCourseSearchBox(inputId, listId, result.courses.filter(course => course.category === category), active);
        }
    } catch (error) {
        if (request === catalogRequest) lists.forEach(listEl => catalogMessage(listEl, `${error.message} กรุณาลองใหม่`));
    }
};

// 4. เพิ่มกลุ่มเรียนจากรายการ: ตรวจกับ Oracle และให้ผู้ใช้ยืนยันก่อนเสมอ
window.addCatalogSection = async function(course, group, chip) {
    if (!catalogState || !group.actionable || chip?.disabled) return;
    const label = chip?.textContent;
    if (chip) {
        chip.disabled = true;
        chip.textContent = 'กำลังตรวจ…';
    }
    const added = await window.applyAICoursesList([{ courseCode: course.courseCode, classId: group.classId, section: group.section }],
        catalogState.context, catalogState.source);
    if (chip) {
        chip.disabled = added;
        chip.textContent = added ? 'เพิ่มแล้ว' : label;
        if (added) chip.classList.add('is-added');
    }
    if (added && typeof window.saveSchedule === 'function') await window.saveSchedule();
};

// วิชาที่ยังไม่มีเวลาเรียนที่ตรวจสอบได้: เก็บไว้เป็นวิชาที่สนใจ ไม่วางคาบสมมติ
window.addInterestedCourse = async function(course, context) {
    const snapshot = JSON.stringify(window.getAIChatContext({ forSchedule: true }));
    const owner = localStorage.getItem('sut_student_id');
    const code = window.normalizeCourseCodeKey ? window.normalizeCourseCodeKey(course.courseCode) : course.courseCode;
    if (selectedCoursesData.some(row => (row.courseCode || row.code.split(' (G.')[0]).replace(/\s+/g, '') === code)) {
        window.showAppNotice(`วิชา ${code} มีอยู่ในตารางเทอมนี้แล้ว`);
        return;
    }
    if (!await window.confirmAppAction(`เก็บ ${code} ${course.courseName} เป็นวิชาที่สนใจ?\nยังไม่มีเวลาเรียนที่ตรวจสอบได้ จึงไม่วางลงช่องเวลาในตาราง`)) return;
    if (owner !== localStorage.getItem('sut_student_id') || snapshot !== JSON.stringify(window.getAIChatContext({ forSchedule: true }))
        || selectedCoursesData.some(row => (row.courseCode || row.code.split(' (G.')[0]).replace(/\s+/g, '') === code)) return;
    const id = `INTEREST_${code}`;
    selectedCourseIds.push(id);
    selectedCoursesData.push({
        id, courseCode: code, code, section: '-', name: course.courseName, credits: course.credits,
        day: '-', start: 0, end: 0, no_time: true, interestOnly: true, dataType: 'interest',
        academicYear: context.academicYear, verificationStatus: 'no_verified_time',
        custom_mid_text: '-', custom_fin_text: '-'
    });
    scheduleCache[`${context.yearLevel}_${context.semester}`] = { ids: [...selectedCourseIds], data: selectedCoursesData.map(row => ({ ...row })) };
    updateDatabaseTimetableAndCredits();
    if (typeof window.saveSchedule === 'function') window.saveSchedule();
};

// 5. โหลดใหม่เมื่อเปลี่ยนปีการศึกษา เทอม หรือแหล่งเวลาเรียน
document.addEventListener('planterm:change', () => {
    window.fetchAndSetupCourseCategories();
});
