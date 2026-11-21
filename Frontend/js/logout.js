// ==========================================
// 🚀 ฟังก์ชันแสดงหน้าต่างออกจากระบบแบบใหม่
// ==========================================
window.logoutUser = async function(event) {
    event?.preventDefault();
    if (logoutPending) return;
    if (await window.confirmAppAction('ข้อมูลตารางเรียนที่ยังไม่ได้บันทึกอาจสูญหาย', {
        title: 'ออกจากระบบ', confirmText: 'ออกจากระบบ'
    })) await window.executeLogout();
};

let logoutPending = false;
window.executeLogout = async function() {
    if (logoutPending) return;
    logoutPending = true;
    try {
        const { error } = await supabaseClient.auth.signOut({ scope: 'local' });
        // Local sign-out can clear the browser session even if Supabase could
        // not revoke the refresh token remotely.
        if (error) {
            const session = await supabaseClient.auth.getSession();
            if (session.error || session.data?.session) {
                window.showAppNotice('ออกจากระบบไม่สำเร็จ กรุณาลองใหม่ครับ');
                return;
            }
        }
        if (verifiedStudentSession) closeStudentPage();
    } catch {
        window.showAppNotice('ออกจากระบบไม่สำเร็จ กรุณาลองใหม่ครับ');
    } finally {
        logoutPending = false;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('logout-btn')?.addEventListener('click', window.logoutUser);
});

