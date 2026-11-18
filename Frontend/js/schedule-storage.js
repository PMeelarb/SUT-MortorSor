// ==========================================
// 💾 ระบบเปลี่ยนเทอม & บันทึกตารางเรียน (แยกปี/เทอม 100%)
// ==========================================

window.saveSchedule = async function() {
    const studentId = localStorage.getItem('sut_student_id');
    if (!studentId) return alert('กรุณาเข้าสู่ระบบก่อนครับ');
    
    // 🎯 ดึงปีและเทอมจากหน้าจอ ณ ปัจจุบันโดยตรง (รับประกันไม่เพี้ยน)
    let targetYear = 1, targetSem = 1;
    const activeYearTab = document.querySelector('.year-tab.active');
    if (activeYearTab) {
        const match = activeYearTab.innerText.match(/\d+/);
        if (match) targetYear = parseInt(match[0]);
    }
    const semesterTextEl = document.getElementById('semester-text');
    if (semesterTextEl) {
        const match = semesterTextEl.innerText.match(/\d+/);
        if (match) targetSem = parseInt(match[0]);
    }

    try {
        const safeData = JSON.parse(JSON.stringify(selectedCoursesData));
        
        // ลบของเก่าของเทอมนี้ทิ้ง แล้วเซฟของใหม่ทับ
        await supabaseClient.from('user_schedules').delete().match({ student_id: studentId, year_level: targetYear, semester: targetSem });
        const { error } = await supabaseClient.from('user_schedules').insert([{ student_id: studentId, year_level: targetYear, semester: targetSem, course_ids: safeData }]);
        if (error) throw error;

        // อัปเดตความจำ (Cache) ของเบราว์เซอร์
        const currentKey = `${targetYear}_${targetSem}`;
        scheduleCache[currentKey] = { 
            ids: JSON.parse(JSON.stringify(selectedCourseIds)), 
            data: JSON.parse(JSON.stringify(selectedCoursesData)) 
        };

        if(typeof showSuccessModal === 'function') {
            showSuccessModal('บันทึกตารางเรียนสำเร็จ!', `จัดเก็บตารางเรียนของ ปี ${targetYear} เทอม ${targetSem} เรียบร้อยแล้ว`);
        } else {
            alert(`บันทึกตารางเรียนของ ปี ${targetYear} เทอม ${targetSem} สำเร็จ!`);
        }
    } catch (error) { 
        console.error("Save Error:", error); 
        alert('เกิดข้อผิดพลาดในการบันทึก: ' + error.message);
    }
};

window.loadSchedule = async function() {
    const studentId = localStorage.getItem('sut_student_id');
    if (!studentId) return;

    // 🎯 ดึงปีและเทอมจากหน้าจอ
    let targetYear = 1, targetSem = 1;
    const activeYearTab = document.querySelector('.year-tab.active');
    if (activeYearTab) {
        const match = activeYearTab.innerText.match(/\d+/);
        if (match) targetYear = parseInt(match[0]);
    }
    const semesterTextEl = document.getElementById('semester-text');
    if (semesterTextEl) {
        const match = semesterTextEl.innerText.match(/\d+/);
        if (match) targetSem = parseInt(match[0]);
    }

    const currentKey = `${targetYear}_${targetSem}`;
    window.currentYearLevel = targetYear;
    window.currentSemester = targetSem;

    // 🧹 ล้างตารางหน้าจอให้โล่งทันทีที่เปลี่ยนเทอม! (กันข้อมูลเทอมเก่าค้าง)
    selectedCourseIds = [];
    selectedCoursesData = [];

    // ถ้ามีความจำใน Cache ให้โหลดมาใช้
    if (scheduleCache[currentKey]) {
        selectedCourseIds = JSON.parse(JSON.stringify(scheduleCache[currentKey].ids));
        selectedCoursesData = JSON.parse(JSON.stringify(scheduleCache[currentKey].data));
        updateDatabaseTimetableAndCredits();
        return;
    }

    updateDatabaseTimetableAndCredits(); // วาดตารางเปล่าๆ โชว์ไปก่อนถ้ายังไม่มีข้อมูล

    try {
        const { data, error } = await supabaseClient
            .from('user_schedules')
            .select('course_ids')
            .eq('student_id', studentId)
            .eq('year_level', targetYear)
            .eq('semester', targetSem)
            .maybeSingle();

        if (error) throw error;

        if (data && data.course_ids && data.course_ids.length > 0) {
            selectedCoursesData = JSON.parse(JSON.stringify(data.course_ids));
            selectedCourseIds = selectedCoursesData.map(c => c.id);
            
            // เก็บลง Cache
            scheduleCache[currentKey] = { 
                ids: JSON.parse(JSON.stringify(selectedCourseIds)), 
                data: JSON.parse(JSON.stringify(selectedCoursesData)) 
            };
        }
        updateDatabaseTimetableAndCredits(); // วาดตารางใหม่พร้อมข้อมูล
    } catch (error) {
        console.error("Load Error:", error);
        updateDatabaseTimetableAndCredits();
    }
};

