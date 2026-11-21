window.showConfirmModal = async function(title, message, onConfirm) {
    if (await window.confirmAppAction(message, { title, confirmText: 'ยืนยันลบ', tone: 'danger' })) return onConfirm?.();
};

window.showErrorModal = function(title, message) {
    window.showAppNotice(message, { title, tone: 'error' });
};

window.confirmRemoveCourse = function(courseId, courseCode) {
    showConfirmModal(
        'ยืนยันการลบรายวิชา',
        `ต้องการลบวิชา ${courseCode} ออกจากตารางใช่หรือไม่?`,
        function() {
            // คำสั่งนี้จะทำงานเมื่อผู้ใช้กดปุ่ม "ยืนยันลบ" สีแดง
            window.removeCourseFromList(courseId);
        }
    );
};

