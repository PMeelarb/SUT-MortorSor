// ==========================================
// 🚀 ฟังก์ชันแสดงหน้าต่างออกจากระบบแบบใหม่
// ==========================================
window.logoutUser = function(event) {
    if (event) event.preventDefault(); // ป้องกันการ reload หน้า
    
    // เรียกแสดง Modal แบบสวยงาม
    const modal = document.getElementById('modal-logout-confirm');
    if (modal) {
        modal.style.display = 'flex';
    } else {
        // Fallback ถ้าหา Modal ไม่เจอ
        if (confirm('ต้องการออกจากระบบใช่หรือไม่?')) {
            executeLogout();
        }
    }
};

// ฟังก์ชันสำหรับสั่งลบ Session และกลับหน้า Login จริงๆ (ผูกไว้กับปุ่มสีส้มใน Modal)
window.executeLogout = function() {
    localStorage.removeItem('sut_student_id');
    
    // ลบการจำสถานะ (ถ้าต้องการเคลียร์ให้เกลี้ยง)
    // localStorage.removeItem('pinned_chats_' + localStorage.getItem('sut_student_id'));
    
    // พาไปหน้า Login
    window.location.href = 'auth.html';
};

