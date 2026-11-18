// ==========================================
// 📅 4. วาดตารางเรียนหลัก
// ==========================================
function drawTimetableGrid(activeCourses = []) { 
    const grid = document.getElementById('timetable-grid');
    if (!grid) return;
    
    grid.className = ''; 
    grid.style.cssText = 'display: grid; background-color: #1f2937; border-radius: 8px; overflow: hidden; border: 1px solid #374151; box-shadow: 0 4px 6px rgba(0,0,0,0.1); position: relative; margin-bottom: 20px;';
    grid.innerHTML = ''; 
    
    let startHour = 8;
    let endHour = 18; 
    
    if (activeCourses && activeCourses.length > 0) {
        activeCourses.forEach(course => {
            if (course.no_time) return;
            if (course.start > 0 && course.start < startHour) startHour = course.start;
            if (course.end > 0 && course.end > endHour) endHour = course.end;
        });
    }

    const totalColumns = endHour - startHour;
    grid.style.gridTemplateColumns = `80px repeat(${totalColumns}, 1fr)`;

    const headerStyle = "background-color: #111827; color: white; padding: 12px 5px; text-align: center; font-size: 13px; font-weight: 600; border-bottom: 1px solid #374151; border-right: 1px solid #374151; display: flex; align-items: center; justify-content: center;";
    const dayStyle = "background-color: #111827; color: white; font-size: 13px; font-weight: 600; border-bottom: 1px solid #374151; border-right: 1px solid #374151; display: flex; align-items: center; justify-content: center;";
    const slotStyle = "background-color: #1f2937; border-bottom: 1px solid #374151; border-right: 1px solid #374151; min-height: 55px;";

    grid.insertAdjacentHTML('beforeend', `<div style="grid-row: 1; grid-column: 1; ${headerStyle}">Day/Time</div>`);
    let colIndex = 2;
    for (let i = startHour; i < endHour; i++) {
        grid.insertAdjacentHTML('beforeend', `<div style="grid-row: 1; grid-column: ${colIndex}; ${headerStyle}">${i}.00-${i+1}.00</div>`);
        colIndex++;
    }

    const days = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
    days.forEach((day, index) => {
        const row = index + 2; 
        grid.insertAdjacentHTML('beforeend', `<div style="grid-row: ${row}; grid-column: 1; ${dayStyle}">${day}</div>`);
        for (let c = 2; c <= colIndex - 1; c++) {
            grid.insertAdjacentHTML('beforeend', `<div style="grid-row: ${row}; grid-column: ${c}; ${slotStyle}"></div>`);
        }
    });

    if (activeCourses && activeCourses.length > 0) {
        activeCourses.forEach(course => {
            if (course.no_time) return;

            const dayIndex = days.indexOf(course.day) + 2; 
            const colStart = course.start - startHour + 2; 
            const duration = course.end - course.start;

            if (dayIndex >= 2 && colStart >= 2) {
                const baseCode = course.code.split(' ')[0];
                if (!courseColorMap[baseCode]) {
                    courseColorMap[baseCode] = classColors[Math.floor(Math.random() * classColors.length)];
                }

                const isCustom = String(course.id).startsWith('CUSTOM_') || String(course.id).startsWith('AI_') || String(course.id).startsWith('SHARED_');
                const bgColor = isCustom ? '#ef4444' : courseColorMap[baseCode]; 
                const displayCredit = isCustom ? 'กำหนดเอง' : `(${course.credits} หน่วย)`;

                const courseHTML = `
                    <div style="grid-row: ${dayIndex}; grid-column: ${colStart} / span ${duration}; background-color: ${bgColor}; color: #ffffff; cursor: pointer; border-radius: 6px; margin: 3px; padding: 4px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.2); z-index: 10; border: 1px solid rgba(255,255,255,0.1);" onclick="window.confirmRemoveCourse('${course.id}', '${window.formatCourseCodeDisplay(course.code)}')">
                        <div style="font-weight: 600; font-size: 18px; white-space: nowrap;">${window.formatCourseCodeDisplay(course.code)}</div>
                        <div style="font-size: 16px; opacity: 0.9; margin-top: 2px;">${course.start}.00-${course.end}.00</div>
                    </div>`;
                grid.insertAdjacentHTML('beforeend', courseHTML);
            }
        });
    }
}

