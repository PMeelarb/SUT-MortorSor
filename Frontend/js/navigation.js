// ==========================================
// 🔄 ฟังก์ชันสลับหน้าเว็บ (อัปเกรดให้รองรับการล้างโหมดโปรไฟล์เพื่อน)
// ==========================================
window.switchPage = function(pageId, menuItem) {
    // ดักจับ: ถ้ากำลังดูโปรไฟล์เพื่อนอยู่ แล้วกดเมนูไปหน้าอื่น ให้คืนค่าหน้าโปรไฟล์เป็นของตัวเองทันที
    if (typeof restoreMyProfile === 'function') {
        restoreMyProfile(); 
    }
    
    // โค้ดสลับหน้าเว็บแบบเดิม
    document.querySelectorAll('.page-view').forEach(page => { page.style.display = 'none'; page.classList.remove('active'); });
    const targetPage = document.getElementById(pageId);
    if (targetPage) { targetPage.style.display = 'block'; targetPage.classList.add('active'); }
    
    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
        item.removeAttribute('aria-current');
    });
    if (menuItem) {
        menuItem.classList.add('active');
        menuItem.setAttribute('aria-current', 'page');
    }
    
    if (pageId === 'community-chat') loadChatRooms();
};

window.changeSemester = async function(direction) {
    // 1. เก็บข้อมูลเทอมเก่าลง Cache ก่อนเปลี่ยน
    let oldYear = 1, oldSem = 1;
    const activeYearTab = document.querySelector('.year-tab.active');
    if (activeYearTab) {
        const match = activeYearTab.innerText.match(/\d+/);
        if (match) oldYear = parseInt(match[0]);
    }
    const semesterTextEl = document.getElementById('semester-text');
    if (semesterTextEl) {
        const match = semesterTextEl.innerText.match(/\d+/);
        if (match) oldSem = parseInt(match[0]);
    }
    const oldKey = `${oldYear}_${oldSem}`;
    scheduleCache[oldKey] = { 
        ids: JSON.parse(JSON.stringify(selectedCourseIds)), 
        data: JSON.parse(JSON.stringify(selectedCoursesData)) 
    };

    // 2. เปลี่ยนเทอมบนหน้าจอ
    let newSem = oldSem + direction;
    if (newSem > 3) newSem = 1; 
    if (newSem < 1) newSem = 3; 
    
    if (semesterTextEl) semesterTextEl.innerText = `เทอมที่ ${newSem}`;
    window.currentSemester = newSem; 
    
    // 3. สั่งโหลดข้อมูลเทอมใหม่มาแสดง
    await window.loadSchedule();
};

// อัปเกรดระบบคลิกเปลี่ยนชั้นปี
document.addEventListener('DOMContentLoaded', () => {
    // ผูก Event ให้ปุ่มชั้นปีทั้งหมด
    document.querySelectorAll('.year-tab').forEach((tab) => {
        tab.addEventListener('click', async function() {
            // ดึงปีที่กด
            const match = this.innerText.match(/\d+/);
            const targetYear = match ? parseInt(match[0]) : 1;

            // 1. เก็บของเก่าลง Cache
            const oldKey = `${window.currentYearLevel}_${window.currentSemester}`;
            scheduleCache[oldKey] = { 
                ids: JSON.parse(JSON.stringify(selectedCourseIds)), 
                data: JSON.parse(JSON.stringify(selectedCoursesData)) 
            };

            // 2. สลับปุ่ม Active
            document.querySelectorAll('.year-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            window.currentYearLevel = targetYear;
            
            // 3. โหลดตารางใหม่
            await window.loadSchedule();
        });
    });
});
