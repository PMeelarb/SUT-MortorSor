// ==========================================
// 🚨 ระบบแจ้งเตือนปัญหา (Warning Modal) & สไลด์ไปดูตาราง
// ==========================================

window.showWarningModal = function(title, descHTML) {
    if (!document.getElementById('modal-warning-alert')) {
        const html = `
        <div id="modal-warning-alert" class="chat-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 10001; align-items: center; justify-content: center; backdrop-filter: blur(3px);">
            <div style="background: white; width: 90%; max-width: 420px; border-radius: 16px; padding: 30px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.2); animation: fadeIn 0.3s ease;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size: 55px; color: #F05A28; margin-bottom: 15px;"></i>
                <h3 id="warning-alert-title" style="margin: 0 0 15px 0; color: #1f2937; font-size: 20px; font-weight: 600;">แจ้งเตือน</h3>
                <div id="warning-alert-desc" style="color: #4b5563; font-size: 14px; margin-bottom: 25px; line-height: 1.6; text-align: left; background: #fff7ed; padding: 15px; border-radius: 10px; border: 1px solid #fed7aa; max-height: 150px; overflow-y: auto;"></div>
                <div style="display: flex; gap: 10px;">
                    <button onclick="document.getElementById('modal-warning-alert').style.display='none'" style="flex: 1; background: #f3f4f6; color: #4b5563; border: none; padding: 12px; border-radius: 10px; font-weight: 600; cursor: pointer; font-family: 'Prompt'; transition: 0.2s;">ปิด</button>
                    <button onclick="closeWarningAndScrollToTable()" style="flex: 2; background: #F05A28; color: white; border: none; padding: 12px; border-radius: 10px; font-weight: 600; cursor: pointer; font-family: 'Prompt'; transition: 0.2s; box-shadow: 0 4px 6px rgba(240, 90, 40, 0.2);"><i class="fa-solid fa-magnifying-glass"></i> ดูจุดที่เวลาชน</button>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
    }
    document.getElementById('warning-alert-title').innerText = title;
    document.getElementById('warning-alert-desc').innerHTML = descHTML;
    document.getElementById('modal-warning-alert').style.display = 'flex';
};

window.closeWarningAndScrollToTable = function() {
    document.getElementById('modal-warning-alert').style.display = 'none';
    const grid = document.getElementById('timetable-grid');
    if (grid) {
        // เลื่อนหน้าจอไปที่ตารางเรียนอย่างนุ่มนวล
        grid.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // ทำให้ขอบตารางกระพริบสีส้มเพื่อให้รู้ว่าต้องดูตรงนี้
        grid.style.transition = 'box-shadow 0.4s ease';
        grid.style.boxShadow = '0 0 30px rgba(240, 90, 40, 0.6)';
        setTimeout(() => { grid.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)'; }, 2000);
    }
};

