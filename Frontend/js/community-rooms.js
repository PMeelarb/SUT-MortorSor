// ==========================================
// ระบบ Community Chat
// ==========================================
let currentChatRoomId = null;
let publicRoomId = null; 
let chatSubscription = null;
let base64GroupImage = null;

document.addEventListener('DOMContentLoaded', () => {
    const commInput = document.getElementById('community-msg-input');
    const commSendBtn = document.querySelector('.send-msg-btn');
    if (commInput && commSendBtn) {
        commSendBtn.addEventListener('click', sendCommunityMessage);
        commInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendCommunityMessage(); });
    }
});

// ==========================================
// 📌 ฟังก์ชันปักหมุดแชท
// ==========================================
window.togglePinChat = function(roomId, event) {
    event.stopPropagation(); // ป้องกันไม่ให้คลิกปุ่มปักหมุดแล้วเด้งเปิดห้องแชท
    const myId = localStorage.getItem('sut_student_id');
    let pinned = JSON.parse(localStorage.getItem(`pinned_chats_${myId}`) || '[]');
    
    if (pinned.includes(roomId)) {
        pinned = pinned.filter(id => id !== roomId); // เลิกปักหมุด
    } else {
        pinned.push(roomId); // ปักหมุด
    }
    
    localStorage.setItem(`pinned_chats_${myId}`, JSON.stringify(pinned));
    loadChatRooms(); // รีเฟรชรายชื่อแชทใหม่เพื่อให้ห้องปักหมุดเด้งขึ้นบนสุด
};

