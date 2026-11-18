
// กำหนดค่าเริ่มต้นของระบบจัดตารางเรียน
window.currentYearLevel = 1;
window.currentSemester = 1;

// โหลดตารางเรียนเมื่อเปิดเว็บไซต์
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (typeof window.loadSchedule === 'function') {
            window.loadSchedule();
        }
    }, 500);
});
