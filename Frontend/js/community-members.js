// ==========================================
// ℹ️ ระบบดูข้อมูลกลุ่ม / โปรไฟล์เพื่อน
// ==========================================
window.openGroupInfo = async function() {
    if (!currentChatRoomId) return;
    const roomName = document.getElementById('current-room-title').innerText;
    const isDM = currentActualRoomName && currentActualRoomName.startsWith('DM_');

    if (isDM) {
        // --- โหมดแชทส่วนตัว (เด้งไปหน้าข้อมูลส่วนตัวของเพื่อน) ---
        const myId = localStorage.getItem('sut_student_id');
        const ids = currentActualRoomName.replace('DM_', '').split('_');
        currentFriendIdInDM = ids[0] === myId ? ids[1] : ids[0];
        
        await viewFriendProfile(currentFriendIdInDM);
        return; // สำคัญ: หยุดการทำงานตรงนี้ เพื่อไม่ให้เปิด Modal ของกลุ่มแชท
    }

    // --- โหมดกลุ่มสาธารณะ/ส่วนตัว (เปิด Modal เหมือนเดิม) ---
    document.getElementById('info-group-name').innerText = roomName;
    document.getElementById('info-group-name').style.display = 'block';
    if(document.getElementById('input-edit-group-name')) document.getElementById('input-edit-group-name').style.display = 'none';
    if(document.getElementById('btn-save-group-name')) document.getElementById('btn-save-group-name').style.display = 'none';

    document.getElementById('info-group-type').innerHTML = currentRoomIsPrivate ? '<i class="fa-solid fa-lock"></i> กลุ่มส่วนตัว' : '<i class="fa-solid fa-globe"></i> กลุ่มสาธารณะ';
    document.getElementById('default-group-icon').className = 'fa-solid fa-users';
    const isAdmin = currentRoomRole === 'admin';
    document.getElementById('btn-edit-group-name').style.display = isAdmin ? 'block' : 'none';
    if(document.getElementById('btn-edit-group-avatar')) document.getElementById('btn-edit-group-avatar').style.display = isAdmin ? 'flex' : 'none';
    document.getElementById('section-join-requests').style.display = isAdmin && currentRoomIsPrivate ? 'block' : 'none';
    document.getElementById('btn-delete-group').style.display = isAdmin ? 'block' : 'none';
    document.getElementById('section-group-members').style.display = 'block';
    document.getElementById('btn-leave-group').style.display = 'block';
    document.getElementById('section-friend-profile').style.display = 'none';
    document.getElementById('btn-unfriend').style.display = 'none';

    await fetchGroupMembers();
    if (isAdmin && currentRoomIsPrivate) await fetchJoinRequests();
    
    openModal('modal-group-info');
};

