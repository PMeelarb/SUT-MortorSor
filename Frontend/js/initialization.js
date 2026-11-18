// ==========================================
// 3. ควบคุมเมื่อโหลดหน้าเว็บ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    fetchStudentProfileOnLogin();

    document.querySelectorAll('.year-tab').forEach((tab, index) => {
        tab.addEventListener('click', function() {
            const oldKey = `${currentYearLevel}_${currentSemester}`;
            scheduleCache[oldKey] = { 
                ids: JSON.parse(JSON.stringify(selectedCourseIds)), 
                data: JSON.parse(JSON.stringify(selectedCoursesData)) 
            };

            document.querySelectorAll('.year-tab').forEach(t => t.classList.remove('active'));
            this.classList.add('active');
            
            currentYearLevel = index + 1; 
            loadSchedule(); 
        });
    });

    checkUserSession(); 

    const saveProfileBtn = document.getElementById('save-profile-btn');
    if (saveProfileBtn) saveProfileBtn.addEventListener('click', saveProfile);
    const saveScheduleBtn = document.getElementById('save-schedule-btn');
    if (saveScheduleBtn) saveScheduleBtn.addEventListener('click', saveSchedule);
    const autoPlanBtn = document.getElementById('auto-plan-btn');
    if (autoPlanBtn) autoPlanBtn.addEventListener('click', handleAutoRecommend);

    initReviewSystem();

    fetchCourses().then(() => {
        if (typeof updateSelectedCoursesCart === 'function') updateSelectedCoursesCart();
    });

    if(typeof window.setupCustomCourseAutocomplete === 'function'){
        window.setupCustomCourseAutocomplete();
    }
});
async function fetchStudentProfileOnLogin() {
    const loggedInStudentId = localStorage.getItem('sut_student_id') || '';
    
    if (loggedInStudentId) {
        if (document.getElementById('display-student-id')) document.getElementById('display-student-id').innerText = loggedInStudentId;
        if (document.getElementById('display-profile-name')) document.getElementById('display-profile-name').innerText = loggedInStudentId;

        const yearMatch = loggedInStudentId.match(/[a-zA-Z](\d{2})/);
        if (yearMatch) {
            const admitYear = 2500 + parseInt(yearMatch[1]);
            const currentYear = new Date().getFullYear() + 543;
            let calculated = currentYear - admitYear + 1;
            let yearStr = calculated > 0 ? calculated.toString() : '1';
            if(document.getElementById('profile-year-level')) document.getElementById('profile-year-level').value = `${yearStr}`;
            currentYearLevel = parseInt(yearStr); // อัปเดตตัวแปรกลางด้วย
        }

        // โหลดภาพพื้นหลังและรูปโปรไฟล์ที่เคยบันทึกไว้ขึ้นมาแสดงทันที
        const savedBg = localStorage.getItem(`sut_bg_${loggedInStudentId}`);
        if (savedBg) {
            const bgContainer = document.getElementById('profile-bg-container');
            if (bgContainer) {
                bgContainer.style.backgroundImage = `url(${savedBg})`;
                bgContainer.style.backgroundSize = 'cover';
                bgContainer.style.backgroundPosition = 'center';
            }
        }

        const savedAvatar = localStorage.getItem(`sut_avatar_${loggedInStudentId}`);
        if (savedAvatar) {
            const avatarImg = document.getElementById('profile-avatar-img');
            const defaultIcon = document.getElementById('default-avatar-icon');
            if (avatarImg && defaultIcon) {
                avatarImg.src = savedAvatar;
                avatarImg.style.display = 'block';
                defaultIcon.style.display = 'none';
            }
        }
    }

    try {
        if (!loggedInStudentId) return;

        const { data, error } = await supabaseClient.from('profiles').select('*').eq('student_id', loggedInStudentId).maybeSingle();
        
        if (data) {
            const fullName = `${data.first_name || ''} ${data.last_name || ''}`.trim();
            if(document.getElementById('profile-fullname')) document.getElementById('profile-fullname').value = fullName;
            if(document.getElementById('display-profile-name')) document.getElementById('display-profile-name').innerText = fullName || loggedInStudentId;
            if(document.getElementById('profile-faculty')) document.getElementById('profile-faculty').value = data.faculty || '';
            if(document.getElementById('profile-major')) document.getElementById('profile-major').value = data.major || '';

            // เก็บค่าสาขาไว้ใช้ส่งหา AI
            selectedMajor = data.major || '';

            if(document.getElementById('profile-age')) document.getElementById('profile-age').value = data.age || '';
            if(document.getElementById('profile-freetime')) document.getElementById('profile-freetime').value = data.free_time || '';
            if(document.getElementById('profile-mbti')) document.getElementById('profile-mbti').value = data.mbti || '';
            if(document.getElementById('profile-learning-style')) document.getElementById('profile-learning-style').value = data.learning_style || '';
            if(document.getElementById('profile-social')) document.getElementById('profile-social').value = data.social_media || '';
        } else {
            // 🔥 ป้องกันบัคบัญชีใหม่: ถ้าดึงข้อมูลไม่ได้ ให้พยายามดูดค่าจากหน้าจอมาใช้ก่อน
            const screenMajor = document.getElementById('profile-major');
            if (screenMajor && screenMajor.value && screenMajor.value !== 'ดึงข้อมูลจากระบบ...') {
                selectedMajor = screenMajor.value;
            } else {
                // ถ้าหน้าจอก็ว่าง ให้ตั้งค่า Default ที่จะทำให้ระบบไม่พัง
                selectedMajor = "วิศวกรรมคอมพิวเตอร์"; // ตัวอย่างค่าตั้งต้น เผื่อผู้ใช้ไม่ยอมกรอก
            }
        }
    } catch (error) {
        console.error("Profile load error:", error);
    }
}
