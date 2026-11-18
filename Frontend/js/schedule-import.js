// ==========================================
// 🚀 ฟังก์ชันดึงตารางเรียนจากเพื่อน
// ==========================================
window.confirmImportSchedule = function() {
    const targetYear = parseInt(document.getElementById('import-year').value);
    const targetSemester = parseInt(document.getElementById('import-semester').value);
    const targetKey = `${targetYear}_${targetSemester}`;

    const sharedCourseCodes = ["1101041", "IST201006", "1101911"];
    let addedCount = 0;

    if (targetYear === currentYearLevel && targetSemester === currentSemester) {
        sharedCourseCodes.forEach(courseCode => {
            const cleanCode = normalizeCourseCodeKey(courseCode);
            const foundCourse = allCourses.find(c => normalizeCourseCodeKey(c.COURSECODE) === cleanCode) || masterCourses.find(c => normalizeCourseCodeKey(c.COURSECODE) === cleanCode);
            
            if(foundCourse && !selectedCoursesData.some(c => c.code.includes(foundCourse.COURSECODE))) {
                const uniqueId = `SHARED_${foundCourse.COURSECODE}_${Date.now()}`;
                let startHour = parseInt((foundCourse.START_TIME || '09:00').split(':')[0]);
                let endHour = parseInt((foundCourse.END_TIME || '12:00').split(':')[0]);

                selectedCourseIds.push(uniqueId);
                selectedCoursesData.push({
                    id: uniqueId, code: `${foundCourse.COURSECODE} (G.${foundCourse.SECTION || '1'})`, name: foundCourse.COURSENAME,
                    credits: parseInt(String(foundCourse.COURSEUNIT).split(' ')[0]) || 0,
                    day: foundCourse.DAY_NAME || '-', start: startHour, end: endHour, no_time: !(foundCourse.START_TIME && foundCourse.END_TIME)
                });
                addedCount++;
            }
        });
        if (addedCount > 0) updateDatabaseTimetableAndCredits();
    } else {
        if (!scheduleCache[targetKey]) scheduleCache[targetKey] = { ids: [], data: [] };
        
        sharedCourseCodes.forEach(courseCode => {
            const cleanCode = normalizeCourseCodeKey(courseCode);
            const foundCourse = masterCourses.find(c => normalizeCourseCodeKey(c.COURSECODE) === cleanCode);
            
            if(foundCourse && !scheduleCache[targetKey].data.some(c => c.code.includes(foundCourse.COURSECODE))) {
                const uniqueId = `SHARED_${foundCourse.COURSECODE}_${Date.now()}`;
                scheduleCache[targetKey].ids.push(uniqueId);
                scheduleCache[targetKey].data.push({
                    id: uniqueId, code: `${foundCourse.COURSECODE} (G.${foundCourse.SECTION || '1'})`, name: foundCourse.COURSENAME,
                    credits: parseInt(String(foundCourse.COURSEUNIT).split(' ')[0]) || 0,
                    day: foundCourse.DAY_NAME || '-', start: 9, end: 12, no_time: false
                });
                addedCount++;
            }
        });
    }

    closeModal('modal-import-schedule');
    alert(addedCount > 0 ? `นำเข้าตารางเรียนไปยัง ปี ${targetYear} เทอม ${targetSemester} สำเร็จ!` : `วิชาเหล่านี้มีอยู่แล้วใน ปี ${targetYear} เทอม ${targetSemester}`);
};

