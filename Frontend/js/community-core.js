// ==========================================
// 2. ฟังก์ชันส่งข้อความแชทเข้าห้องรวม / ห้องส่วนตัว
// ==========================================
async function sendCommunityMessage() {
    const inputEl = document.getElementById('community-msg-input');
    if (!inputEl) return;
    
    const msg = inputEl.value.trim();
    if (!msg) return; 

    if (!currentChatRoomId) {
        window.showAppNotice('กรุณาเลือกห้องแชทเพื่อนด้านซ้ายมือก่อนส่งข้อความครับ');
        return;
    }

    const studentId = localStorage.getItem('sut_student_id');
    const originalText = inputEl.value;
    
    // เคลียร์ช่องพิมพ์ทันทีให้รู้สึกว่าส่งแล้ว
    inputEl.value = ''; 

    try {
        const { error } = await supabaseClient.from('chat_messages').insert([
            { room_id: currentChatRoomId, sender_id: studentId, message: msg }
        ]);
        
        if (error) {
            inputEl.value = originalText; // ถ้าเน็ตหลุด/ส่งไม่สำเร็จ คืนข้อความกลับมาให้
            throw error;
        }
    } catch (err) {
        console.error("Send message error:", err);
        window.showAppNotice('ส่งข้อความไม่สำเร็จ: ' + err.message);
    }
}

window.openModal = function(id) { document.getElementById(id).style.display = 'flex'; };
window.closeModal = function(id) { document.getElementById(id).style.display = 'none'; };
window.onclick = function(event) { if (event.target.classList.contains('chat-modal')) event.target.style.display = "none"; };

