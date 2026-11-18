// ==========================================
// 🔍 ระบบ Autofill ค้นหาวิชาสำหรับหน้า "กำหนดรายวิชาเอง"
// ==========================================
window.setupCustomCourseAutocomplete = function() {
    const searchInput = document.getElementById('custom-course-search');
    const dropdown = document.getElementById('custom-course-dropdown');

    if (!searchInput || !dropdown) return;

    searchInput.addEventListener('input', function(e) {
        const keyword = e.target.value.toLowerCase().trim();
        
        if (!keyword) {
            dropdown.style.display = 'none';
            return;
        }

        let combinedCourses = [];
        let seenCodes = new Set();
        
        [...allCourses, ...masterCourses].forEach(c => {
            if (c.COURSECODE && !seenCodes.has(c.COURSECODE)) {
                combinedCourses.push(c);
                seenCodes.add(c.COURSECODE);
            }
        });

        const matched = combinedCourses.filter(c => {
            const code = (c.COURSECODE || '').toLowerCase();
            const name = (c.COURSENAME || '').toLowerCase();
            return code.includes(keyword) || name.includes(keyword);
        }).slice(0, 15);

        if (matched.length === 0) {
            dropdown.innerHTML = '<div style="padding: 15px; text-align: center; color: #9ca3af; font-size: 13px;">ไม่พบรายวิชานี้ในระบบ...<br>กรุณาพิมพ์ข้อมูลฝั่งขวาด้วยตัวเอง</div>';
            dropdown.style.display = 'block';
            return;
        }

        dropdown.innerHTML = matched.map(c => `
            <div class="autocomplete-item" data-code="${c.COURSECODE}" data-sec="${c.SECTION || '1'}" style="padding: 12px 15px; cursor: pointer; border-bottom: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: left; transition: 0.2s;">
                <strong style="color: #111; display: block; margin-bottom: 4px;">${window.formatCourseCodeDisplay(c.COURSECODE)} ${c.SECTION && c.SECTION !== '1' ? `(กลุ่ม ${c.SECTION})` : ''}</strong>
                <span style="font-size: 12px; color: #6b7280;">${c.COURSENAME}</span>
            </div>
        `).join('');

        dropdown.querySelectorAll('.autocomplete-item').forEach(item => {
            item.addEventListener('click', function() {
                const code = this.getAttribute('data-code');
                const sec = this.getAttribute('data-sec');
                window.selectCustomCourse(code, sec);
            });
            item.addEventListener('mouseover', function() { this.style.backgroundColor='#fff1f2'; this.style.color='#F05A28'; });
            item.addEventListener('mouseout', function() { this.style.backgroundColor='transparent'; this.style.color='#374151'; });
        });

        dropdown.style.display = 'block';
    });

    document.addEventListener('click', function(e) {
        if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.style.display = 'none';
        }
    });
};

window.selectCustomCourse = function(courseCode, section) {
    let course = allCourses.find(c => c.COURSECODE === courseCode && String(c.SECTION || '1') === String(section));
    if (!course) course = masterCourses.find(c => c.COURSECODE === courseCode);
    if (!course) return;

    document.getElementById('custom-code').value = course.COURSECODE || '';
    document.getElementById('custom-name').value = course.COURSENAME || '';

    const dayMapReverse = { 'จันทร์': 'MON', 'อังคาร': 'TUE', 'พุธ': 'WED', 'พฤหัสบดี': 'THU', 'ศุกร์': 'FRI', 'เสาร์': 'SAT', 'อาทิตย์': 'SUN' };
    if (course.DAY_NAME && dayMapReverse[course.DAY_NAME]) {
        document.getElementById('custom-day').value = dayMapReverse[course.DAY_NAME];
    }
    if (course.START_TIME) document.getElementById('custom-start').value = course.START_TIME;
    if (course.END_TIME) document.getElementById('custom-end').value = course.END_TIME;

    const formatDateForInput = (dateStr) => {
        if (!dateStr || dateStr === '-' || dateStr.trim() === '') return '';
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            let d = parts[0].padStart(2, '0'), m = parts[1].padStart(2, '0'), y = parseInt(parts[2]);
            if (y > 2500) y -= 543; 
            return `${y}-${m}-${d}`;
        }
        return '';
    };

    document.getElementById('custom-mid-date').value = formatDateForInput(course.MID_DATE);
    document.getElementById('custom-mid-start').value = course.MID_START || '';
    document.getElementById('custom-mid-end').value = course.MID_END || '';

    document.getElementById('custom-fin-date').value = formatDateForInput(course.FIN_DATE);
    document.getElementById('custom-fin-start').value = course.FIN_START || '';
    document.getElementById('custom-fin-end').value = course.FIN_END || '';

    document.getElementById('custom-course-search').value = '';
    document.getElementById('custom-course-dropdown').style.display = 'none';

    const inputsToFlash = ['custom-code', 'custom-name', 'custom-day', 'custom-start', 'custom-end', 'custom-mid-date', 'custom-fin-date'];
    inputsToFlash.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.style.transition = 'border-color 0.3s';
            el.style.borderColor = '#10b981';
            setTimeout(() => el.style.borderColor = '#d1d5db', 800);
        }
    });
};

