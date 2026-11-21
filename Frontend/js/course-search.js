// ==========================================
// ฟังก์ชันสำหรับค้นหาและทำ Dropdown (อัปเดต: โชว์รายชื่อทั้งหมดทันที ไม่ให้ซ่อนตัว)
// ==========================================
function setupCourseSearch(inputId, listId, sourceArray) {
    const inputEl = document.getElementById(inputId);
    const listEl = document.getElementById(listId);
    
    // ตรวจสอบความถูกต้องของ ID หน้าเว็บ ถ้าหาไม่เจอให้แจ้งเตือนใน Console
    if (!inputEl || !listEl) {
        console.error(`⚠️ หาช่องค้นหาไม่เจอ: input=${inputId}, list=${listId}`);
        return;
    }

    // บังคับให้กล่องแสดงผลเตรียมรอไว้เลย
    listEl.style.display = 'block';

    const renderList = (data) => {
        listEl.innerHTML = ''; 
        
        if (!data || data.length === 0) {
            listEl.innerHTML = '<div style="padding: 15px; text-align: center; color: #9ca3af; font-size: 14px;">ไม่พบรายวิชาที่ค้นหาในหมวดหมู่นี้</div>';
            return;
        }

        data.forEach(c => {
            const code = c.COURSECODE || c.coursecode || '';
            const name = c.COURSENAME || c.coursename || '';
            const credit = c.COURSEUNIT || c.courseunit || '-';
            const section = c.SECTION || c.section || '1';
            const dayName = c.DAY_NAME || c.day_name || 'ไม่ระบุวัน';
            const startTime = c.START_TIME || c.start_time || '-';
            const endTime = c.END_TIME || c.end_time || '-';
            
            let timeDisplay = `<i class="fa-regular fa-clock"></i> ไม่ระบุเวลา`;
            if (dayName !== 'ไม่ระบุวัน' && startTime !== '-' && endTime !== '-') {
                 timeDisplay = `<i class="fa-regular fa-clock"></i> ${dayName} ${startTime}-${endTime}`;
            }

            const div = document.createElement('div');
            div.className = 'course-item';
            div.style.padding = '12px 15px';
            div.style.borderBottom = '1px solid #f3f4f6';
            div.style.cursor = 'pointer';
            div.style.transition = 'background 0.2s';
            
            div.onmouseover = () => div.style.background = '#f9fafb';
            div.onmouseout = () => div.style.background = 'transparent';
            
            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px;">
                    <div style="flex: 1; min-width: 250px;">
                        <strong style="color: #111; font-size: 14px;">${code}</strong> 
                        <span style="color: #374151; font-size: 14px; margin-left: 5px;">${name}</span> 
                        <span style="font-size:12px; color:#6b7280; margin-left: 5px;">(${credit})</span>
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
                inputEl.value = `${code} ${name}`;
                // เมื่อคลิกแล้วสามารถดึงข้อมูลลงตารางได้ที่นี่
            };
            listEl.appendChild(div);
        });
    };

    // แสดงรายชื่อทั้งหมดขึ้นมาทันทีเมื่อโหลดเสร็จ
    renderList(sourceArray);

    // ดักจับการพิมพ์เพื่อค้นหา (Autocomplete)
    inputEl.addEventListener('input', (e) => {
        const keyword = e.target.value.toLowerCase().replace(/\s+/g, '');
        if (!keyword) {
            renderList(sourceArray);
            return;
        }
        const matchedData = sourceArray.filter(c => {
            const cleanCode = (c.COURSECODE || c.coursecode || '').toLowerCase().replace(/\s+/g, '');
            const cleanName = (c.COURSENAME || c.coursename || '').toLowerCase();
            return cleanCode.includes(keyword) || cleanName.includes(keyword);
        });
        renderList(matchedData);
    });
}
function updateDatabaseTimetableAndCredits() {
    let totalCredits = 0;
    const uniqueCourseCodes = new Set();
    selectedCoursesData.forEach(c => {
        const baseCode = c.code.split(' ')[0];
        if (!uniqueCourseCodes.has(baseCode)) {
            uniqueCourseCodes.add(baseCode);
            totalCredits += c.credits;
        }
    });
    
    const tcText = document.getElementById('total-credits-text');
    if (tcText) tcText.innerText = `รวม ${totalCredits} หน่วยกิต`;
    drawTimetableGrid(selectedCoursesData);
    updateSelectedCoursesCart();
    if (typeof window.refreshPlanNotice === 'function') window.refreshPlanNotice();
}

