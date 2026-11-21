let verifiedStudentSession = null;

function closeStudentPage(destination = 'auth.html') {
    const studentId = verifiedStudentSession?.studentId;
    verifiedStudentSession = null;
    document.body.inert = true;
    if (!studentId || localStorage.getItem('sut_student_id') === studentId) {
        localStorage.removeItem('sut_student_id');
    }
    window.location.replace(destination);
    return false;
}

async function checkUserSession() {
    try {
        const { data, error } = await supabaseClient.auth.getUser();
        const identity = studentSessionIdentity(data?.user);
        if (error || !identity) return closeStudentPage();
        verifiedStudentSession = identity;
        localStorage.setItem('sut_student_id', identity.studentId);
        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (!verifiedStudentSession) return;
            if (event === 'SIGNED_OUT' || !session) {
                closeStudentPage();
            } else if (session.user?.id !== verifiedStudentSession.userId
                || (['TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)
                    && studentSessionIdentity(session.user)?.studentId !== verifiedStudentSession.studentId)) {
                closeStudentPage('index.html');
            }
        });
        return Boolean(verifiedStudentSession);
    } catch {
        return closeStudentPage();
    }
}

// ==========================================
// 1. ฟังก์ชันบันทึกข้อมูลส่วนตัวลงฐานข้อมูลจริง
// ==========================================
async function saveProfile() { 
    const studentId = verifiedStudentSession?.studentId;
    if (!studentId) return window.showAppNotice('กรุณาเข้าสู่ระบบก่อนทำการบันทึกครับ');
    if (viewedFriendProfileId || loadedStudentProfileId !== studentId) {
        return window.showAppNotice('ขณะนี้ยังไม่สามารถบันทึกโปรไฟล์ได้ครับ');
    }

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
    const details = { age, free_time: freeTime, mbti, learning_style: learningStyle, social_media: socialMedia };
    if (verifiedStudentSession.selfService) {
        const fullName = document.getElementById('profile-fullname')?.value.trim() || '';
        const space = fullName.indexOf(' ');
        details.first_name = space === -1 ? fullName : fullName.slice(0, space);
        details.last_name = space === -1 ? '' : fullName.slice(space + 1).trim();
        details.faculty = document.getElementById('profile-faculty')?.value.trim() || '';
        details.major = document.getElementById('profile-major')?.value.trim() || '';
    }

    try {
        // ส่งข้อมูลขึ้น Supabase
        const { data, error } = await supabaseClient
            .from('profiles')
            .update(details)
            .eq('student_id', studentId)
            .select('student_id')
            .maybeSingle();

        if (error) throw error;
        if (verifiedStudentSession?.studentId !== studentId) return;
        if (data?.student_id !== studentId) throw new Error('ฐานข้อมูลไม่ได้ยืนยันการบันทึกโปรไฟล์');
        if (!viewedFriendProfileId && verifiedStudentSession?.selfService && verifiedStudentSession.studentId === studentId) {
            await fetchStudentProfileOnLogin();
        }
        if (verifiedStudentSession?.studentId === studentId && typeof refreshAIWelcome === 'function') refreshAIWelcome();
        
        // เซฟเสร็จแล้วค่อยเด้งแจ้งเตือน
        showSuccessModal('สำเร็จ!', 'บันทึกข้อมูลส่วนตัวลงระบบเรียบร้อยแล้ว');
    } catch {
        window.showAppNotice('บันทึกข้อมูลไม่สำเร็จ กรุณาลองอีกครั้งครับ');
    } finally {
        // คืนค่าปุ่มกลับเป็นเหมือนเดิม
        btn.innerHTML = originalText;
        btn.disabled = loadedStudentProfileId !== studentId;
    }
}

