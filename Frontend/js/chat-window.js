// ==========================================
// 🔘 ระบบแชทหน้าต่าง (ลากย้าย + ยืดหด 8 ทิศทาง)
// ==========================================
window.toggleChatExpand = function() {
    const chatSection = document.querySelector('.ai-chat-section');
    const expandIcon = document.querySelector('#btn-expand-chat i');
    if(!chatSection) return;

    chatSection.classList.toggle('expanded');
    
    if (chatSection.classList.contains('expanded')) {
        expandIcon.classList.replace('fa-expand', 'fa-compress');
        
        // 🔥 เซ็ตขนาดเริ่มต้นให้อยู่กลางจอ (ปรับได้ตามชอบ)
        chatSection.style.width = '70vw';
        chatSection.style.height = '80vh';
        chatSection.style.top = '10vh';
        chatSection.style.left = '15vw';
        chatSection.style.right = 'auto';
        chatSection.style.bottom = 'auto';
    } else {
        expandIcon.classList.replace('fa-compress', 'fa-expand');
        
        // คืนค่ากลับไปอยู่ตำแหน่งเดิม
        chatSection.style.width = '';
        chatSection.style.height = '';
        chatSection.style.top = '';
        chatSection.style.left = '';
    }
};

function setupDraggableChatWindow() {
    const chatBox = document.querySelector('.ai-chat-section');
    const header = chatBox ? chatBox.querySelector('div:first-child') : null; 
    if(!chatBox || !header) return;

    // ป้องกันการสร้าง Resizer ซ้ำถ้ากดรีเฟรช
    if (chatBox.querySelector('.chat-resizer')) return;

    // 1. ระบบจับลากย้ายหน้าต่าง (Drag)
    header.style.cursor = 'move';
    header.addEventListener('mousedown', function(e) {
        if(!chatBox.classList.contains('expanded')) return;
        if(e.target.closest('button')) return; // ถอยถ้าผู้ใช้กำลังกดปุ่มย่อ/ขยาย
        
        e.preventDefault();
        let startX = e.clientX, startY = e.clientY;
        let rect = chatBox.getBoundingClientRect();
        let startL = rect.left, startT = rect.top;
        
        function doMove(e) {
            chatBox.style.left = startL + (e.clientX - startX) + 'px';
            chatBox.style.top = startT + (e.clientY - startY) + 'px';
        }
        function stopMove() {
            document.removeEventListener('mousemove', doMove);
            document.removeEventListener('mouseup', stopMove);
        }
        document.addEventListener('mousemove', doMove);
        document.addEventListener('mouseup', stopMove);
    });

    // 2. ระบบยืดหด 8 ทิศทาง (Resize)
    const directions = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    directions.forEach(dir => {
        const handle = document.createElement('div');
        handle.className = `chat-resizer resizer-${dir}`;
        chatBox.appendChild(handle);
        
        handle.addEventListener('mousedown', function(e) {
            if(!chatBox.classList.contains('expanded')) return;
            e.preventDefault();
            e.stopPropagation(); // สำคัญมาก: ป้องกันไม่ให้ไปชนกับ Event อื่น
            
            let startX = e.clientX, startY = e.clientY;
            let rect = chatBox.getBoundingClientRect();
            let startW = rect.width, startH = rect.height;
            let startL = rect.left, startT = rect.top;

            function doResize(e) {
                let newW = startW, newH = startH, newL = startL, newT = startT;

                // คำนวณฝั่งขวา-ซ้าย
                if (dir.includes('e')) newW = startW + (e.clientX - startX);
                if (dir.includes('w')) {
                    newW = startW - (e.clientX - startX);
                    newL = startL + (e.clientX - startX);
                }
                
                // คำนวณฝั่งบน-ล่าง
                if (dir.includes('s')) newH = startH + (e.clientY - startY);
                if (dir.includes('n')) {
                    newH = startH - (e.clientY - startY);
                    newT = startT + (e.clientY - startY);
                }

                // ล็อคขนาดเล็กสุดไม่ให้หดจนแชทพัง
                if (newW > 350) { 
                    chatBox.style.width = newW + 'px'; 
                    chatBox.style.left = newL + 'px'; 
                }
                if (newH > 400) { 
                    chatBox.style.height = newH + 'px'; 
                    chatBox.style.top = newT + 'px'; 
                }
            }
            
            function stopResize() {
                document.removeEventListener('mousemove', doResize);
                document.removeEventListener('mouseup', stopResize);
            }
            
            document.addEventListener('mousemove', doResize);
            document.addEventListener('mouseup', stopResize);
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(setupDraggableChatWindow, 500);
});

