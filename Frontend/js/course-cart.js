// ==========================================
// 🛒 8. ตะกร้าวิชาที่เลือก 
// ==========================================
function updateSelectedCoursesCart() {
    const cartContainer = document.getElementById('selected-courses-list');
    if (!cartContainer) return;

    cartContainer.innerHTML = ''; 
    if (selectedCourseIds.length === 0) {
        cartContainer.innerHTML = '<div style="text-align: center; color: #adb5bd; font-size: 0.9em; padding: 20px;">ยังไม่มีวิชาที่เลือก</div>';
        return;
    }

    const pastelColors = ['#fca5a5', '#c4b5fd', '#f9a8d4', '#fef08a', '#86efac', '#93c5fd'];
    const uniqueCourses = {};
    
    selectedCoursesData.forEach(c => {
        const pureCode = c.code.split(' (G.')[0]; 
        const sectionMatch = c.code.match(/G\.([^)]*)\)/);
        const section = c.section ?? (sectionMatch ? sectionMatch[1] : '-');
        
        if (!uniqueCourses[pureCode]) {
            uniqueCourses[pureCode] = { 
                ids: [c.id], code: pureCode, name: c.name, credits: c.credits, section: section, classId: c.classId,
                times: c.no_time ? [] : [`${c.day} ${formatScheduleHour(c.start)}-${formatScheduleHour(c.end)}`],
                custom_mid_text: c.custom_mid_text, custom_fin_text: c.custom_fin_text,
                reference: c.reference === true, sourceAcademicYear: c.sourceAcademicYear, sourceSemester: c.sourceSemester,
                academicYear: c.academicYear, interestOnly: c.interestOnly === true
            };
        } else {
            uniqueCourses[pureCode].ids.push(c.id);
            if (!c.no_time) uniqueCourses[pureCode].times.push(`${c.day} ${formatScheduleHour(c.start)}-${formatScheduleHour(c.end)}`);
        }
    });

    let colorIndex = 0;
    Object.values(uniqueCourses).forEach(course => {
        const bgColor = pastelColors[colorIndex % pastelColors.length];
        colorIndex++;

        let foundCourse = course.classId ? {} : allCourses.find(c => normalizeCourseCodeKey(c.COURSECODE) === normalizeCourseCodeKey(course.code) && String(getSection(c)) === String(course.section)) || {};
        
        const formatExam = (dateStr, startStr, endStr) => {
            if (!dateStr || dateStr.trim() === '' || dateStr.trim() === '-') return "-";
            let formattedDate = dateStr;
            let timeText = (startStr && endStr) ? ` เวลา ${startStr}-${endStr} น.` : "";
            if (formattedDate.includes('/')) {
                let parts = formattedDate.split('/');
                if (parts.length === 3 && parseInt(parts[2]) < 2500) {
                    parts[2] = parseInt(parts[2]) + 543;
                    formattedDate = parts.join('/'); 
                }
            }
            return formattedDate + timeText;
        };

        const midText = course.custom_mid_text ? course.custom_mid_text : formatExam(getMidDate(foundCourse), getMidStart(foundCourse), getMidEnd(foundCourse));
        const finText = course.custom_fin_text ? course.custom_fin_text : formatExam(getFinDate(foundCourse), getFinStart(foundCourse), getFinEnd(foundCourse));
        
        const nameEN = foundCourse.COURSENAME_ENG || course.name; 
        const timeString = course.times.length > 0 ? course.times.join(', ')
            : (course.interestOnly ? 'ไม่มีข้อมูลเวลาเรียนที่ตรวจสอบได้ (วิชาที่สนใจ ยังไม่วางลงตาราง)' : 'ไม่มีข้อมูลเวลาเรียน (กำหนดเอง)');
        const dataNote = course.reference
            ? `จำลอง — เวลาอ้างอิงจากปี ${course.sourceAcademicYear ?? '?'} เทอม ${course.sourceSemester ?? '?'} ยังไม่ยืนยันเวลาเปิดสอนปี ${course.academicYear ?? '?'}`
            : '';
        const idsString = course.ids.join(',');

        const cardHTML = `
            <div class="selected-course-card">
                <div class="course-card-left" style="background-color: ${bgColor};">
                    <span>${escapeCourseHTML(window.formatCourseCodeDisplay(course.code))}</span>
                    <span style="font-size: 12px; font-weight: normal; margin-top: 4px;">กลุ่ม ${escapeCourseHTML(course.section)}</span>
                </div>
                <div class="course-card-right">
                    <div class="course-header-row">
                        <div class="course-name-title">${escapeCourseHTML(nameEN)}</div>
                        <div class="credit-pill">${course.credits} หน่วยกิต</div>
                    </div>
                    <div class="course-details-text">${escapeCourseHTML(course.name)}</div>
                    <div class="course-details-text"><i class="fa-regular fa-clock"></i> เวลาเรียน: ${escapeCourseHTML(timeString)}</div>
                    ${dataNote ? `<div class="course-sim-note">${escapeCourseHTML(dataNote)}</div>` : ''}
                    <div class="exam-date-text" style="display: flex; flex-direction: column; gap: 4px; margin-top: 6px;">
                        <div style="color: #F39C12;"><i class="fa-solid fa-file-pen"></i> สอบกลางภาค: ${escapeCourseHTML(midText)}</div>
                        <div style="color: #ef4444;"><i class="fa-regular fa-calendar-check"></i> สอบปลายภาค: ${escapeCourseHTML(finText)}</div>
                    </div>
                </div>
                <button class="delete-btn-modern"><i class="fa-solid fa-trash"></i> ลบ</button>
            </div>`;
        cartContainer.insertAdjacentHTML('beforeend', cardHTML);
        cartContainer.lastElementChild.querySelector('.delete-btn-modern').addEventListener('click', () => {
            window.removeCourseFromList(idsString);
        });
    });
}

window.removeCourseFromList = function(idsString) {
    const idsToRemove = idsString.split(',');
    selectedCourseIds = selectedCourseIds.filter(id => !idsToRemove.includes(id));
    selectedCoursesData = selectedCoursesData.filter(c => !idsToRemove.includes(c.id));
    idsToRemove.forEach(id => {
        const checkbox = document.querySelector(`.course-checkbox[value="${id}"]`);
        if (checkbox) checkbox.checked = false;
    });
    const currentKey = `${currentYearLevel}_${currentSemester}`;
    if (scheduleCache[currentKey]) {
        scheduleCache[currentKey].ids = [...selectedCourseIds];
        scheduleCache[currentKey].data = [...selectedCoursesData];
    }
    updateDatabaseTimetableAndCredits();
};

