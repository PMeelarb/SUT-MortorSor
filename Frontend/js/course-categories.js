// ==========================================
// 🔍 ระบบหมวดหมู่วิชา (วิชาสาขา, เลือกเสรี, ศึกษาทั่วไป) แบบดั้งเดิมที่เสถียร 100%
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
        
        // กระตุ้นให้ช่องค้นหาแสดงข้อมูลทันทีที่กางออก
        const inputEl = content.querySelector('input');
        if (inputEl) {
            inputEl.dispatchEvent(new Event('input'));
        }
    }
};

// 2. ฟังก์ชันโหลดและคัดกรองข้อมูลเข้า Dropdown แต่ละหมวด
window.fetchAndSetupCourseCategories = async function() {
    try {
        const response = await fetch('http://localhost:3000/api/courses');
        const result = await response.json();
        
        if (result.status === 'success' && result.data) {
            let majorList = [];
            let genEdList = [];
            let freeList = [];
            
            // กรองวิชาที่ไม่มีรหัสออก ป้องกันบั๊ก
            const validCourses = result.data.filter(c => c.COURSECODE || c.coursecode);

            validCourses.forEach(course => {
                const code = String(course.COURSECODE || course.coursecode).trim().toUpperCase();
                
                // จัดหมวดหมู่วิชาตามตัวอักษรนำหน้า
                if (code.startsWith('213') || code.startsWith('202') || code.startsWith('IST') || code.startsWith('ENG') || code.startsWith('LNG') || code.startsWith('HSS')) {
                    genEdList.push(course);
                } else if (code.startsWith('106') || code.startsWith('110') || code.startsWith('205') || code.startsWith('551') || code.startsWith('DGT') || code.startsWith('SCI')) {
                    majorList.push(course);
                } else {
                    freeList.push(course);
                }
            });

            // ส่งข้อมูลลงแต่ละกล่อง
            window.setupCourseSearchBox('search-major', 'courses-major', majorList);
            window.setupCourseSearchBox('search-gen', 'courses-gen', genEdList);
            window.setupCourseSearchBox('search-free', 'courses-free', freeList);
        }
    } catch (error) {
        console.error('Error fetching course categories:', error);
    }
};

