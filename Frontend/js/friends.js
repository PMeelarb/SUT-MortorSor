// ==========================================
// 🤝 ฟังก์ชันจัดการคำขอเป็นเพื่อน (รับ/ปฏิเสธ)
// ==========================================
window.handleFriendRequest = async function(requesterId, newStatus) {
    const myId = localStorage.getItem('sut_student_id');
    if (!myId) return;

    try {
        if (newStatus === 'accepted') {
            // ถ้ารับแอด ให้อัปเดตสถานะใน Database เป็น accepted
            const { error } = await supabaseClient
                .from('friendships')
                .update({ status: 'accepted' })
                .eq('requester_id', requesterId)
                .eq('receiver_id', myId);
            
            if (error) throw error;
            showSuccessModal('สำเร็จ!', `คุณได้เป็นเพื่อนกับ ${requesterId} เรียบร้อยแล้ว`);
            
        } else if (newStatus === 'rejected') {
            // ถ้ากดลบ ให้ลบคำขอนั้นออกจาก Database
            const { error } = await supabaseClient
                .from('friendships')
                .delete()
                .eq('requester_id', requesterId)
                .eq('receiver_id', myId);
            
            if (error) throw error;
        }
        
        // รีเฟรชรายชื่อเพื่อนและกล่องคำขอใหม่ทันที
        await loadFriendsData();
        
    } catch (err) {
        console.error("Friend request error: ", err);
        window.showAppNotice('เกิดข้อผิดพลาดในการจัดการคำขอ: ' + err.message);
    }
};

window.inviteFriendToGroup = async function() {
    if (!currentChatRoomId) return;

    const myId = localStorage.getItem('sut_student_id');

    Swal.fire({
        title: 'กำลังโหลดรายชื่อเพื่อน...',
        allowOutsideClick: false,
        scrollbarPadding: false, // 🛑 คำสั่งนี้จะห้ามไม่ให้พื้นหลังขยับ
        heightAuto: false,       // 🛑 ห้ามหน้าต่างยืดหดเอง
        didOpen: () => { Swal.showLoading() }
    });

    try {
        const { data: friendsData, error: fError } = await supabaseClient
            .from('friendships')
            .select('*')
            .or(`requester_id.eq.${myId},receiver_id.eq.${myId}`)
            .eq('status', 'accepted');

        if (fError) throw fError;

        let friendIds = [];
        if (friendsData) {
            friendIds = friendsData.map(f => f.requester_id === myId ? f.receiver_id : f.requester_id);
        }

        if (friendIds.length === 0) {
            return Swal.fire({
                icon: 'info',
                title: 'ไม่มีเพื่อนในระบบ',
                text: 'คุณต้องเพิ่มเพื่อนก่อน ถึงจะเชิญเข้ากลุ่มได้ครับ',
                confirmButtonColor: '#F05A28',
                scrollbarPadding: false, 
                heightAuto: false        
            });
        }

        const { data: profiles, error: directoryError } = await supabaseClient
            .from('profile_directory')
            .select('student_id, first_name, last_name')
            .in('student_id', friendIds);

        if (directoryError) throw directoryError;
        const profileMap = new Map(profiles.map(p => [p.student_id, `${p.first_name || ''} ${p.last_name || ''}`.trim()]));

        let htmlContent = '<div style="max-height: 300px; overflow-y: auto; text-align: left; padding: 5px;">';
        
        friendIds.forEach((fId, index) => {
            const fName = profileMap.get(fId) || 'ไม่ระบุชื่อ';
            htmlContent += `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 10px; border-bottom: 1px solid #e5e7eb; transition: background 0.2s;" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='transparent'">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 40px; height: 40px; background: #dbeafe; color: #2563eb; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 16px;">
                            ${escapeCourseHTML(fId.substring(0, 1))}
                        </div>
                        <div>
                            <div style="font-weight: 600; font-size: 14px; color: #111;">${escapeCourseHTML(fId)}</div>
                            <div style="font-size: 12px; color: #6b7280;">${escapeCourseHTML(fName)}</div>
                        </div>
                    </div>
                    <button data-friend-index="${index}" style="background: #10b981; color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'Prompt'; transition: 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                        <i class="fa-solid fa-plus"></i> เชิญ
                    </button>
                </div>
            `;
        });
        htmlContent += '</div>';

        Swal.fire({
            title: '<span style="font-size: 20px;">เลือกเพื่อนเพื่อเชิญเข้ากลุ่ม</span>',
            html: htmlContent,
            didOpen: popup => {
                popup.querySelectorAll('[data-friend-index]').forEach(button => {
                    const friendId = friendIds[Number(button.dataset.friendIndex)];
                    button.addEventListener('click', () => confirmInviteToGroup(friendId));
                });
            },
            showConfirmButton: false,
            showCloseButton: true,
            width: '450px',
            scrollbarPadding: false, // 🛑 ล็อคพื้นหลัง
            heightAuto: false        // 🛑 ล็อคหน้าต่าง
        });

    } catch (err) {
        Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: 'ดึงรายชื่อเพื่อนไม่สำเร็จ: ' + err.message,
            scrollbarPadding: false,
            heightAuto: false
        });
    }
};

window.confirmInviteToGroup = async function(targetId) {
    try {
        const { data: existData } = await supabaseClient.from('chat_room_members')
            .select('*').eq('room_id', currentChatRoomId).eq('student_id', targetId);
            
        if (existData && existData.length > 0) {
            return Swal.fire({
                icon: 'warning',
                title: 'เชิญซ้ำไม่ได้',
                text: 'เพื่อนคนนี้อยู่ในกลุ่มแล้ว หรือส่งคำขอไปแล้วครับ',
                scrollbarPadding: false, 
                heightAuto: false        
            });
        }

        const { error } = await supabaseClient.from('chat_room_members').insert([{ 
            room_id: currentChatRoomId, 
            student_id: targetId, 
            role: 'member', 
            status: 'joined' 
        }]);

        if (error) throw error;
        
        Swal.fire({
            icon: 'success',
            title: 'สำเร็จ!',
            text: `เชิญ ${targetId} เข้ากลุ่มเรียบร้อยแล้ว!`,
            timer: 2000,
            showConfirmButton: false,
            scrollbarPadding: false, 
            heightAuto: false        
        });
        
        fetchGroupMembers(); 
        
    } catch (err) {
        Swal.fire({
            icon: 'error',
            title: 'เกิดข้อผิดพลาด',
            text: 'ไม่สามารถเชิญเพื่อนได้: ' + err.message,
            scrollbarPadding: false,
            heightAuto: false
        });
    }
};

