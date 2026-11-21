"use strict";

// ==========================================
// 1. ตั้งค่าการเชื่อมต่อ Supabase
// ==========================================
const { url: supabaseUrl, publishableKey: supabaseKey } = window.sutSupabaseConfig || {};
// 🚀 แก้ไข: เปลี่ยนชื่อเป็น supabaseClient เพื่อไม่ให้ชนกับระบบ
const supabaseClient = supabaseUrl && supabaseKey && window.supabase
    ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;

// ==========================================
// ฟังก์ชันสลับหน้าต่าง (Login / Register / Forgot)
// ==========================================
function switchAuthView(viewId) {
    const views = document.querySelectorAll('.auth-view');
    views.forEach(view => view.classList.remove('active'));
    const targetView = document.getElementById(viewId);
    if (targetView) targetView.classList.add('active');
}

// ==========================================
// ฟังก์ชันสลับการแสดงผลรหัสผ่าน (เปิด/ปิดตา)
// ==========================================
function togglePassword(inputId, iconId) {
    const passwordInput = document.getElementById(inputId);
    const toggleIcon = document.getElementById(iconId);

    if (!passwordInput || !toggleIcon) return;

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleIcon.classList.remove('fa-eye');
        toggleIcon.classList.add('fa-eye-slash');
    } else {
        passwordInput.type = 'password';
        toggleIcon.classList.remove('fa-eye-slash');
        toggleIcon.classList.add('fa-eye');
    }
}

// ==========================================
// 2. ระบบดึงข้อมูล สำนัก/สาขา จาก Oracle
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    if (!supabaseClient) return;
    const facultySelect = document.getElementById('register-faculty');
    const majorSelect = document.getElementById('register-major');
    
    let universityData = {}; 

    if (facultySelect && majorSelect) {
        try {
            // 🔥 แก้ไข: เติม /api/programs ให้สมบูรณ์
            const response = await fetch('http://localhost:3000/api/programs');
            const result = await response.json();
            
            if (result.status === 'success') {
                universityData = result.data;
                
                if (Array.isArray(universityData)) {
                    facultySelect.innerHTML = '<option value="" disabled selected>⚠️ กรุณารีสตาร์ทเซิร์ฟเวอร์ Backend ครับ!</option>';
                    return;
                }

                facultySelect.innerHTML = '<option value="" disabled selected>-- เลือกสำนักวิชาของคุณ --</option>';
                Object.keys(universityData).sort().forEach(faculty => {
                    const option = document.createElement('option');
                    option.value = faculty;
                    option.textContent = faculty;
                    facultySelect.appendChild(option);
                });

                facultySelect.addEventListener('change', function() {
                    const selectedFaculty = this.value;
                    majorSelect.disabled = false;
                    majorSelect.innerHTML = '<option value="" disabled selected>-- เลือกสาขาวิชาของคุณ --</option>';
                    
                    const majors = universityData[selectedFaculty] || [];
                    majors.forEach(major => {
                        const option = document.createElement('option');
                        option.value = major;
                        option.textContent = major;
                        majorSelect.appendChild(option);
                    });
                });
            } else {
                facultySelect.innerHTML = `<option value="" disabled selected>❌ ${result.error}</option>`;
            }
        } catch (error) {
            console.error("Error loading programs:", error);
            facultySelect.innerHTML = '<option value="" disabled selected>❌ โหลดข้อมูลล้มเหลว โปรดตรวจสอบ Backend</option>';
        }
    }
});

