// ==========================================
// 3. ควบคุมเมื่อโหลดหน้าเว็บ
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    window.studentAuthReady = checkUserSession();
    window.studentSessionReady = window.studentAuthReady.then(async ready => {
        if (!ready) return false;
        await fetchStudentProfileOnLogin();
        return Boolean(verifiedStudentSession);
    });
    if (!await window.studentSessionReady) return;

    loadSchedule();
    document.body.inert = false;

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

let loadedStudentProfileId = null;
let viewedFriendProfileId = null;
const ownProfileFields = 'student_id,first_name,last_name,faculty,major,age,free_time,mbti,learning_style,social_media';

function fetchStudentProfileOnLogin() {
    window.aiProfileReady = loadStudentProfileForSession();
    return window.aiProfileReady;
}

function setStudentProfileNotice(message) {
    const notice = document.getElementById('profile-load-notice');
    if (notice) notice.hidden = !message;
    const text = document.getElementById('profile-load-message');
    if (text) text.textContent = message;
}

async function loadStudentProfileForSession() {
    const identity = verifiedStudentSession;
    const loggedInStudentId = identity?.studentId || '';
    loadedStudentProfileId = null;
    window.aiAcademicProfile = { faculty: '', major: '' };
    selectedMajor = '';
    const saveButton = document.getElementById('save-profile-btn');
    if (saveButton) saveButton.disabled = true;
    if (!loggedInStudentId) return;
    setStudentProfileNotice('กำลังโหลดโปรไฟล์จาก Supabase…');

    const reported = identity.reportedStudentId ?? loggedInStudentId;
    const displayId = reported || 'บัญชีส่วนตัว';
    const headerId = document.getElementById('display-student-id');
    const profileName = document.getElementById('display-profile-name');
    if (headerId) headerId.textContent = displayId;
    if (profileName) profileName.textContent = displayId;

    const yearMatch = reported.match(/^[A-Z](\d{2})/i);
    const yearInput = document.getElementById('profile-year-level');
    if (yearMatch) {
        const admitYear = 2500 + Number(yearMatch[1]);
        const currentYear = new Date().getFullYear() + 543;
        currentYearLevel = Math.max(1, currentYear - admitYear + 1);
        if (yearInput) yearInput.value = String(currentYearLevel);
    }

    // โหลดภาพพื้นหลังและรูปโปรไฟล์ที่เคยบันทึกไว้ขึ้นมาแสดงทันที
    const savedBg = localStorage.getItem(`sut_bg_${loggedInStudentId}`);
    const bgContainer = document.getElementById('profile-bg-container');
    if (bgContainer) {
        bgContainer.style.backgroundImage = savedBg ? `url(${savedBg})` : '';
        bgContainer.style.backgroundSize = 'cover';
        bgContainer.style.backgroundPosition = 'center';
    }
    const savedAvatar = localStorage.getItem(`sut_avatar_${loggedInStudentId}`);
    const avatarImg = document.getElementById('profile-avatar-img');
    const defaultIcon = document.getElementById('default-avatar-icon');
    if (avatarImg && defaultIcon) {
        if (savedAvatar) avatarImg.src = savedAvatar;
        avatarImg.style.display = savedAvatar ? 'block' : 'none';
        defaultIcon.style.display = savedAvatar ? 'none' : '';
    }

    let stage = 'อ่านโปรไฟล์';
    try {
        const readOwnProfile = () => supabaseClient.from('profiles').select(ownProfileFields)
            .eq('student_id', loggedInStudentId).maybeSingle();
        let { data, error } = await readOwnProfile();
        let registrationOnly = false;
        if (verifiedStudentSession !== identity) return;
        if (error) throw error;
        if (!data && identity.selfService) {
            stage = 'เตรียมโปรไฟล์';
            const { data: profileKey, error: provisionError } = await supabaseClient.rpc('ensure_self_service_profile');
            if (verifiedStudentSession !== identity) return;
            if (provisionError?.code === 'PGRST202' && identity.registrationProfile) {
                data = identity.registrationProfile;
                registrationOnly = true;
            } else {
                if (provisionError) throw provisionError;
                if (profileKey !== loggedInStudentId) throw { code: 'PROFILE_KEY_MISMATCH' };
                stage = 'อ่านโปรไฟล์';
                ({ data, error } = await readOwnProfile());
                if (verifiedStudentSession !== identity) return;
                if (error) throw error;
            }
        }
        if (!data) throw { code: 'PROFILE_NOT_FOUND' };

        // The profile form also displays friends. AI context uses the signed-in row.
        if (!registrationOnly) {
            window.aiAcademicProfile = {
                faculty: data.faculty || '', major: data.major || '',
                yearLevel: Number(yearInput?.value) || null
            };
            selectedMajor = data.major || '';
        }
        if (viewedFriendProfileId) return;
        const fullName = `${data.first_name || ''} ${data.last_name || ''}`.trim();
        if (profileName) profileName.textContent = fullName || displayId;
        const canEditAcademicFields = identity.selfService && !registrationOnly;
        const academicFields = { 'profile-fullname': fullName, 'profile-faculty': data.faculty, 'profile-major': data.major };
        for (const [id, value] of Object.entries(academicFields)) {
            const field = document.getElementById(id);
            if (field) {
                field.value = value || '';
                field.readOnly = !canEditAcademicFields;
                field.placeholder = canEditAcademicFields ? 'กรอกข้อมูล' : 'ยังไม่มีข้อมูล';
            }
        }
        const personalFields = { 'profile-age': data.age, 'profile-freetime': data.free_time, 'profile-mbti': data.mbti,
            'profile-learning-style': data.learning_style, 'profile-social': data.social_media };
        for (const [id, value] of Object.entries(personalFields)) {
            const field = document.getElementById(id);
            if (field) {
                field.value = value ?? '';
                field.readOnly = registrationOnly;
            }
        }
        if (registrationOnly) {
            setStudentProfileNotice('แสดงข้อมูลที่ลงทะเบียนไว้ การแก้ไขโปรไฟล์ยังไม่พร้อมใช้งาน (PGRST202)');
            return;
        }
        loadedStudentProfileId = loggedInStudentId;
        if (saveButton) saveButton.disabled = false;
        setStudentProfileNotice('');
    } catch (error) {
        if (verifiedStudentSession !== identity || viewedFriendProfileId) return;
        const code = typeof error?.code === 'string' && /^(?:[A-Z0-9]{5}|PGRST\d{3}|PROFILE_(?:NOT_FOUND|KEY_MISMATCH))$/.test(error.code)
            ? error.code : 'PROFILE_UNAVAILABLE';
        setStudentProfileNotice(`Supabase ${stage}ไม่สำเร็จ (${code})`);
    }
}