// ==========================================
// 👤 ระบบสลับดูข้อมูลโปรไฟล์เพื่อน (Read-only)
// ==========================================
window.viewFriendProfile = async function(friendId) {
    // 1. ซ่อนทุกหน้า แล้วเปิดโชว์เฉพาะหน้า Profile
    document.querySelectorAll('.page-view').forEach(page => { page.style.display = 'none'; page.classList.remove('active'); });
    const profilePage = document.getElementById('profile') || document.querySelector('.page-view:nth-child(1)'); 
    if (profilePage) {
        profilePage.style.display = 'block';
        profilePage.classList.add('active');
    }

    // 2. เคลียร์ Active ของเมนูด้านซ้าย แล้วให้ไป Active ที่เมนูข้อมูลส่วนตัวแทน
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    const profileMenu = document.querySelectorAll('.menu-item')[0];
    if(profileMenu) profileMenu.classList.add('active');

    // 3. ปรับ Header เสกปุ่ม "กลับหน้าแชท" และซ่อนปุ่ม Save ของเดิม
    const h2Elements = profilePage.querySelectorAll('h2, .section-header');
    h2Elements.forEach(el => {
        if (el.innerText.includes('ข้อมูลส่วนตัว') || el.innerText.includes('ข้อมูลของเพื่อน')) {
            el.innerHTML = `
                <button onclick="backToChatFromProfile()" style="background: #f3f4f6; color: #4b5563; border: 1px solid #d1d5db; padding: 6px 14px; border-radius: 8px; margin-right: 15px; cursor: pointer; font-family: 'Prompt'; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; transition: 0.2s;" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='#f3f4f6'">
                    <i class="fa-solid fa-arrow-left"></i> กลับไปหน้าแชท
                </button>
                ข้อมูลของเพื่อน (${friendId})
            `;
        }
    });

    const saveBtn = document.getElementById('save-profile-btn');
    if (saveBtn) saveBtn.style.display = 'none';

    // ซ่อนปุ่มแก้ไขพื้นหลังและปุ่มแก้ไขรูปโปรไฟล์
    const editBgBtn = document.querySelector('.edit-bg-btn');
    const editAvatarBtn = document.querySelector('.edit-avatar-btn');
    if (editBgBtn) editBgBtn.style.display = 'none';
    if (editAvatarBtn) editAvatarBtn.style.display = 'none';

    // 🔥 เพิ่มตรงนี้: โหลดรูปพื้นหลังและรูปโปรไฟล์ของเพื่อนมาแสดง
    const bgContainer = document.getElementById('profile-bg-container');
    const friendBg = localStorage.getItem(`sut_bg_${friendId}`);
    if (bgContainer) {
        if (friendBg) {
            bgContainer.style.backgroundImage = `url(${friendBg})`;
        } else {
            bgContainer.style.backgroundImage = 'none'; // ถ้าเพื่อนไม่ได้ตั้งรูป ให้โชว์พื้นหลังว่างๆ
        }
    }

   // โหลดรูปโปรไฟล์ของเพื่อน (ใช้ API สร้างรูปโปรไฟล์จากรหัสนักศึกษาอัตโนมัติ)
    const avatarImg = document.getElementById('profile-avatar-img');
    const defaultIcon = document.getElementById('default-avatar-icon');
    if (avatarImg && defaultIcon) {
        // ใช้ ui-avatars สร้างรูปให้เพื่อนแบบอัตโนมัติ
        avatarImg.src = `https://ui-avatars.com/api/?name=${friendId}&background=random&color=fff&size=150&font-size=0.4`;
        avatarImg.style.display = 'block';
        defaultIcon.style.display = 'none';
    }
        

    // 4. ล็อก Input ทั้งหมดไม่ให้แก้ไข และเปลี่ยนสีพื้นหลังให้ดูเป็น Read-only
    const inputs = ['profile-fullname', 'profile-faculty', 'profile-major', 'profile-age', 'profile-freetime', 'profile-mbti', 'profile-learning-style', 'profile-social'];
    
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.value = 'กำลังโหลดข้อมูล...';
            el.readOnly = true;
            el.style.backgroundColor = '#f9fafb';
            el.style.color = '#6b7280';
            el.style.cursor = 'not-allowed';
            el.style.border = '1px dashed #d1d5db';
        }
    });

    // 5. ดึงข้อมูลเพื่อนจาก Database มาใส่
    const { data, error } = await supabaseClient.from('profiles').select('*').eq('student_id', friendId).single();
    if (data) {
        const fullName = `${data.first_name || ''} ${data.last_name || ''}`.trim();
        
        // อัปเดตชื่อตัวใหญ่ใต้รูปโปรไฟล์ให้เป็นของเพื่อน
        const displayNameEl = document.getElementById('display-profile-name');
        if (displayNameEl) displayNameEl.innerText = fullName || friendId;

        if(document.getElementById('profile-fullname')) document.getElementById('profile-fullname').value = fullName || '-';
        if(document.getElementById('profile-faculty')) document.getElementById('profile-faculty').value = data.faculty || '-';
        if(document.getElementById('profile-major')) document.getElementById('profile-major').value = data.major || '-';
        if(document.getElementById('profile-age')) document.getElementById('profile-age').value = data.age || '-';
        if(document.getElementById('profile-freetime')) document.getElementById('profile-freetime').value = data.free_time || '-';
        if(document.getElementById('profile-mbti')) document.getElementById('profile-mbti').value = data.mbti || '-';
        if(document.getElementById('profile-learning-style')) document.getElementById('profile-learning-style').value = data.learning_style || '-';
        if(document.getElementById('profile-social')) document.getElementById('profile-social').value = data.social_media || '-';
    } else {
        inputs.forEach(id => { const el = document.getElementById(id); if(el) el.value = 'ไม่พบข้อมูลในระบบ'; });
        const displayNameEl = document.getElementById('display-profile-name');
        if (displayNameEl) displayNameEl.innerText = friendId;
    }
};
// ==========================================
// 🔙 ฟังก์ชันปุ่ม "กลับหน้าแชท"
// ==========================================
window.backToChatFromProfile = function() {
    // 1. คืนค่าหน้า Profile ให้เป็นข้อมูลของตัวเองเหมือนเดิม
    restoreMyProfile();

    // 2. หันเหทิศทางกลับไปที่หน้า Community Chat
    const chatMenuBtn = document.querySelectorAll('.menu-item')[2]; // สมมติว่าเมนูแชทอยู่ลำดับ 3
    if(chatMenuBtn) {
        switchPage('community-chat', chatMenuBtn);
    } else {
        switchPage('community-chat');
    }
};

