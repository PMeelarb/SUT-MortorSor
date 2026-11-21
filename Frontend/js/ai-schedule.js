// AI actions always re-read the exact class from Oracle through the Backend.
let aiSchedulePending = false;

function aiTimeMinutes(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0)) return null;
    return hours * 60 + minutes;
}

function prepareAICourseRows(courses, existing, context) {
    if (!Array.isArray(courses) || !courses.length) throw new Error('ไม่พบกลุ่มเรียนที่ยืนยันได้');
    const days = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
    if (existing.some(course => course.academicYear != null && Number(course.academicYear) !== context.academicYear)) {
        throw new Error('ตารางมีรายวิชาของปีการศึกษาอื่น กรุณาตรวจและจัดตารางให้ตรงปีก่อนเพิ่มวิชา');
    }
    const rows = [];
    const seenCodes = new Set(existing.map(course => normalizeCourseCodeKey(course.courseCode || course.code.split(' (G.')[0])));
    for (const course of courses) {
        const code = normalizeCourseCodeKey(course.courseCode);
        if (!code || !course.classId || !course.section || !course.courseName
            || typeof course.credits !== 'number' || !Number.isFinite(course.credits) || course.credits < 0
            || course.academicYear !== context.academicYear || course.semester !== context.semester
            || !Array.isArray(course.meetings) || !course.meetings.length) {
            throw new Error('ข้อมูลวิชา กลุ่ม หน่วยกิต หรือปีการศึกษาไม่ครบ กรุณาขอข้อมูลใหม่');
        }
        if (seenCodes.has(code)) throw new Error(`วิชา ${code} มีอยู่ในตารางแล้ว`);
        seenCodes.add(code);
        for (const meeting of course.meetings) {
            const startMinutes = aiTimeMinutes(meeting.start);
            const endMinutes = aiTimeMinutes(meeting.end);
            if (!days.includes(meeting.day) || startMinutes === null || endMinutes === null || startMinutes >= endMinutes) {
                throw new Error(`ยังยืนยันวันหรือเวลาเรียนของ ${code} ไม่ได้`);
            }
            const overlap = [...existing, ...rows].find(item => {
                if (item.no_time || item.day !== meeting.day) return false;
                const start = item.startMinutes ?? Math.round(Number(item.start) * 60);
                const end = item.endMinutes ?? Math.round(Number(item.end) * 60);
                if (!Number.isFinite(start) || !Number.isFinite(end)) {
                    throw new Error('มีรายการเดิมที่ตรวจเวลาไม่ได้ กรุณาตรวจตารางก่อนเพิ่มวิชา');
                }
                return startMinutes < end && endMinutes > start;
            });
            if (overlap) throw new Error(`${code} เวลาเรียนทับซ้อนกับ ${overlap.code}`);
            rows.push({
                id: `ORACLE_${encodeURIComponent(course.classId)}_${meeting.day}_${startMinutes}_${endMinutes}`,
                classId: course.classId, courseCode: code, section: course.section,
                code: `${code} (G.${course.section})`, name: course.courseName, credits: course.credits,
                day: meeting.day, start: startMinutes / 60, end: endMinutes / 60,
                startMinutes, endMinutes, no_time: false,
                academicYear: context.academicYear, curriculumYear: context.curriculumYear,
                // Data type, source term and verification state travel with the saved row.
                dataType: course.reference === true ? 'historical_simulation' : 'confirmed_offering',
                reference: course.reference === true,
                sourceAcademicYear: course.reference === true ? course.sourceAcademicYear ?? null : context.academicYear,
                sourceSemester: course.reference === true ? course.sourceSemester ?? null : context.semester,
                verificationStatus: course.reference === true ? 'simulated' : 'verified',
                custom_mid_text: 'ยังไม่ได้ตรวจข้อมูลสอบ', custom_fin_text: 'ยังไม่ได้ตรวจข้อมูลสอบ'
            });
        }
    }
    return rows;
}

