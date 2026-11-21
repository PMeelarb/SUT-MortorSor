window.showWarningModal = async function(title, message) {
    if (await window.confirmAppAction(message, { title, confirmText: 'ดูจุดที่เวลาชน' })) window.closeWarningAndScrollToTable();
};

window.closeWarningAndScrollToTable = function() {
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