// ==========================================
// ♻️ ฟังก์ชันคืนค่าหน้าโปรไฟล์กลับเป็นของตัวเอง
// ==========================================
window.restoreMyProfile = function() {
    const profilePage = document.getElementById('profile') || document.querySelector('.page-view:nth-child(1)'); 
    if (!profilePage) return;

    // 1. คืนค่าข้อความ Header และโชว์ปุ่ม Save กลับมา
    const h2Elements = profilePage.querySelectorAll('h2, .section-header');
    h2Elements.forEach(el => {
        if (el.innerText.includes('กลับไปหน้าแชท') || el.innerText.includes('ข้อมูลของเพื่อน')) {
            el.innerHTML = 'ข้อมูลส่วนตัว';
        }
    });

    const saveBtn = document.getElementById('save-profile-btn');
    if (saveBtn) saveBtn.style.display = 'block';

    // 🔥 แสดงปุ่มแก้ไขพื้นหลังและปุ่มแก้ไขรูปโปรไฟล์กลับมา (ใช้ flex ตาม CSS เดิม)
    const editBgBtn = document.querySelector('.edit-bg-btn');
    const editAvatarBtn = document.querySelector('.edit-avatar-btn');
    if (editBgBtn) editBgBtn.style.display = 'flex';
    if (editAvatarBtn) editAvatarBtn.style.display = 'flex';

    // 2. ปลดล็อก Input ทั้งหมด ให้แก้ไขได้ตามปกติ
    const inputs = ['profile-fullname', 'profile-faculty', 'profile-major', 'profile-age', 'profile-freetime', 'profile-mbti', 'profile-learning-style', 'profile-social'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if(el) {
            el.value = '';
            el.readOnly = false;
            el.style.backgroundColor = '#ffffff';
            el.style.color = '#111827';
            el.style.cursor = 'text';
            el.style.border = '1px solid #d1d5db';
        }
    });

    // 3. โหลดข้อมูลของคุณปัณณทัตกลับมาทับ (ฟังก์ชันนี้จะดึงชื่อมาใส่ใต้รูปให้อัตโนมัติด้วย)
    if (typeof fetchStudentProfileOnLogin === 'function') {
        fetchStudentProfileOnLogin();
    }
};
async function fetchFriendProfile(friendId) {
    const container = document.getElementById('friend-profile-details');
    container.innerHTML = '<div style="text-align:center; font-size:12px; color:#999;">กำลังโหลดข้อมูล...</div>';
    const { data, error } = await supabaseClient.from('profiles').select('*').eq('student_id', friendId).single();
    if (error || !data) { container.innerHTML = '<div style="color:red; font-size:12px;">ไม่สามารถโหลดข้อมูลโปรไฟล์ได้</div>'; return; }
    container.innerHTML = `
        <div style="display: flex; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;"><span style="font-size: 13px; color: #6b7280;">อายุ</span><span style="font-size: 13px; font-weight: 500; color: #111;">${data.age || '-'}</span></div>
        <div style="display: flex; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;"><span style="font-size: 13px; color: #6b7280;">MBTI</span><span style="font-size: 13px; font-weight: 500; color: #111;">${data.mbti || '-'}</span></div>
        <div style="display: flex; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;"><span style="font-size: 13px; color: #6b7280;">สไตล์การเรียน</span><span style="font-size: 13px; font-weight: 500; color: #111;">${data.learning_style || '-'}</span></div>
        <div style="display: flex; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;"><span style="font-size: 13px; color: #6b7280;">เวลาว่าง</span><span style="font-size: 13px; font-weight: 500; color: #111;">${data.free_time || '-'}</span></div>
        <div style="display: flex; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;"><span style="font-size: 13px; color: #6b7280;">Social Media</span><span style="font-size: 13px; font-weight: 500; color: #111;">${data.social_media || '-'}</span></div>
    `;
}