window.applyAICoursesList = async function(requested, replyContext, timetableSource) {
    if (aiSchedulePending) return false;
    const context = replyContext || window.getAIChatContext({ forSchedule: true });
    // Preserve the old global entry point, but reject missing sections and
    // ignore any old model-supplied day/time fields.
    const courses = typeof requested === 'string' ? requested.split(',').map(item => {
        const [courseCode, section] = item.trim().split('|');
        return { courseCode, section };
    }) : requested;
    const before = JSON.stringify(selectedCoursesData);
    const userId = localStorage.getItem('sut_student_id');
    const unchanged = () => userId === localStorage.getItem('sut_student_id')
        && before === JSON.stringify(selectedCoursesData)
        && JSON.stringify(context) === JSON.stringify(window.getAIChatContext({ forSchedule: true }));
    aiSchedulePending = true;
    try {
        if (!userId || !unchanged()) throw new Error('บริบทเปลี่ยนไปแล้ว กรุณาขอคำแนะนำใหม่ในชั้นปีและเทอมที่เปิดอยู่');
        const source = timetableSource || window.getPlanSource?.();
        const result = await window.validateAICourses({ context, courses, ...(source ? { source } : {}) });
        if (!unchanged()) throw new Error('ตารางหรือบริบทเปลี่ยนระหว่างตรวจสอบ กรุณาลองใหม่');
        if (JSON.stringify(result.context) !== JSON.stringify(context)) throw new Error('บริบทที่ตรวจสอบไม่ตรงกับตาราง');
        const rows = prepareAICourseRows(result.courses, selectedCoursesData, context);
        const preview = result.courses.map(course => `${course.courseCode} ${course.courseName} กลุ่ม ${course.section}`
            + (course.reference === true ? ` (เวลาอ้างอิง ปี ${course.sourceAcademicYear} เทอม ${course.sourceSemester})` : '') + '\n'
            + course.meetings.map(meeting => `${meeting.day} ${meeting.start}–${meeting.end}`).join(', ')).join('\n\n');
        const simulated = result.courses.filter(course => course.reference === true);
        const sourceTerms = [...new Set(simulated.map(course => `ปี ${course.sourceAcademicYear} เทอม ${course.sourceSemester}`))];
        const notice = (result.unresolvedPlanRows > 0
            ? `\nแผนการเรียนยังมี ${result.unresolvedPlanRows} รายการที่ยืนยันรหัสวิชาไม่ได้\n` : '')
            + (simulated.length
                ? `\n⚠️ ข้อมูลจำลอง: ${simulated.length} วิชาใช้เวลาเรียนอ้างอิงจาก ${sourceTerms.join(', ')} ยังไม่ยืนยันเวลาเปิดสอนปีการศึกษา ${context.academicYear} และใช้ลงทะเบียนจริงไม่ได้\n` : '');
        if (!await window.confirmAppAction(`ยืนยันเพิ่มรายวิชาในชั้นปี ${context.yearLevel} ภาคเรียน ${context.semester}\nปีการศึกษา ${context.academicYear}\n${notice}\n${preview}`)) return false;
        if (!unchanged()) throw new Error('ตารางหรือบริบทเปลี่ยนไปแล้ว กรุณาตรวจสอบใหม่');
        selectedCoursesData.push(...rows);
        selectedCourseIds.push(...rows.map(row => row.id));
        scheduleCache[`${context.yearLevel}_${context.semester}`] = {
            ids: [...selectedCourseIds], data: selectedCoursesData.map(row => ({ ...row }))
        };
        updateDatabaseTimetableAndCredits();
        showSuccessModal('เพิ่มวิชาสำเร็จ', 'เพิ่มข้อมูลที่ตรวจสอบแล้วลงตาราง กรุณากดบันทึกเมื่อจัดตารางเสร็จ');
        return true;
    } catch (error) {
        window.showAppNotice(error.message);
        return false;
    } finally {
        aiSchedulePending = false;
    }
};

const AI_PLAN_FIELDS = ['faculty', 'major', 'curriculumYear', 'yearLevel', 'semester'];

// Move the timetable to the plan's year and term, caching the current view
// first exactly like the year tabs and term arrows do.
async function showAIScheduleTerm(yearLevel, semester) {
    const tab = Array.from(document.querySelectorAll('.year-tab'))
        .find(item => Number(item.textContent.match(/\d+/)?.[0]) === yearLevel);
    const semesterText = document.getElementById('semester-text');
    if (!tab || !semesterText) throw new Error(`ไม่พบตารางชั้นปี ${yearLevel} กรุณาเพิ่มชั้นปีในหน้าวางแผนการเรียนก่อน`);
    const current = window.getAIChatContext({ forSchedule: true });
    if (current.yearLevel === yearLevel && current.semester === semester) return;
    scheduleCache[`${current.yearLevel}_${current.semester}`] = {
        ids: JSON.parse(JSON.stringify(selectedCourseIds)), data: JSON.parse(JSON.stringify(selectedCoursesData))
    };
    document.querySelectorAll('.year-tab').forEach(item => item.classList.remove('active'));
    tab.classList.add('active');
    semesterText.textContent = `เทอมที่ ${semester}`;
    await window.loadSchedule();
}

