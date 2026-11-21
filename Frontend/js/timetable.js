// ==========================================
// 📅 4. วาดตารางเรียนหลัก
// ==========================================
function drawTimetableGrid(activeCourses = []) { 
    const grid = document.getElementById('timetable-grid');
    if (!grid) return;
    
    grid.className = 'timetable-live';
    grid.innerHTML = ''; 
    
    let startHour = 8;
    let endHour = 18; 
    
    if (activeCourses && activeCourses.length > 0) {
        activeCourses.forEach(course => {
            if (course.no_time) return;
            if (course.start >= 0 && course.start < startHour) startHour = Math.floor(course.start);
            if (course.end > 0 && course.end > endHour) endHour = Math.ceil(course.end);
        });
    }

    const totalColumns = endHour - startHour;
    grid.style.gridTemplateColumns = `76px repeat(${totalColumns}, minmax(60px, 1fr))`;
    grid.style.minWidth = `${76 + totalColumns * 60}px`;

    grid.insertAdjacentHTML('beforeend', '<div class="timetable-time" style="grid-row: 1; grid-column: 1;">วัน / เวลา</div>');
    let colIndex = 2;
    for (let i = startHour; i < endHour; i++) {
        grid.insertAdjacentHTML('beforeend', `<div class="timetable-time" style="grid-row: 1; grid-column: ${colIndex};">${formatScheduleHour(i)}–${formatScheduleHour(i + 1)}</div>`);
        colIndex++;
    }

    const days = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
    days.forEach((day, index) => {
        const row = index + 2; 
        grid.insertAdjacentHTML('beforeend', `<div class="timetable-day" style="grid-row: ${row}; grid-column: 1;">${day}</div>`);
        for (let c = 2; c <= colIndex - 1; c++) {
            grid.insertAdjacentHTML('beforeend', `<div class="timetable-slot" style="grid-row: ${row}; grid-column: ${c};"></div>`);
        }
    });

    if (activeCourses && activeCourses.length > 0) {
        activeCourses.forEach(course => {
            if (course.no_time) return;

            const dayIndex = days.indexOf(course.day) + 2; 
            const colStart = Math.floor(course.start) - startHour + 2;
            const duration = Math.ceil(course.end) - Math.floor(course.start);
            const leftInset = (course.start - Math.floor(course.start)) * 100 / duration;
            const rightInset = (Math.ceil(course.end) - course.end) * 100 / duration;

            if (dayIndex >= 2 && colStart >= 2) {
                const baseCode = course.code.split(' ')[0];
                if (!courseColorMap[baseCode]) {
                    courseColorMap[baseCode] = classColors[Math.floor(Math.random() * classColors.length)];
                }

                const isCustom = String(course.id).startsWith('CUSTOM_') || String(course.id).startsWith('AI_') || String(course.id).startsWith('SHARED_');
                const bgColor = isCustom ? '#ef4444' : courseColorMap[baseCode]; 
                const displayCode = escapeCourseHTML(window.formatCourseCodeDisplay(course.code));
                // Simulated rows carry their source term; show it on the slot itself.
                const simulated = course.reference === true;
                const sourceText = simulated ? escapeCourseHTML(`จำลอง · ${course.sourceAcademicYear ?? '?'}/${course.sourceSemester ?? '?'}`) : '';
                const titleText = simulated
                    ? `${displayCode} — ${escapeCourseHTML(`เวลาอ้างอิงจากปี ${course.sourceAcademicYear ?? '?'} เทอม ${course.sourceSemester ?? '?'} ยังไม่ยืนยันเวลาเปิดสอน`)}`
                    : displayCode;
                const courseHTML = `
                    <button type="button" class="timetable-event${simulated ? ' is-simulated' : ''}" style="grid-row: ${dayIndex}; grid-column: ${colStart} / span ${duration}; --event-color: ${bgColor}; margin-left: calc(${leftInset}% + 3px); margin-right: calc(${rightInset}% + 3px);" title="${titleText}">
                        <strong>${displayCode}</strong>
                        <span>${formatScheduleHour(course.start)}-${formatScheduleHour(course.end)}</span>
                        ${simulated ? `<em class="timetable-sim-tag">${sourceText}</em>` : ''}
                    </button>`;
                grid.insertAdjacentHTML('beforeend', courseHTML);
                grid.lastElementChild.addEventListener('click', () => {
                    window.confirmRemoveCourse(course.id, window.formatCourseCodeDisplay(course.code));
                });
            }
        });
    }
}