// ==========================================
// 🔄 โหลดรายชื่อห้องแชท (อัปเกรด UI สไตล์ Messenger + ปักหมุด)
// ==========================================
async function loadChatRooms() {
    const myId = localStorage.getItem('sut_student_id');
    const sidebarList = document.querySelector('.chat-sidebar-left') || document.querySelector('div[style*="width: 250px"]');
    if (!myId) return;

    try {
        const { data: myMemberships, error: memberErr } = await supabaseClient.from('chat_room_members').select('room_id').eq('student_id', myId).eq('status', 'joined');
        if (memberErr) throw memberErr;

        // ปรับ Header เป็นคำว่า "แชท" และทำ UI ให้ดูโมเดิร์น สว่างตา
        if (sidebarList) {
            sidebarList.style.backgroundColor = '#ffffff';
            sidebarList.style.borderRight = '1px solid #e5e7eb';
            sidebarList.innerHTML = `
                <div style="padding: 20px 15px 10px 15px; font-size: 22px; font-weight: 700; color: #111827; display: flex; justify-content: space-between; align-items: center; background: #ffffff; z-index: 10; position: sticky; top: 0;">
                    แชท
                </div>
                <div id="room-list-container" style="padding: 10px; overflow-y: auto; height: calc(100% - 60px);"></div>
            `;
        }
        
        const roomContainer = document.getElementById('room-list-container');
        if (!roomContainer) return;

        if (!myMemberships || myMemberships.length === 0) {
            roomContainer.innerHTML = '<div style="padding: 20px; text-align: center; color: #9ca3af; font-size: 13px;">ยังไม่มีการพูดคุย</div>';
        } else {
            const roomIds = myMemberships.map(m => m.room_id);
            const { data: rooms, error: roomErr } = await supabaseClient.from('chat_rooms').select('id, name, is_private').in('id', roomIds);
            if (roomErr) throw roomErr;

            // ดึงข้อมูลการปักหมุดจากความจำเบราว์เซอร์
            let pinnedChats = JSON.parse(localStorage.getItem(`pinned_chats_${myId}`) || '[]');
            
            // จัดเรียง: ปักหมุดขึ้นก่อน ตามด้วยแชทปกติ
            let sortedRooms = rooms.sort((a, b) => {
                let aPinned = pinnedChats.includes(a.id);
                let bPinned = pinnedChats.includes(b.id);
                if (aPinned && !bPinned) return -1;
                if (!aPinned && bPinned) return 1;
                return 0;
            });

            sortedRooms.forEach(room => {
                let isPinned = pinnedChats.includes(room.id);
                let pinIconHtml = isPinned ? 
                    `<i class="fa-solid fa-thumbtack" style="color: #F05A28; font-size: 14px; transform: rotate(45deg);"></i>` : 
                    `<i class="fa-solid fa-thumbtack" style="color: #d1d5db; font-size: 14px; opacity: 0; transition: 0.2s;" class="pin-icon"></i>`;

                let displayName = room.name;
                let initial = room.name.charAt(0).toUpperCase();
                let avatarBg = '#f3f4f6';
                let avatarColor = '#4b5563';
                let statusDot = '';

                // สร้างสไตล์รูปโปรไฟล์แบบกลมโต สไตล์ Messenger / Instagram
                if (room.name.startsWith('DM_')) {
                    const ids = room.name.replace('DM_', '').split('_');
                    const friendId = ids[0] === myId ? ids[1] : ids[0];
                    displayName = `${friendId}`;
                    initial = friendId.charAt(0).toUpperCase();
                    avatarBg = 'linear-gradient(135deg, #60a5fa, #3b82f6)';
                    avatarColor = 'white';
                    statusDot = `<div style="position:absolute; bottom: 0px; right: 0px; width: 13px; height: 13px; background: #10b981; border: 2.5px solid white; border-radius: 50%;"></div>`;
                } else {
                    // กลุ่มทั่วไป
                    avatarBg = room.is_private ? 'linear-gradient(135deg, #a78bfa, #8b5cf6)' : 'linear-gradient(135deg, #fca5a5, #ef4444)';
                    avatarColor = 'white';
                    initial = room.is_private ? '<i class="fa-solid fa-lock" style="font-size:16px;"></i>' : '<i class="fa-solid fa-users" style="font-size:16px;"></i>';
                }

                const isActive = currentChatRoomId === room.id;
                const activeBg = isActive ? "#fef2f2" : "transparent";

                roomContainer.innerHTML += `
                    <div class="chat-room-item" onclick="selectChatRoom('${room.id}', '${displayName}')" style="padding: 10px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 10px; border-radius: 12px; transition: background 0.2s; margin-bottom: 4px; background: ${activeBg};" onmouseover="this.style.background='#f3f4f6'; this.querySelector('.pin-icon')?.style.setProperty('opacity', '1');" onmouseout="if(!${isActive}) this.style.background='transparent'; if(!${isPinned}) this.querySelector('.pin-icon')?.style.setProperty('opacity', '0');">
                        <div style="display: flex; align-items: center; gap: 12px; overflow: hidden; width: 100%;">
                            <div style="width: 50px; height: 50px; min-width: 50px; border-radius: 50%; background: ${avatarBg}; color: ${avatarColor}; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: bold; position: relative; box-shadow: 0 2px 5px rgba(0,0,0,0.08);">
                                ${initial}
                                ${statusDot}
                            </div>
                            <div style="display: flex; flex-direction: column; overflow: hidden; justify-content: center;">
                                <span style="font-size: 15px; font-weight: ${isActive || isPinned ? '600' : '500'}; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;">${displayName}</span>
                                <span style="font-size: 13px; color: ${isActive ? '#F05A28' : '#6b7280'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 4px;">แตะเพื่อเปิดแชท...</span>
                            </div>
                        </div>
                        <button onclick="togglePinChat('${room.id}', event)" style="background: transparent; border: none; cursor: pointer; padding: 5px; display: flex; align-items: center; justify-content: center;" title="${isPinned ? 'เลิกปักหมุด' : 'ปักหมุด'}">
                            ${pinIconHtml}
                        </button>
                    </div>
                `;
            });
        }
    } catch (err) { console.error("Error loading chat rooms:", err); } 
    finally { await loadFriendsData(); }
}

let currentRoomRole = 'member';
let currentRoomIsPrivate = false;
let currentActualRoomName = '';
let currentFriendIdInDM = '';

window.selectChatRoom = async function(roomId, roomName) {
    currentChatRoomId = roomId; 
    publicRoomId = roomId; 
    document.getElementById('current-room-title').innerText = roomName;
    
    const myId = localStorage.getItem('sut_student_id');
    const { data: memberData } = await supabaseClient.from('chat_room_members').select('role').eq('room_id', roomId).eq('student_id', myId).single();
    currentRoomRole = memberData ? memberData.role : 'member';
    
    const { data: roomData } = await supabaseClient.from('chat_rooms').select('is_private, name').eq('id', roomId).single();
    if(roomData) { currentRoomIsPrivate = roomData.is_private; currentActualRoomName = roomData.name; }

    document.getElementById('btn-group-info').style.display = 'block'; 
    await loadChatRooms(); 
    document.querySelector('.chat-history').innerHTML = `<div style="text-align:center; color:#999; margin-top:20px;">กำลังโหลดประวัติ...</div>`;
    await loadMessages(roomId);
    subscribeToChat(roomId);
};