// Years offered for one semester: every year Oracle has published, plus the
// latest year in Oracle when this semester is not published there yet
// (the Backend then uses the previous year's times as a labelled reference).
function aiAcademicYearChoices(terms, semester) {
    const published = [...new Set(terms.filter(term => term.semester === semester && term.classes > 0)
        .map(term => term.academicYear))].sort((a, b) => a - b);
    const choices = published.map(year => ({ year, label: `${year}` }));
    const latest = Math.max(...terms.map(term => term.academicYear));
    if (Number.isInteger(latest) && !published.includes(latest)) {
        const reference = published.filter(year => year < latest).at(-1);
        choices.push({ year: latest, label: reference
            ? `${latest} (ยังไม่ประกาศตาราง ใช้เวลาอ้างอิงปี ${reference})` : `${latest} (ยังไม่ประกาศตาราง)` });
    }
    return choices;
}

// Offerings depend on the academic year, which a curriculum plan does not carry.
async function askAIAcademicYear(semester) {
    const response = await fetch(`${window.aiChatConfig.apiBaseUrl.replace(/\/$/, '')}/api/terms`);
    const result = await response.json().catch(() => null);
    if (!response.ok || result?.status !== 'success' || !Array.isArray(result.terms)) {
        throw new Error(result?.error || 'โหลดปีการศึกษาจาก Oracle ไม่สำเร็จ กรุณาลองใหม่');
    }
    const choices = aiAcademicYearChoices(result.terms, semester);
    if (!choices.length) throw new Error(`Oracle ยังไม่มีข้อมูลกลุ่มเรียนของภาคเรียนที่ ${semester}`);
    const fallback = choices.at(-1).year;
    const answer = await window.chooseAppOption(`เลือกปีการศึกษา (ภาคเรียนที่ ${semester})`,
        choices.map(choice => ({ value: choice.year, label: choice.label })), fallback);
    if (answer === null) return null;
    const value = Number(answer.trim().replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - '๐'.charCodeAt(0))));
    if (!choices.some(choice => choice.year === value)) throw new Error('กรุณาเลือกปีการศึกษาจากรายการที่มีข้อมูลใน Oracle');
    return value;
}

// Plan button in AI Chat: reuse the timetable's automatic planner, which picks
// only verified Oracle sections, checks overlaps and asks for confirmation.
window.scheduleAIPlan = async function(planContext, options = {}) {
    if (aiSchedulePending) return false;
    try {
        if (AI_PLAN_FIELDS.some(name => !planContext?.[name])) throw new Error('ข้อมูลแผนการเรียนไม่ครบ กรุณาขอแผนการเรียนใหม่');
        // Same central year as the planner; ask only when nothing is selected anywhere.
        const academicYear = planContext.academicYear || window.planTerm?.academicYear || await askAIAcademicYear(planContext.semester);
        if (!academicYear) return false;
        if (window.planTerm && window.planTerm.academicYear !== academicYear) window.setPlanAcademicYear(academicYear);
        // A source the user named in chat wins; otherwise the planner's choice.
        const chatSource = options.source;
        const source = chatSource && (chatSource.mode === 'actual' || chatSource.sourceAcademicYear || chatSource.sourceSemester)
            ? chatSource : (window.getPlanSource?.() || chatSource);
        await showAIScheduleTerm(planContext.yearLevel, planContext.semester);
        window.aiChatContext = { ...planContext, academicYear };
        const context = window.getAIChatContext({ forSchedule: true });
        if (AI_PLAN_FIELDS.some(name => context[name] !== planContext[name]) || context.academicYear !== academicYear) {
            throw new Error('หลักสูตรในตารางไม่ตรงกับแผนที่ AI แนะนำ กรุณาตรวจสาขาในโปรไฟล์แล้วลองใหม่');
        }
        const coursePlan = document.querySelector('.menu-item[onclick*="course-plan"]');
        if (coursePlan && typeof window.switchPage === 'function') window.switchPage('course-plan', coursePlan);
        return await window.autoScheduleForContext(context, source, { excludeDays: options.excludeDays || [] });
    } catch (error) {
        window.showAppNotice(error.message);
        return false;
    }
};

window.aiAutoAddCourse = async function(courseCode, pillElement) {
    const section = pillElement?.dataset?.section;
    const added = await window.applyAICoursesList([{ courseCode, section }]);
    if (added && pillElement) {
        pillElement.textContent = `${courseCode} (เพิ่มแล้ว)`;
        pillElement.style.pointerEvents = 'none';
    }
    return added;
};
