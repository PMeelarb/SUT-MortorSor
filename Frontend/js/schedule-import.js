// ==========================================
// 🚀 ฟังก์ชันดึงตารางเรียนจากเพื่อน
// The previous version ignored the friend's data and inserted three hardcoded
// course codes with an invented 09:00–12:00 time and section 1. No verified
// source for a friend's timetable exists here yet, so the import refuses
// clearly instead of creating schedule rows. Use schedule sharing instead.
// ==========================================
window.confirmImportSchedule = function() {
    if (typeof closeModal === 'function') closeModal('modal-import-schedule');
    window.showAppNotice('ยังนำเข้าตารางเรียนจากเพื่อนไม่ได้ เพราะยังไม่มีแหล่งข้อมูลตารางของเพื่อนที่ตรวจสอบได้ ระบบจึงไม่เพิ่มวิชาหรือเวลาเรียนใด ๆ');
    return false;
};