async function loadMessages(roomId) {
    const { data: messages, error } = await supabaseClient.from('chat_messages').select('*').eq('room_id', roomId).order('created_at', { ascending: true });
    const chatBox = document.querySelector('.chat-history');
    if (chatBox) chatBox.innerHTML = ''; 
    if (messages && messages.length > 0) messages.forEach(msg => renderSingleMessage(msg));
}

// ==========================================
// 💬 ฟังก์ชันวาดข้อความแชท (รองรับการแสดงการ์ดแชร์ตารางเรียน)
// ==========================================
function renderSingleMessage(msg) {
    const chatBox = document.querySelector('.chat-history');
    if (!chatBox) return;

    const myId = localStorage.getItem('sut_student_id');
    const isMe = msg.sender_id === myId;

    const msgDiv = document.createElement('div');
    msgDiv.style.padding = '10px 15px';
    msgDiv.style.borderRadius = isMe ? '10px 10px 0 10px' : '10px 10px 10px 0';
    msgDiv.style.marginBottom = '10px';
    msgDiv.style.width = 'fit-content';
    msgDiv.style.maxWidth = '70%';
    msgDiv.style.wordBreak = 'break-word';
    msgDiv.style.fontSize = '14px';

    // เช็คว่าข้อความนี้เป็นการแชร์ตารางเรียน (ซ่อนโค้ดไว้ใต้คำว่า SYS_SHARE)
    if (msg.message && msg.message.startsWith('SYS_SHARE:')) {
        try {
            const jsonStr = msg.message.replace('SYS_SHARE:', '');
            const payload = JSON.parse(jsonStr);
            const safeJson = JSON.stringify(payload.courses).replace(/'/g, "&#39;").replace(/"/g, "&quot;");
            
            msgDiv.style.background = isMe ? '#F05A28' : '#ffffff';
            msgDiv.style.color = isMe ? 'white' : '#333';
            msgDiv.style.marginLeft = isMe ? 'auto' : '0';
            msgDiv.style.border = isMe ? 'none' : '1px solid #e5e7eb';
            msgDiv.style.boxShadow = '0 2px 5px rgba(0,0,0,0.05)';

            let headerHtml = isMe ? '' : `<strong style="font-size: 11px; color: #F05A28; display: block; margin-bottom: 8px;"><i class="fa-solid fa-user"></i> ${msg.sender_id}</strong>`;
            
            msgDiv.innerHTML = `
                ${headerHtml}
                <div style="background: ${isMe ? 'rgba(255,255,255,0.2)' : '#f9fafb'}; padding: 12px; border-radius: 8px; text-align: center; border: 1px solid ${isMe ? 'rgba(255,255,255,0.3)' : '#e5e7eb'}; min-width: 220px;">
                    <div style="font-size: 32px; margin-bottom: 5px;">📅</div>
                    <div style="font-weight: 600; margin-bottom: 2px;">ตารางเรียนของ${isMe ? 'ฉัน' : 'เพื่อน'}</div>
                    <div style="font-size: 12px; margin-bottom: 12px; opacity: 0.9;">ปี ${payload.year} เทอม ${payload.sem}</div>
                    <button onclick="importSharedSchedule('${safeJson}', ${payload.year}, ${payload.sem})" style="background: ${isMe ? 'white' : '#10b981'}; color: ${isMe ? '#F05A28' : 'white'}; border: none; padding: 8px 15px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'Prompt', sans-serif; width: 100%; transition: 0.2s;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
                        <i class="fa-solid fa-download"></i> ${isMe ? 'เช็คข้อมูลตาราง' : 'ดึงตารางนี้ลงระบบ'}
                    </button>
                </div>
            `;
        } catch(e) {
            msgDiv.innerText = "แชร์ตารางเรียน (ข้อมูลขัดข้อง)";
        }
    } else {
        // ข้อความแชทปกติ
        if (isMe) {
            msgDiv.style.background = '#F05A28'; msgDiv.style.color = 'white'; msgDiv.style.marginLeft = 'auto'; msgDiv.innerText = msg.message;
        } else {
            msgDiv.style.background = '#E0E0E0'; msgDiv.style.color = '#333'; msgDiv.innerHTML = `<strong style="font-size: 11px; color: #F05A28; display: block; margin-bottom: 2px;">${msg.sender_id}</strong>${msg.message}`;
        }
    }

    chatBox.appendChild(msgDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

function subscribeToChat(roomId) {
    if (chatSubscription) supabaseClient.removeChannel(chatSubscription);
    chatSubscription = supabaseClient
        .channel('public-room')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` }, payload => { renderSingleMessage(payload.new); })
        .subscribe();
}

window.createNewGroup = async function() {
    const nameInput = document.getElementById('new-group-name');
    const typeSelect = document.getElementById('new-group-type');
    if (!nameInput || nameInput.value.trim() === '') { alert('⚠️ กรุณากรอกชื่อกลุ่มครับ'); return; }

    const groupName = nameInput.value.trim();
    const isPrivate = typeSelect ? typeSelect.value.includes('ส่วนตัว') : false; 
    const studentId = localStorage.getItem('sut_student_id');

    try {
        const { data: newRoom, error: roomError } = await supabaseClient.from('chat_rooms').insert([{ name: groupName, is_private: isPrivate, created_by: studentId }]).select().single();
        if (roomError) throw roomError;
        const { error: memberError } = await supabaseClient.from('chat_room_members').insert([{ room_id: newRoom.id, student_id: studentId, role: 'admin', status: 'joined' }]);
        if (memberError) throw memberError;

        showSuccessModal('สำเร็จ!', `สร้างกลุ่ม "${groupName}" สำเร็จ!`);
        document.getElementById('modal-create-group').style.display = 'none';
        nameInput.value = '';
        loadChatRooms();
    } catch (error) { alert("เกิดข้อผิดพลาดในการสร้างกลุ่ม: " + error.message); }
};

window.searchCommunity = async function() {
    const searchInput = document.getElementById('search-community-input');
    const resultsContainer = document.getElementById('search-community-results');
    const searchBtn = document.getElementById('btn-run-search');
    
    if (!searchInput || !resultsContainer) return;
    const keyword = searchInput.value.trim();
if (!keyword) { 
    showErrorModal('ข้อมูลไม่ครบถ้วน', 'กรุณาพิมพ์ <b>รหัสนักศึกษา</b> หรือ <b>ชื่อกลุ่ม</b> ลงในช่องค้นหาก่อนกดปุ่มค้นหานะครับ'); 
    return; 
}
    const myStudentId = localStorage.getItem('sut_student_id');
    const originalText = searchBtn.innerText;
    searchBtn.innerText = 'กำลังค้นหา...';
    searchBtn.disabled = true;

    try {
        const { data: users, error: userError } = await supabaseClient.from('profiles').select('student_id, first_name, last_name').neq('student_id', myStudentId).or(`student_id.ilike.%${keyword}%,first_name.ilike.%${keyword}%,last_name.ilike.%${keyword}%`).limit(10);
        if (userError) throw userError;

        const { data: rooms, error: roomError } = await supabaseClient.from('chat_rooms').select('id, name, is_private').ilike('name', `%${keyword}%`).limit(10);
        if (roomError) throw roomError;

        renderSearchResults(users || [], rooms || []);
    } catch (error) { resultsContainer.innerHTML = `<div style="text-align: center; color: #ef4444; padding: 20px;">เกิดข้อผิดพลาด: ${error.message}</div>`; } 
    finally { searchBtn.innerText = originalText; searchBtn.disabled = false; }
};

function renderSearchResults(users, rooms) {
    const container = document.getElementById('search-community-results');
    if (!container) return;
    container.innerHTML = '';

    if (users.length === 0 && rooms.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: #9ca3af; padding: 30px 0;">ไม่พบข้อมูลที่ค้นหา</div>';
        return;
    }

    const userSection = document.createElement('div');
    userSection.innerHTML = `<div style="font-size: 13px; font-weight: 600; color: #6b7280; margin-bottom: 8px;"><i class="fa-solid fa-user"></i> เพื่อน (${users.length})</div>`;
    if (users.length === 0) { userSection.innerHTML += `<div style="font-size: 12px; color: #9ca3af; padding: 6px 10px;">ไม่พบรายชื่อเพื่อน</div>`; } 
    else {
        users.forEach(u => {
            const name = `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'ไม่ระบุชื่อ';
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 6px;';
            item.innerHTML = `
                <div><div style="font-weight: 600; font-size: 14px; color: #1f2937;">${u.student_id}</div><div style="font-size: 12px; color: #6b7280;">${name}</div></div>
                <button onclick="sendFriendRequest('${u.student_id}')" style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: 'Prompt', sans-serif;"><i class="fa-solid fa-user-plus"></i> เพิ่มเพื่อน</button>
            `;
            userSection.appendChild(item);
        });
    }
    container.appendChild(userSection);

    const roomSection = document.createElement('div');
    roomSection.innerHTML = `<div style="font-size: 13px; font-weight: 600; color: #6b7280; margin-bottom: 8px;"><i class="fa-solid fa-users"></i> กลุ่มแชท (${rooms.length})</div>`;
    if (rooms.length === 0) { roomSection.innerHTML += `<div style="font-size: 12px; color: #9ca3af; padding: 6px 10px;">ไม่พบกลุ่มแชท</div>`; } 
    else {
        rooms.forEach(r => {
            const badge = r.is_private ? `<span style="background: #f3f4f6; color: #4b5563; font-size: 11px; padding: 2px 8px; border-radius: 12px;"><i class="fa-solid fa-lock"></i> ส่วนตัว</span>` : `<span style="background: #ecfdf5; color: #059669; font-size: 11px; padding: 2px 8px; border-radius: 12px;"><i class="fa-solid fa-globe"></i> สาธารณะ</span>`;
            const btnAction = r.is_private ? `<button onclick="requestJoinPrivateGroup('${r.id}', '${r.name}')" style="background: #6366f1; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: 'Prompt', sans-serif;"><i class="fa-solid fa-paper-plane"></i> ขอเข้าร่วม</button>` : `<button onclick="joinPublicGroupDirect('${r.id}', '${r.name}')" style="background: #F05A28; color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: 'Prompt', sans-serif;"><i class="fa-solid fa-arrow-right-to-bracket"></i> เข้ากลุ่ม</button>`;
            const item = document.createElement('div');
            item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 6px;';
            item.innerHTML = `<div><div style="font-weight: 600; font-size: 14px; color: #1f2937; display: flex; align-items: center; gap: 6px;">${r.name} ${badge}</div></div>${btnAction}`;
            roomSection.appendChild(item);
        });
    }
    container.appendChild(roomSection);
}