window.addCustomCourseToTable = function() {
    const code = document.getElementById('custom-code').value.trim();
    const name = document.getElementById('custom-name').value.trim();
    const dayVal = document.getElementById('custom-day').value;
    const start = document.getElementById('custom-start').value;
    const end = document.getElementById('custom-end').value;

    const midDate = document.getElementById('custom-mid-date').value;
    const midStart = document.getElementById('custom-mid-start').value;
    const midEnd = document.getElementById('custom-mid-end').value;
    
    const finDate = document.getElementById('custom-fin-date').value;
    const finStart = document.getElementById('custom-fin-start').value;
    const finEnd = document.getElementById('custom-fin-end').value;

    if(!code || !name) return alert('⚠️ กรุณากรอกรหัสวิชาและชื่อวิชาให้ครบถ้วน');

    if(!start || !end || start.trim() === '' || end.trim() === '') {
        const uniqueId = `CUSTOM_${Date.now()}`;
        selectedCourseIds.push(uniqueId);
        
        const formatCustomExam = (d, s, e) => {
            if (!d) return "-";
            const dateParts = d.split('-'); 
            if(dateParts.length !== 3) return "-";
            const yearTH = parseInt(dateParts[0]) + 543;
            let formattedDate = `${dateParts[2]}/${dateParts[1]}/${yearTH}`;
            let timeText = (s && e) ? ` เวลา ${s}-${e} น.` : "";
            return formattedDate + timeText;
        };

        selectedCoursesData.push({
            id: uniqueId, code: code, name: name, credits: 0, day: '-', start: 0, end: 0,
            custom_mid_text: formatCustomExam(midDate, midStart, midEnd),
            custom_fin_text: formatCustomExam(finDate, finStart, finEnd),
            no_time: true
        });

        updateDatabaseTimetableAndCredits();
        document.getElementById('modal-custom-course').style.display = 'none';
        
        document.getElementById('custom-code').value = ''; document.getElementById('custom-name').value = '';
        document.getElementById('custom-course-search').value = ''; document.getElementById('custom-mid-date').value = ''; 
        document.getElementById('custom-mid-start').value = ''; document.getElementById('custom-mid-end').value = '';
        document.getElementById('custom-fin-date').value = ''; document.getElementById('custom-fin-start').value = ''; 
        document.getElementById('custom-fin-end').value = '';

        return showSuccessModal('เพิ่มลงตะกร้าแล้ว!', `เพิ่มวิชา ${code} สำเร็จ\n(จัดเก็บลงตะกร้าเพราะไม่ได้ระบุเวลาเรียน)`);
    }

    const dayMap = { 'MON': 'จันทร์', 'TUE': 'อังคาร', 'WED': 'พุธ', 'THU': 'พฤหัสบดี', 'FRI': 'ศุกร์', 'SAT': 'เสาร์', 'SUN': 'อาทิตย์' };
    const thaiDay = dayMap[dayVal];

    let startHour = parseInt(start.split(':')[0]);
    let endHour = parseInt(end.split(':')[0]);
    let endMin = parseInt(end.split(':')[1]);
    if (endMin > 0) endHour += 1; 

    let isOverlap = false;
    let overlapCourseName = "";
    for (let existingCourse of selectedCoursesData) {
        if (existingCourse.day === thaiDay && !existingCourse.no_time) {
            if (startHour < existingCourse.end && endHour > existingCourse.start) {
                isOverlap = true; overlapCourseName = existingCourse.code; break; 
            }
        }
    }

    if (isOverlap) return alert(`⚠️ ไม่สามารถเพิ่มวิชานี้ได้!\nเวลาเรียนทับซ้อนกับวิชา ${overlapCourseName}`);

    const formatCustomExam = (d, s, e) => {
        if (!d) return "-";
        const dateParts = d.split('-'); 
        if(dateParts.length !== 3) return "-";
        const yearTH = parseInt(dateParts[0]) + 543;
        let formattedDate = `${dateParts[2]}/${dateParts[1]}/${yearTH}`;
        let timeText = (s && e) ? ` เวลา ${s}-${e} น.` : "";
        return formattedDate + timeText;
    };

    const uniqueId = `CUSTOM_${Date.now()}`;
    selectedCourseIds.push(uniqueId);
    selectedCoursesData.push({
        id: uniqueId, code: code, name: name, credits: 0, day: thaiDay, start: startHour, end: endHour,
        custom_mid_text: formatCustomExam(midDate, midStart, midEnd),
        custom_fin_text: formatCustomExam(finDate, finStart, finEnd),
        no_time: false
    });

    updateDatabaseTimetableAndCredits();
    document.getElementById('modal-custom-course').style.display = 'none';
    
    document.getElementById('custom-code').value = ''; document.getElementById('custom-name').value = '';
    document.getElementById('custom-course-search').value = ''; document.getElementById('custom-mid-date').value = ''; 
    document.getElementById('custom-mid-start').value = ''; document.getElementById('custom-mid-end').value = '';
    document.getElementById('custom-fin-date').value = ''; document.getElementById('custom-fin-start').value = ''; 
    document.getElementById('custom-fin-end').value = '';

    showSuccessModal('เพิ่มรายวิชาสำเร็จ!', `เพิ่มวิชา ${code} ลงตารางเรียบร้อยแล้วครับ`);
};