// ==========================================
// 3. ระบบสมัครสมาชิก & เข้าสู่ระบบ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('form-login');
    const registerForm = document.getElementById('form-register');
    const forgotForm = document.getElementById('form-forgot');
    if (!supabaseClient) {
        for (const form of [loginForm, registerForm, forgotForm]) {
            const submit = form?.querySelector('button[type="submit"]');
            if (submit) submit.disabled = true;
        }
        window.showAppNotice('กรุณาตั้งค่า Frontend/supabase.local.js และลองโหลดหน้าใหม่', { title: 'ระบบบัญชียังไม่พร้อม' });
        return;
    }
    
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const button = loginForm.querySelector('button[type="submit"]');
            if (button.disabled) return;
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password');
            const label = button.textContent;
            button.disabled = true;
            button.textContent = 'กำลังเข้าสู่ระบบ…';
            try {
                const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: password.value });
                if (error || !data?.session) {
                    window.showAppNotice(error?.code === 'email_not_confirmed'
                        ? 'กรุณายืนยันอีเมลจากข้อความที่ Supabase ส่งให้ก่อนเข้าสู่ระบบครับ'
                        : 'เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจอีเมลและรหัสผ่านแล้วลองใหม่ครับ');
                    return;
                }
                const identity = studentSessionIdentity(data.user);
                if (!identity) {
                    window.showAppNotice('ยืนยันบัญชีนักศึกษาไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่ครับ');
                    return;
                }
                localStorage.setItem('sut_student_id', identity.studentId);
                window.location.replace('index.html');
            } catch {
                window.showAppNotice('ติดต่อระบบเข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่ครับ');
            } finally {
                password.value = '';
                button.textContent = label;
                button.disabled = false;
            }
        });
    }
    
    // 🚀 ระบบสมัครสมาชิก (เชื่อมต่อ Supabase จริง!)
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = registerForm.querySelector('button[type="submit"]');
            if (submitBtn.disabled) return;
            const originalText = submitBtn.innerText;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังสร้างบัญชี...';
            submitBtn.disabled = true;

            const studentId = document.getElementById('reg-studentid').value.trim().toUpperCase();
            const firstName = document.getElementById('reg-firstname').value.trim();
            const lastName = document.getElementById('reg-lastname').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const password = document.getElementById('reg-password');
            const faculty = document.getElementById('register-faculty').value;
            const major = document.getElementById('register-major').value;

            let notice;
            try {
                if (!/^[A-Z0-9-]{1,32}$/.test(studentId)) {
                    window.showAppNotice('กรุณาตรวจรูปแบบรหัสนักศึกษาแล้วลองใหม่ครับ');
                    return;
                }
                const { data: authData, error: authError } = await supabaseClient.auth.signUp({
                    email,
                    password: password.value,
                    options: { data: { student_profile: {
                        reported_student_id: studentId, first_name: firstName, last_name: lastName, faculty, major
                    } } }
                });
                if (authError && !['user_already_exists', 'email_exists'].includes(authError.code)) {
                    window.showAppNotice('สร้างบัญชีไม่สำเร็จ กรุณาตรวจอีเมลและข้อกำหนดรหัสผ่าน แล้วลองใหม่ครับ');
                    return;
                }
                if (authError || authData?.user?.identities?.length === 0) {
                    notice = 'หากมีบัญชีด้วยอีเมลนี้แล้ว ให้ตรวจอีเมลยืนยันหรือกลับไปเข้าสู่ระบบด้วยบัญชีเดิมครับ';
                } else if (authData?.session) {
                    const identity = studentSessionIdentity(authData.user);
                    if (!identity) throw new Error('Missing Auth identity');
                    localStorage.setItem('sut_student_id', identity.studentId);
                    window.location.replace('index.html');
                    return;
                } else {
                    if (!authData?.user?.id) throw new Error('Missing Auth user');
                    notice = 'สร้างบัญชีแล้ว โปรเจกต์ Supabase นี้กำหนดให้ยืนยันอีเมล เมื่อยืนยันแล้วเข้าสู่ระบบได้เลยครับ';
                }
            } catch {
                window.showAppNotice('ติดต่อระบบสมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่ครับ');
                return;
            } finally {
                password.value = '';
                submitBtn.innerText = originalText;
                submitBtn.disabled = false;
            }
            await Swal.fire({ icon: 'info', title: 'สถานะการสมัครสมาชิก', text: notice });
            registerForm.reset();
            document.getElementById('login-email').value = email;
            switchAuthView('view-login');
        });
    }
    
    // ระบบลืมรหัสผ่าน (จำลอง)
    if (forgotForm) {
        forgotForm.addEventListener('submit', (e) => {
            e.preventDefault();
            window.showAppNotice('ระบบกำลังอยู่ในช่วงพัฒนาครับ');
        });
    }
});