// 3. ฟังก์ชันสร้างรายการวิชาและระบบค้นหา (Search)
window.setupCourseSearchBox = function(inputId, listId, sourceArray) {
    const inputEl = document.getElementById(inputId);
    const listEl = document.getElementById(listId);
    
    if (!inputEl || !listEl) return;
    
    const renderList = (data) => {
        listEl.innerHTML = ''; 
        
        if (!data || data.length === 0) {
            listEl.innerHTML = '<div style="padding: 15px; text-align: center; color: #9ca3af; font-size: 14px;">ไม่พบรายวิชาที่ค้นหา</div>';
            return;
        }

        // โชว์แค่ 50 วิชาแรกเพื่อไม่ให้หน้าเว็บค้างตอนกางกล่อง
        const displayData = data.slice(0, 50);

        displayData.forEach(c => {
            const code = c.COURSECODE || c.coursecode || '';
            const name = c.COURSENAME || c.coursename || 'รายวิชา';
            const creditStr = c.COURSEUNIT || c.courseunit || '0';
            const section = c.SECTION || c.section || '1';
            
            let dayName = c.DAY_NAME || c.day_name || '-';
            let startTime = c.START_TIME || c.start_time || '-';
            let endTime = c.END_TIME || c.end_time || '-';

            const dayMapObj = { '1':'อาทิตย์', '2':'จันทร์', '3':'อังคาร', '4':'พุธ', '5':'พฤหัสบดี', '6':'ศุกร์', '7':'เสาร์' };
            if (dayMapObj[dayName]) dayName = dayMapObj[dayName];

            if ((startTime === '-' || !startTime) && c.TIMESLOTFROM) {
                let sH = Math.floor((c.TIMESLOTFROM - 1) * 5 / 60);
                let eH = Math.floor((c.TIMESLOTTO - 1) * 5 / 60);
                startTime = `${String(sH).padStart(2, '0')}:00`;
                endTime = `${String(eH).padStart(2, '0')}:00`;
            }

            let timeDisplay = `<i class="fa-regular fa-clock"></i> ไม่ระบุเวลา`;
            if (dayName !== '-' && dayName !== 'ไม่ระบุวัน' && startTime !== '-' && endTime !== '-') {
                timeDisplay = `<i class="fa-regular fa-clock"></i> ${dayName} ${startTime}-${endTime} น.`;
            }

            const div = document.createElement('div');
            div.className = 'course-item';
            div.style.padding = '12px 15px';
            div.style.borderBottom = '1px solid #f3f4f6';
            div.style.cursor = 'pointer';
            
            div.onmouseover = () => div.style.background = '#f9fafb';
            div.onmouseout = () => div.style.background = 'transparent';
            
            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px;">
                    <div style="flex: 1; min-width: 250px;">
                        <strong style="color: #111; font-size: 14px;">${code}</strong> 
                        <span style="color: #374151; font-size: 14px; margin-left: 5px;">${name}</span> 
                        <span style="font-size:12px; color:#6b7280; margin-left: 5px;">(${creditStr})</span>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <span style="font-size:11px; background: #e5e7eb; padding: 4px 8px; border-radius: 6px; white-space: nowrap; color: #4b5563;">
                            กลุ่ม ${section}
                        </span>
                        <span style="font-size:11px; color:#F05A28; background: #FFF4F0; padding: 4px 8px; border-radius: 6px; white-space: nowrap;">
                            ${timeDisplay}
                        </span>
                    </div>
                </div>
            `;
            
            div.onclick = () => {
                // เมื่อคลิกวิชา ให้ดึงเข้าตารางทันที!
                window.addCourseFromDropdown(c, div);
            };
            listEl.appendChild(div);
        });
    };

    // โหลดลิสต์ครั้งแรก
    renderList(sourceArray);

    // ทำงานเมื่อพิมพ์ช่องค้นหา
    inputEl.addEventListener('input', (e) => {
        const keyword = e.target.value.toLowerCase().replace(/\s+/g, '');
        if (!keyword) {
            renderList(sourceArray);
            return;
        }
        const matchedData = sourceArray.filter(c => {
            const cleanCode = String(c.COURSECODE || c.coursecode || '').toLowerCase().replace(/\s+/g, '');
            const cleanName = String(c.COURSENAME || c.coursename || '').toLowerCase();
            return cleanCode.includes(keyword) || cleanName.includes(keyword);
        });
        renderList(matchedData);
    });
};

// 4. ฟังก์ชันเพิ่มวิชาจาก Dropdown ลงตาราง + ออโต้เซฟ
window.addCourseFromDropdown = function(courseData, element) {
    const code = String(courseData.COURSECODE || courseData.coursecode || '').trim().toUpperCase();
    const name = courseData.COURSENAME || courseData.coursename || 'รายวิชา';
    const creditStr = courseData.COURSEUNIT || courseData.courseunit || '0';
    const credit = parseInt(String(creditStr).split(' ')[0]) || 0;
    
    let dayName = courseData.DAY_NAME || courseData.day_name || '-';
    let startTime = courseData.START_TIME || courseData.start_time || '-';
    let endTime = courseData.END_TIME || courseData.end_time || '-';

    const dayMapObj = { '1':'อาทิตย์', '2':'จันทร์', '3':'อังคาร', '4':'พุธ', '5':'พฤหัสบดี', '6':'ศุกร์', '7':'เสาร์' };
    if (dayMapObj[dayName]) dayName = dayMapObj[dayName];

    if ((startTime === '-' || !startTime) && courseData.TIMESLOTFROM) {
        let sH = Math.floor((courseData.TIMESLOTFROM - 1) * 5 / 60);
        let eH = Math.floor((courseData.TIMESLOTTO - 1) * 5 / 60);
        startTime = `${String(sH).padStart(2, '0')}:00`;
        endTime = `${String(eH).padStart(2, '0')}:00`;
    }

    const isExist = selectedCoursesData.some(c => c.code.replace(/\s+/g, '').toUpperCase().includes(code.replace(/\s+/g, '')));
    if (isExist) return alert(`⚠️ มีวิชา ${code} อยู่ในตารางเทอมนี้แล้วครับ`);

    let sHour = 0, eHour = 0;
    let noTimeFlag = true;

    if (startTime !== '-' && endTime !== '-' && dayName !== '-' && dayName !== 'ไม่ระบุวัน') {
        sHour = parseInt(String(startTime).split(':')[0]);
        let eHourRaw = parseInt(String(endTime).split(':')[0]);
        let eMin = parseInt(String(endTime).split(':')[1]) || 0;
        eHour = eMin > 0 ? eHourRaw + 1 : eHourRaw; 
        if (!isNaN(sHour) && !isNaN(eHour)) noTimeFlag = false; 
    }

    let isOverlap = false;
    let overlapCourseName = "";
    if (!noTimeFlag) {
        for (let existingCourse of selectedCoursesData) {
            if (existingCourse.day === dayName && !existingCourse.no_time) {
                if (sHour < existingCourse.end && eHour > existingCourse.start) {
                    isOverlap = true; 
                    overlapCourseName = existingCourse.code;
                    break;
                }
            }
        }
    }

    if (isOverlap) return alert(`⚠️ ไม่สามารถเพิ่มได้! เวลาเรียนชนกับวิชา ${overlapCourseName}`);

    const uniqueId = `DROP_${code}_${Date.now()}`;
    
    selectedCourseIds.push(uniqueId);
    selectedCoursesData.push({
        id: uniqueId, 
        code: `${code} (G.1)`, 
        name: name, 
        credits: credit, 
        day: noTimeFlag ? '-' : dayName, 
        start: noTimeFlag ? 0 : sHour, 
        end: noTimeFlag ? 0 : eHour,
        custom_mid_text: "-", custom_fin_text: "-", no_time: noTimeFlag 
    });

    // อัปเดตตาราง
    updateDatabaseTimetableAndCredits();
    
    // ออโต้เซฟลงฐานข้อมูลทันที!
    if (typeof window.saveSchedule === 'function') {
        window.saveSchedule();
    }

    // เติมเอฟเฟกต์ให้รู้ว่ากดไปแล้ว
    if (element) {
        element.style.opacity = '0.5';
        element.style.pointerEvents = 'none';
        element.style.background = '#ecfdf5';
        element.querySelector('strong').innerHTML = `<i class="fa-solid fa-check-circle" style="color: #10b981;"></i> ${code}`;
    }

    if (typeof showSuccessModal === 'function') {
        showSuccessModal('เพิ่มวิชาสำเร็จ!', `เพิ่มวิชา ${code} ลงตารางเรียบร้อยแล้ว`);
    } else {
        alert(`เพิ่มวิชา ${code} ลงตารางเรียบร้อยแล้ว`);
    }
};

// 5. สั่งให้ดึงข้อมูลวิชามาเตรียมไว้ทันทีที่โหลดหน้าเว็บเสร็จ
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        window.fetchAndSetupCourseCategories();
    }, 1500); // หน่วงเวลา 1.5 วิ ป้องกันดึงข้อมูลชนกัน
});

