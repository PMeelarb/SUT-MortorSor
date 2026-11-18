async function checkUserSession() {
    const studentId = localStorage.getItem('sut_student_id');
    if (!studentId) { window.location.href = 'auth.html'; return; }
    loadSchedule();
}

// ==========================================
// 1. ฟังก์ชันบันทึกข้อมูลส่วนตัวลงฐานข้อมูลจริง
// ==========================================
async function saveProfile() { 
    const studentId = localStorage.getItem('sut_student_id');
    if (!studentId) return alert('กรุณาเข้าสู่ระบบก่อนทำการบันทึกครับ');

    const btn = document.getElementById('save-profile-btn');
    if (!btn) return;
    
    // เปลี่ยนสถานะปุ่มตอนกำลังเซฟ
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';
    btn.disabled = true;

    // ดึงข้อมูลจากหน้าจอ
    const age = document.getElementById('profile-age') ? document.getElementById('profile-age').value : '';
    const freeTime = document.getElementById('profile-freetime') ? document.getElementById('profile-freetime').value : '';
    const mbti = document.getElementById('profile-mbti') ? document.getElementById('profile-mbti').value : '';
    const learningStyle = document.getElementById('profile-learning-style') ? document.getElementById('profile-learning-style').value : '';
    const socialMedia = document.getElementById('profile-social') ? document.getElementById('profile-social').value : '';

    try {
        // ส่งข้อมูลขึ้น Supabase
        const { error } = await supabaseClient
            .from('profiles')
            .update({
                age: age,
                free_time: freeTime,
                mbti: mbti,
                learning_style: learningStyle,
                social_media: socialMedia
            })
            .eq('student_id', studentId);

        if (error) throw error;
        
        // เซฟเสร็จแล้วค่อยเด้งแจ้งเตือน
        showSuccessModal('สำเร็จ!', 'บันทึกข้อมูลส่วนตัวลงระบบเรียบร้อยแล้ว');
    } catch (error) {
        console.error("Save profile error:", error);
        alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + error.message);
    } finally {
        // คืนค่าปุ่มกลับเป็นเหมือนเดิม
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}

