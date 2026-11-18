// ==========================================
// 2. ฟังก์ชันดึงข้อมูลวิชาหลัก (แยกระบบป้องกันบั๊กชนกัน)
// ==========================================
async function fetchCourses() {
    // ส่วนที่ 1: ดึงข้อมูลตารางเรียน (ถ้าดึงไม่ได้ ให้ข้ามไปเลย ห้ามพาเว็บพัง)
    try {
        const timetableUrl = `http://localhost:3000/api/timetable?acadyear=2569&semester=${currentSemester}`;
        const response = await fetch(timetableUrl, { headers: { 'ngrok-skip-browser-warning': 'true' } });
        if (response.ok) {
            const result = await response.json();
            allCourses = extractRows(result).map(normalizeCourseRow).filter(c => c.COURSECODE);
        } else {
            allCourses = [];
        }
    } catch (error) {
        console.warn('⚠️ ข้ามการดึงตารางเรียนส่วนแรก:', error.message);
        allCourses = [];
    }

    // ส่วนที่ 2: ดึงข้อมูลวิชาทั้งหมดเข้าช่องค้นหา (แยก Try-Catch ทำงานอิสระ 100%)
    try {
        const masterRes = await fetch(`http://localhost:3000/api/courses`);
        if (masterRes.ok) {
            const masterResult = await masterRes.json();
            
            // แปลงข้อมูลให้สะอาดและดึงเฉพาะข้อมูลที่ใช้งานได้
            masterCourses = extractRows(masterResult).map(normalizeCourseRow).filter(c => c.COURSECODE);

            if (masterCourses.length > 0) {
                let majorList = [];
                let genEdList = [];
                let freeList = [];

                // คัดแยกหมวดหมู่วิชา
                masterCourses.forEach(course => {
                    const code = String(course.COURSECODE).trim().toUpperCase();
                    
                    if (code.startsWith('213') || code.startsWith('202') || code.startsWith('IST') || code.startsWith('ENG') || code.startsWith('LNG') || code.startsWith('HSS')) {
                        genEdList.push(course);
                    } else if (code.startsWith('106') || code.startsWith('110') || code.startsWith('205') || code.startsWith('551') || code.startsWith('DGT')) {
                        majorList.push(course);
                    } else {
                        freeList.push(course);
                    }
                });

                // ยัดข้อมูลที่คัดแยกแล้วลงในช่องค้นหาแต่ละช่อง
                if (typeof setupCourseSearch === 'function') {
                    setupCourseSearch('search-major', 'courses-major', majorList);
                    setupCourseSearch('search-gen', 'courses-gen', genEdList);
                    setupCourseSearch('search-free', 'courses-free', freeList);
                }
            }
        }
    } catch (error) {
        console.error('❌ ดึงรายวิชาเข้าช่องค้นหาไม่สำเร็จ:', error);
    }
}