window.sendFriendRequest = async function(targetStudentId) {
    const myStudentId = localStorage.getItem('sut_student_id');
    try {
        const { data: existing } = await supabaseClient.from('friendships').select('*').or(`and(requester_id.eq.${myStudentId},receiver_id.eq.${targetStudentId}),and(requester_id.eq.${targetStudentId},receiver_id.eq.${myStudentId})`);
        if (existing && existing.length > 0) return alert('คุณและผู้ใช้นี้มีความสัมพันธ์หรือส่งคำขอกันอยู่แล้วครับ');
        const { error } = await supabaseClient.from('friendships').insert([{ requester_id: myStudentId, receiver_id: targetStudentId, status: 'pending' }]);
        if (error) throw error;
        showSuccessModal('สำเร็จ!', `ส่งคำขอเป็นเพื่อนกับ ${targetStudentId} แล้ว!`);
    } catch (err) { alert('เกิดข้อผิดพลาดในการส่งคำขอ: ' + err.message); }
};

window.joinPublicGroupDirect = async function(roomId, roomName) {
    const myStudentId = localStorage.getItem('sut_student_id');
    try {
        await supabaseClient.from('chat_room_members').upsert([{ room_id: roomId, student_id: myStudentId, role: 'member', status: 'joined' }], { onConflict: 'room_id,student_id' });
        closeModal('modal-add-friend');
        await loadChatRooms();
        selectChatRoom(roomId, roomName);
    } catch (err) { alert('ไม่สามารถเข้ากลุ่มได้: ' + err.message); }
};

window.requestJoinPrivateGroup = async function(roomId, roomName) {
    const myStudentId = localStorage.getItem('sut_student_id');
    try {
        const { error } = await supabaseClient.from('chat_room_members').insert([{ room_id: roomId, student_id: myStudentId, role: 'member', status: 'pending' }]);
        if (error) throw error;
        showSuccessModal('สำเร็จ!', `ส่งคำขอเข้าร่วมกลุ่ม "${roomName}" แล้ว รอแอดมินอนุมัติครับ`);
    } catch (err) { alert('ส่งคำขอไม่สำเร็จ หรือคุณเคยส่งคำขอไปแล้ว: ' + err.message); }
};