window.unfriendUser = async function() {
    if(!confirm("คุณต้องการลบเพื่อนคนนี้ใช่หรือไม่?")) return;
    const myId = localStorage.getItem('sut_student_id');
    try {
        await supabaseClient.from('friendships').delete().or(`and(requester_id.eq.${myId},receiver_id.eq.${currentFriendIdInDM}),and(requester_id.eq.${currentFriendIdInDM},receiver_id.eq.${myId})`);
        await supabaseClient.from('chat_room_members').delete().eq('room_id', currentChatRoomId).eq('student_id', myId);
        closeModal('modal-group-info');
        document.querySelector('.chat-history').innerHTML = `<div style="text-align:center; color:#999; margin-top:50px;">เลือกแชทด้านซ้ายเพื่อเริ่มพูดคุย</div>`;
        document.getElementById('current-room-title').innerText = "ยังไม่ได้เลือกกลุ่ม";
        document.getElementById('btn-group-info').style.display = 'none';
        await loadChatRooms(); 
        showSuccessModal('สำเร็จ', "ลบเพื่อนเรียบร้อยแล้ว");
    } catch (err) { alert("เกิดข้อผิดพลาด: " + err.message); }
};

async function fetchGroupMembers() {
    const listContainer = document.getElementById('list-group-members');
    listContainer.innerHTML = '<div style="text-align:center; font-size:12px; color:#999;">กำลังโหลด...</div>';
    try {
        const { data: members, error: memberError } = await supabaseClient.from('chat_room_members').select('role, student_id').eq('room_id', currentChatRoomId).eq('status', 'joined').order('role', { ascending: true });
        if (memberError) throw memberError;
        if (!members || members.length === 0) { document.getElementById('badge-member-count').innerText = `(0)`; listContainer.innerHTML = '<div style="font-size:12px; color:#999;">ไม่มีสมาชิก</div>'; return; }
        document.getElementById('badge-member-count').innerText = `(${members.length})`;

        const studentIds = members.map(m => m.student_id);
        const { data: profiles } = await supabaseClient.from('profiles').select('student_id, first_name, last_name').in('student_id', studentIds);
        const profileMap = {};
        if (profiles) profiles.forEach(p => { profileMap[p.student_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });

        listContainer.innerHTML = '';
        members.forEach(m => {
            const name = profileMap[m.student_id] || 'ไม่ระบุชื่อ';
            const isAdmin = m.role === 'admin';
            const roleBadge = isAdmin ? `<span style="background:#fef08a; color:#854d0e; font-size:10px; padding:2px 6px; border-radius:10px; margin-left:8px;">Admin</span>` : '';
            listContainer.innerHTML += `
                <div style="display: flex; align-items: center; gap: 12px; padding: 8px 0;">
                    <div style="width: 36px; height: 36px; background: #e5e7eb; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #6b7280; font-weight: bold; font-size: 14px;">${m.student_id.substring(0, 1)}</div>
                    <div><div style="font-size: 14px; font-weight: 500; color: #111;">${m.student_id} ${roleBadge}</div><div style="font-size: 12px; color: #6b7280;">${name}</div></div>
                </div>
            `;
        });
    } catch (error) { listContainer.innerHTML = `<div style="color:red; font-size:12px;">เกิดข้อผิดพลาด: ${error.message}</div>`; }
}

window.enableEditGroupName = function() {
    const nameText = document.getElementById('info-group-name');
    const nameInput = document.getElementById('input-edit-group-name');
    const editBtn = document.getElementById('btn-edit-group-name');
    const saveBtn = document.getElementById('btn-save-group-name');
    nameInput.value = nameText.innerText;
    nameText.style.display = 'none';
    nameInput.style.display = 'block';
    nameInput.focus();
    editBtn.style.display = 'none';
    saveBtn.style.display = 'block';
};

window.saveGroupName = async function() {
    if (!currentChatRoomId) return;
    const nameText = document.getElementById('info-group-name');
    const nameInput = document.getElementById('input-edit-group-name');
    const editBtn = document.getElementById('btn-edit-group-name');
    const saveBtn = document.getElementById('btn-save-group-name');
    const newName = nameInput.value.trim();
    const currentName = nameText.innerText;

    if (newName === "" || newName === currentName) {
        nameText.style.display = 'block'; nameInput.style.display = 'none'; editBtn.style.display = 'block'; saveBtn.style.display = 'none'; return;
    }

    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';
    saveBtn.disabled = true;

    try {
        const { error } = await supabaseClient.from('chat_rooms').update({ name: newName }).eq('id', currentChatRoomId);
        if (error) throw error;
        nameText.innerText = newName;
        document.getElementById('current-room-title').innerText = newName;
        nameText.style.display = 'block'; nameInput.style.display = 'none'; editBtn.style.display = 'block'; saveBtn.style.display = 'none';
        await loadChatRooms(); 
    } catch (error) { alert("เกิดข้อผิดพลาด: " + error.message); } 
    finally { saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> บันทึกชื่อ'; saveBtn.disabled = false; }
};

async function fetchJoinRequests() {
    const listContainer = document.getElementById('list-join-requests');
    const { data: requests } = await supabaseClient.from('chat_room_members').select(`student_id`).eq('room_id', currentChatRoomId).eq('status', 'pending');
    document.getElementById('badge-request-count').innerText = requests ? requests.length : 0;
    listContainer.innerHTML = '';
    if (!requests || requests.length === 0) { listContainer.innerHTML = '<div style="font-size:12px; color:#9ca3af;">ไม่มีคำขอใหม่</div>'; return; }
    requests.forEach(req => {
        listContainer.innerHTML += `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
                <div style="font-size: 14px; font-weight: 500;">${req.student_id}</div>
                <div style="display: flex; gap: 5px;">
                    <button onclick="handleJoinRequest('${req.student_id}', 'joined')" style="background:#10b981; color:white; border:none; padding:4px 10px; border-radius:4px; font-size:12px; cursor:pointer;">รับ</button>
                    <button onclick="handleJoinRequest('${req.student_id}', 'rejected')" style="background:#ef4444; color:white; border:none; padding:4px 10px; border-radius:4px; font-size:12px; cursor:pointer;">ปฎิเสธ</button>
                </div>
            </div>
        `;
    });
}

window.handleJoinRequest = async function(targetId, newStatus) {
    if (newStatus === 'rejected') await supabaseClient.from('chat_room_members').delete().eq('room_id', currentChatRoomId).eq('student_id', targetId);
    else await supabaseClient.from('chat_room_members').update({ status: 'joined' }).eq('room_id', currentChatRoomId).eq('student_id', targetId);
    fetchJoinRequests(); 
    fetchGroupMembers(); 
};

window.leaveCurrentGroup = async function() {
    if(!confirm("คุณต้องการออกจากกลุ่มนี้ใช่หรือไม่?")) return;
    const myId = localStorage.getItem('sut_student_id');
    await supabaseClient.from('chat_room_members').delete().eq('room_id', currentChatRoomId).eq('student_id', myId);
    closeModal('modal-group-info');
    document.querySelector('.chat-history').innerHTML = `<div style="text-align:center; color:#999; margin-top:50px;">เลือกกลุ่มแชทด้านซ้ายเพื่อเริ่มพูดคุย</div>`;
    document.getElementById('current-room-title').innerText = "ยังไม่ได้เลือกกลุ่ม";
    document.getElementById('btn-group-info').style.display = 'none';
    loadChatRooms(); 
};

async function loadFriendsData() {
    const myId = localStorage.getItem('sut_student_id');
    const friendsContainer = document.getElementById('friends-list');
    const reqContainer = document.getElementById('friend-requests-list');
    const reqSection = document.getElementById('friend-requests-section');
    if (!myId || !friendsContainer || !reqContainer || !reqSection) return;

    try {
        const { data: pendingReqs } = await supabaseClient.from('friendships').select('*').eq('receiver_id', myId).eq('status', 'pending');
        const { data: acceptedFriends } = await supabaseClient.from('friendships').select('*').or(`requester_id.eq.${myId},receiver_id.eq.${myId}`).eq('status', 'accepted');

        let targetIds = [];
        if (pendingReqs) pendingReqs.forEach(r => targetIds.push(r.requester_id));
        if (acceptedFriends) acceptedFriends.forEach(r => { targetIds.push(r.requester_id === myId ? r.receiver_id : r.requester_id); });
        targetIds = [...new Set(targetIds)];

        let profileMap = {};
        if (targetIds.length > 0) {
            const { data: profiles } = await supabaseClient.from('profiles').select('student_id, first_name, last_name').in('student_id', targetIds);
            if (profiles) profiles.forEach(p => { profileMap[p.student_id] = `${p.first_name || ''} ${p.last_name || ''}`.trim(); });
        }

        if (pendingReqs && pendingReqs.length > 0) {
            reqSection.style.display = 'block';
            document.getElementById('friend-request-count').innerText = pendingReqs.length;
            reqContainer.innerHTML = '';
            pendingReqs.forEach(req => {
                const name = profileMap[req.requester_id] || 'ไม่ระบุชื่อ';
                reqContainer.innerHTML += `
                    <div style="background: white; border: 1px solid #e5e7eb; padding: 10px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                        <div style="font-weight: 600; font-size: 13px; color: #111;">${req.requester_id}</div>
                        <div style="font-size: 11px; color: #6b7280; margin-bottom: 8px;">${name}</div>
                        <div style="display: flex; gap: 5px;">
                            <button onclick="handleFriendRequest('${req.requester_id}', 'accepted')" style="flex: 1; background: #10b981; color: white; border: none; padding: 6px; border-radius: 6px; font-size: 12px; cursor: pointer;">รับแอด</button>
                            <button onclick="handleFriendRequest('${req.requester_id}', 'rejected')" style="flex: 1; background: #f3f4f6; color: #4b5563; border: none; padding: 6px; border-radius: 6px; font-size: 12px; cursor: pointer;">ลบ</button>
                        </div>
                    </div>`;
            });
        } else { reqSection.style.display = 'none'; }

        document.getElementById('friends-count').innerText = `(${acceptedFriends ? acceptedFriends.length : 0})`;
        friendsContainer.innerHTML = '';
        if (!acceptedFriends || acceptedFriends.length === 0) { friendsContainer.innerHTML = '<div style="text-align: center; font-size: 12px; color: #9ca3af; padding: 20px;">ยังไม่มีเพื่อนในระบบ</div>'; } 
        else {
            acceptedFriends.forEach(f => {
                const friendId = f.requester_id === myId ? f.receiver_id : f.requester_id;
                const name = profileMap[friendId] || 'ไม่ระบุชื่อ';
                friendsContainer.innerHTML += `
                    <div onclick="openDirectMessage('${friendId}', '${name}')" style="display: flex; align-items: center; gap: 10px; padding: 10px; background: white; border: 1px solid #e5e7eb; border-radius: 8px; cursor: pointer;">
                        <div style="width: 35px; height: 35px; background: #dbeafe; color: #2563eb; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px;">${friendId.substring(0, 1)}</div>
                        <div style="flex: 1; overflow: hidden;">
                            <div style="font-size: 13px; font-weight: 600; color: #111;">${friendId}</div>
                            <div style="font-size: 11px; color: #6b7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${name}</div>
                        </div>
                        <i class="fa-solid fa-comment-dots" style="color: #cbd5e1; font-size: 16px;"></i>
                    </div>`;
            });
        }
    } catch (err) { console.error('Error loading friends:', err); }
}

window.openDirectMessage = async function(friendId, friendName) {
    const myId = localStorage.getItem('sut_student_id');
    if (!myId) return;
    const ids = [myId, friendId].sort();
    const dmRoomName = `DM_${ids[0]}_${ids[1]}`;
    const displayRoomName = `${friendName} (${friendId})`; 
    try {
        const { data: existingRooms, error: searchError } = await supabaseClient.from('chat_rooms').select('id').eq('name', dmRoomName).eq('is_private', true);
        if (searchError) throw searchError;

        let roomId;
        if (existingRooms && existingRooms.length > 0) { roomId = existingRooms[0].id; } 
        else {
            const { data: newRoom, error: createError } = await supabaseClient.from('chat_rooms').insert([{ name: dmRoomName, is_private: true }]).select().single();
            if (createError) throw createError;
            roomId = newRoom.id;
            const membersToInsert = [{ room_id: roomId, student_id: myId, role: 'member', status: 'joined' }, { room_id: roomId, student_id: friendId, role: 'member', status: 'joined' }];
            const { error: memberError } = await supabaseClient.from('chat_room_members').insert(membersToInsert);
            if (memberError) throw memberError;
        }
        await selectChatRoom(roomId, displayRoomName);
    } catch (error) { alert("ไม่สามารถสร้างห้องแชทได้: " + error.message); }
};

