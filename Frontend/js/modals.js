// ==========================================
// ❓ ระบบแจ้งเตือนยืนยัน (Confirm Modal) สไตล์โมเดิร์น
// ==========================================
window.showConfirmModal = function(title, descHTML, onConfirm) {
    let modal = document.getElementById('modal-custom-confirm');
    if (!modal) {
        const html = `
        <div id="modal-custom-confirm" class="chat-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10005; align-items: center; justify-content: center; backdrop-filter: blur(3px);">
            <div style="background: white; width: 90%; max-width: 400px; border-radius: 16px; padding: 30px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.2); animation: fadeIn 0.3s ease;">
                <div style="width: 70px; height: 70px; background: #fee2e2; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px auto;">
                    <i class="fa-solid fa-trash-can" style="font-size: 35px; color: #ef4444;"></i>
                </div>
                <h3 id="confirm-modal-title" style="margin: 0 0 10px 0; color: #1f2937; font-size: 20px; font-weight: 600;">ยืนยัน</h3>
                <div id="confirm-modal-desc" style="color: #4b5563; font-size: 14px; margin-bottom: 25px; line-height: 1.5;"></div>
                <div style="display: flex; gap: 10px;">
                    <button id="btn-confirm-cancel" style="flex: 1; background: #f3f4f6; color: #4b5563; border: none; padding: 12px; border-radius: 10px; font-weight: 600; cursor: pointer; font-family: 'Prompt'; transition: 0.2s;" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='#f3f4f6'">ยกเลิก</button>
                    <button id="btn-confirm-ok" style="flex: 1; background: #ef4444; color: white; border: none; padding: 12px; border-radius: 10px; font-weight: 600; cursor: pointer; font-family: 'Prompt'; transition: 0.2s; box-shadow: 0 4px 6px rgba(239, 68, 68, 0.2);" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">ยืนยันลบ</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        modal = document.getElementById('modal-custom-confirm');
    }

    // กำหนดข้อความ
    document.getElementById('confirm-modal-title').innerText = title;
    document.getElementById('confirm-modal-desc').innerHTML = descHTML;
    modal.style.display = 'flex';

    // ผูกคำสั่งปุ่ม
    document.getElementById('btn-confirm-cancel').onclick = function() {
        modal.style.display = 'none';
    };
    document.getElementById('btn-confirm-ok').onclick = function() {
        modal.style.display = 'none';
        if (typeof onConfirm === 'function') onConfirm();
    };    
};


// ==========================================
// ⚠️ ระบบแจ้งเตือนข้อผิดพลาด (Error / Alert Modal) สไตล์โมเดิร์น
// ==========================================
window.showErrorModal = function(title, descHTML) {
    let modal = document.getElementById('modal-custom-error');
    if (!modal) {
        const html = `
        <div id="modal-custom-error" class="chat-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10010; align-items: center; justify-content: center; backdrop-filter: blur(3px);">
            <div style="background: white; width: 90%; max-width: 380px; border-radius: 16px; padding: 30px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.2); animation: fadeIn 0.3s ease;">
                <div style="width: 70px; height: 70px; background: #fff7ed; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px auto;">
                    <i class="fa-solid fa-circle-exclamation" style="font-size: 35px; color: #F05A28;"></i>
                </div>
                <h3 id="error-modal-title" style="margin: 0 0 10px 0; color: #1f2937; font-size: 20px; font-weight: 600;">แจ้งเตือน</h3>
                <div id="error-modal-desc" style="color: #4b5563; font-size: 14px; margin-bottom: 25px; line-height: 1.5;"></div>
                <button onclick="document.getElementById('modal-custom-error').style.display='none'" style="width: 100%; background: #F05A28; color: white; border: none; padding: 12px; border-radius: 10px; font-weight: 600; cursor: pointer; font-family: 'Prompt'; transition: 0.2s; box-shadow: 0 4px 6px rgba(240, 90, 40, 0.2);" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'">เข้าใจแล้ว</button>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        modal = document.getElementById('modal-custom-error');
    }
    
    document.getElementById('error-modal-title').innerText = title;
    document.getElementById('error-modal-desc').innerHTML = descHTML;
    modal.style.display = 'flex';
};

// ==========================================
// 🗑️ ฟังก์ชันยืนยันการลบวิชาบนตาราง (ใช้ Modal สวยงาม)
// ==========================================
window.confirmRemoveCourse = function(courseId, courseCode) {
    showConfirmModal(
        'ยืนยันการลบรายวิชา',
        `ต้องการลบวิชา <b>${courseCode}</b> ออกจากตารางใช่หรือไม่?`,
        function() {
            // คำสั่งนี้จะทำงานเมื่อผู้ใช้กดปุ่ม "ยืนยันลบ" สีแดง
            window.removeCourseFromList(courseId);
        }
    );
};

