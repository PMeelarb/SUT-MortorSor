// ==========================================
// 🗑️ ฟังก์ชันรีเซ็ตตารางเรียน
// ==========================================
// ==========================================
// 🗑️ ฟังก์ชันล้างตารางเรียน (ใช้ Modal สวยงาม)
// ==========================================
window.resetTimetable = function() {
    showConfirmModal(
        'ยืนยันการล้างตาราง', 
        `คุณแน่ใจหรือไม่ว่าต้องการล้างวิชาทั้งหมดในตารางเทอมนี้?<br><span style="color: #ef4444; font-size: 13px;">(ข้อมูลจะถูกลบออกเฉพาะบนหน้าจอ หากต้องการบันทึกถาวรต้องกดปุ่ม Save ตารางอีกครั้ง)</span>`,
        function() {
            // โค้ดส่วนนี้จะทำงานเมื่อผู้ใช้กดปุ่ม "ยืนยันลบ"
            
            // 1. ล้างข้อมูลวิชาในตัวแปรของเทอมปัจจุบัน
            selectedCourseIds = [];
            selectedCoursesData = [];
            
            // 2. เอาติ๊กถูกออกจาก Checkboxในรายชื่อวิชาด้านล่างทั้งหมด
            document.querySelectorAll('.course-checkbox').forEach(cb => {
                cb.checked = false;
            });

            // 3. อัปเดตตารางหน้าจอให้โล่ง
            updateDatabaseTimetableAndCredits();
            
            // 4. แจ้งเตือนว่าล้างเสร็จแล้ว
            if(typeof showSuccessModal === 'function') {
                showSuccessModal('ล้างตารางสำเร็จ', 'เคลียร์ข้อมูลตารางเรียนบนหน้าจอเรียบร้อยแล้วครับ');
            } else {
                alert('ล้างข้อมูลตารางเรียนเรียบร้อยแล้วครับ');
            }
        }
    );
};


// ==========================================
// 📸 ฟังก์ชันบันทึกตารางเรียนเป็นรูปภาพ (ด้วย html2canvas)
// ==========================================
window.downloadTimetableImage = function(btnElement) {
    const gridElement = document.getElementById('timetable-grid');
    if(!gridElement) return alert('ไม่พบตารางเรียนในหน้าจอครับ');

    // เก็บข้อความเดิมของปุ่มไว้ แล้วเปลี่ยนเป็นสถานะโหลด
    const originalContent = btnElement.innerHTML;
    btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังประมวลผล...';
    btnElement.disabled = true;

    // สั่งให้ html2canvas ถ่ายภาพเฉพาะส่วนที่เป็นตาราง
    html2canvas(gridElement, {
        scale: 2, // เพิ่มสเกลให้ภาพคมชัดระดับ HD
        backgroundColor: '#1f2937', // ตั้งสีพื้นหลังให้ตรงกับสีตาราง
        useCORS: true // อนุญาตให้ดึงข้อมูลข้ามโดเมน (ถ้ามี)
    }).then(canvas => {
        // แปลงภาพวาดเป็นลิงก์ข้อมูลภาพ PNG
        const imageURL = canvas.toDataURL("image/png");
        
        // จำลองการกดคลิกเพื่อดาวน์โหลดไฟล์ลงเครื่อง
        const link = document.createElement('a');
        link.href = imageURL;
        link.download = `SUT_Schedule_Year${currentYearLevel}_Sem${currentSemester}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // คืนค่าสถานะปุ่มกลับเป็นปกติ
        btnElement.innerHTML = originalContent;
        btnElement.disabled = false;
    }).catch(err => {
        console.error("Error capturing image: ", err);
        alert("เกิดข้อผิดพลาดในการบันทึกรูปภาพครับ กรุณาลองใหม่อีกครั้ง");
        btnElement.innerHTML = originalContent;
        btnElement.disabled = false;
    });
};

// ==========================================
// ➕➖ ระบบเพิ่ม/ลบ ชั้นปีแบบไดนามิก (รองรับแถวเดียวกัน)
// ==========================================
let maxYearCount = 4; // เริ่มต้นที่ 4 ปี

window.addNewYearTab = function() {
    maxYearCount++; 
    const targetYear = maxYearCount; 
    const addBtn = document.getElementById('btn-add-year');
    const removeBtn = document.getElementById('btn-remove-year');
    
    if (!addBtn) return;

    // สร้างปุ่มชั้นปีใหม่
    const newTab = document.createElement('button');
    newTab.className = 'year-tab';
    newTab.innerHTML = `<i class="fa-solid fa-graduation-cap"></i> ชั้นปี ${targetYear}`;
    
    // ผูกระบบสลับหน้าตาราง
    newTab.addEventListener('click', function() {
        const oldKey = `${currentYearLevel}_${currentSemester}`;
        scheduleCache[oldKey] = { 
            ids: JSON.parse(JSON.stringify(selectedCourseIds)), 
            data: JSON.parse(JSON.stringify(selectedCoursesData)) 
        };

        document.querySelectorAll('.year-tab').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        
        currentYearLevel = targetYear; 
        loadSchedule(); 
    });

    // แทรกปุ่มใหม่ไว้ก่อนหน้าปุ่ม "+ เพิ่ม"
    addBtn.parentNode.insertBefore(newTab, addBtn);
    
    // โชว์ปุ่มลบเมื่อมีชั้นปีที่ 5 ขึ้นไป
    if(removeBtn) {
        removeBtn.style.display = 'flex';
    }
};

window.removeNewYearTab = function() {
    if (maxYearCount <= 4) return; 
    
    const targetYear = maxYearCount;
    const tabToRemove = document.querySelectorAll('.year-tab')[targetYear - 1]; 
    
    if (tabToRemove) {
        // ใช้หน้าต่าง Confirm แบบใหม่ที่เราสร้างขึ้นมาแทน alert ดำๆ
        showConfirmModal(
            'ยืนยันการลบชั้นปี', 
            `คุณแน่ใจหรือไม่ว่าต้องการลบ <b>"ชั้นปีที่ ${targetYear}"</b> ออก?<br><span style="color: #ef4444; font-size: 13px;">(ข้อมูลวิชาที่จัดไว้ในชั้นปีนี้จะถูกลบทั้งหมด)</span>`,
            function() {
                // โค้ดนี้จะทำงานเมื่อผู้ใช้กด "ยืนยันลบ"
                tabToRemove.remove();
                
                for(let i = 1; i <= 3; i++) {
                    delete scheduleCache[`${targetYear}_${i}`];
                }

                maxYearCount--;
                
                if (currentYearLevel === targetYear) {
                    const lastTab = document.querySelectorAll('.year-tab')[maxYearCount - 1];
                    if(lastTab) lastTab.click();
                }
                
                const removeBtn = document.getElementById('btn-remove-year');
                if(maxYearCount === 4 && removeBtn) {
                    removeBtn.style.display = 'none';
                }
            }
        );
    }
};
