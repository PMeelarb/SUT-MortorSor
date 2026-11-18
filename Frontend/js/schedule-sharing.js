// ==========================================
// 🔗 ระบบแชร์ตารางเรียนลงแชท & ดึงตารางเรียนจากเพื่อน
// ==========================================

// ==========================================
// 🔗 ระบบแชร์ตารางเรียนลงแชท (UI Pop-up ให้เลือก ปี/เทอม)
// ==========================================

// 1. ฟังก์ชันเปิดหน้าต่าง Pop-up เลือกปีและเทอมที่จะแชร์
window.shareMyScheduleToChat = function() {
    if (!currentChatRoomId) return alert("⚠️ กรุณาเลือกห้องแชทเพื่อนก่อนครับ");
    
    // ตรวจสอบและสร้าง UI Modal ขึ้นมาถ้ายังไม่มี
    createShareModalIfNotExist();
    
    // ตั้งค่าตัวเลือกเริ่มต้นให้ตรงกับหน้าตารางที่เปิดอยู่ปัจจุบัน
    document.getElementById('share-target-year').value = currentYearLevel;
    document.getElementById('share-target-sem').value = currentSemester;
    
    // เปิดหน้าต่าง Pop-up
    openModal('modal-share-schedule-select');
};

// 2. ฟังก์ชันยืนยันดึงข้อมูลตารางและแชร์ลงแชท (ทำงานเมื่อกดปุ่ม "แชร์เลย")
window.executeShareSchedule = async function() {
    const btn = document.getElementById('btn-confirm-share');
    const originalText = btn.innerHTML;
    
    const targetYear = parseInt(document.getElementById('share-target-year').value);
    const targetSem = parseInt(document.getElementById('share-target-sem').value);
    const targetKey = `${targetYear}_${targetSem}`;
    
    let dataToShare = [];
    
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังเตรียมข้อมูล...';
    btn.disabled = true;

    try {
        // เช็คว่าผู้ใช้เลือกแชร์เทอมที่เปิดอยู่บนหน้าจอตอนนี้หรือไม่
        if (targetYear === currentYearLevel && targetSem === currentSemester) {
            dataToShare = JSON.parse(JSON.stringify(selectedCoursesData));
        } 
        // ถ้าแชร์เทอมอื่น ให้ลองหาข้อมูลจากความจำ (Cache) ของเว็บก่อน
        else if (scheduleCache[targetKey] && scheduleCache[targetKey].data.length > 0) {
            dataToShare = JSON.parse(JSON.stringify(scheduleCache[targetKey].data));
        } 
        // หากไม่มีในความจำ ให้ดิ่งไปดึงจากฐานข้อมูล Supabase สดๆ
        else {
            const studentId = localStorage.getItem('sut_student_id');
            const { data, error } = await supabaseClient
                .from('user_schedules')
                .select('course_ids')
                .eq('student_id', studentId)
                .eq('year_level', targetYear)
                .eq('semester', targetSem)
                .maybeSingle();
                
            if (error) throw error;
            if (data && data.course_ids && data.course_ids.length > 0) {
                dataToShare = data.course_ids;
                // เก็บใส่ความจำไว้ด้วยเผื่อใช้รอบหน้า
                scheduleCache[targetKey] = {
                    ids: dataToShare.map(c => c.id),
                    data: JSON.parse(JSON.stringify(dataToShare))
                };
            }
        }

        // ถ้าดึงมาแล้วพบว่าตารางว่างเปล่า ให้แจ้งเตือนและหยุดการแชร์
        if (!dataToShare || dataToShare.length === 0) {
            alert(`⚠️ คุณยังไม่มีวิชาเรียนในตาราง ปี ${targetYear} เทอม ${targetSem} ครับ\nกรุณาจัดตารางเรียนก่อนนำมาแชร์นะครับ`);
            btn.innerHTML = originalText;
            btn.disabled = false;
            return;
        }

        // แพ็กข้อมูลใส่กล่องแล้วส่งเข้าห้องแชท
        const studentId = localStorage.getItem('sut_student_id');
        const payload = {
            year: targetYear,
            sem: targetSem,
            courses: dataToShare
        };
        const msgString = "SYS_SHARE:" + JSON.stringify(payload);

        await supabaseClient.from('chat_messages').insert([
            { room_id: currentChatRoomId, sender_id: studentId, message: msgString }
        ]);

        closeModal('modal-share-schedule-select');

    } catch (error) {
        console.error("Share Error:", error);
        alert("❌ เกิดข้อผิดพลาดในการแชร์ตาราง: " + error.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// 3. ตัวช่วยสร้าง UI Pop-up หน้าเลือกแชร์ตารางฝังลงในเว็บ
function createShareModalIfNotExist() {
    if (document.getElementById('modal-share-schedule-select')) return;
    const modalHtml = `
        <div id="modal-share-schedule-select" class="chat-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; align-items: center; justify-content: center; backdrop-filter: blur(3px);">
            <div class="modal-content" style="background: white; width: 95%; max-width: 450px; border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.3); animation: fadeIn 0.3s ease;">
                <div style="padding: 20px 25px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; background: #ffffff;">
                    <h3 style="margin: 0; color: #111827; font-size: 20px; display: flex; align-items: center; gap: 10px;"><i class="fa-solid fa-share-nodes" style="color: #F05A28; font-size: 24px;"></i> แชร์ตารางเรียนให้เพื่อน</h3>
                    <span class="close-modal" onclick="closeModal('modal-share-schedule-select')" style="cursor: pointer; font-size: 28px; color: #9ca3af; line-height: 1; padding: 0 5px;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#9ca3af'">&times;</span>
                </div>
                <div style="padding: 25px; background: #f9fafb;">
                    <p style="margin-top: 0; margin-bottom: 20px; font-size: 14px; color: #4b5563;">กรุณาเลือกปีการศึกษาและเทอมของตารางเรียนที่คุณต้องการแชร์ลงในห้องแชทนี้ครับ</p>
                    
                    <div style="display: flex; gap: 15px; margin-bottom: 25px;">
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 13px; font-weight: 600; color: #1f2937; margin-bottom: 8px;">ชั้นปี</label>
                            <select id="share-target-year" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #d1d5db; background: white; font-family: 'Prompt'; font-size: 15px; color: #1f2937; cursor: pointer; outline: none;">
                                <option value="1">ปี 1</option>
                                <option value="2">ปี 2</option>
                                <option value="3">ปี 3</option>
                                <option value="4">ปี 4</option>
                            </select>
                        </div>
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 13px; font-weight: 600; color: #1f2937; margin-bottom: 8px;">เทอม</label>
                            <select id="share-target-sem" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #d1d5db; background: white; font-family: 'Prompt'; font-size: 15px; color: #1f2937; cursor: pointer; outline: none;">
                                <option value="1">เทอม 1</option>
                                <option value="2">เทอม 2</option>
                                <option value="3">เทอม 3</option>
                            </select>
                        </div>
                    </div>

                    <div style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button onclick="closeModal('modal-share-schedule-select')" style="padding: 12px 20px; border-radius: 10px; border: 1px solid #d1d5db; background: white; color: #4b5563; cursor: pointer; font-family: 'Prompt'; font-weight: 500; font-size: 15px; transition: 0.2s;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">ยกเลิก</button>
                        <button id="btn-confirm-share" onclick="executeShareSchedule()" style="padding: 12px 24px; border-radius: 10px; border: none; background: #F05A28; color: white; cursor: pointer; font-family: 'Prompt'; font-weight: 600; font-size: 15px; transition: 0.2s; box-shadow: 0 4px 6px rgba(240, 90, 40, 0.2);" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 12px rgba(240, 90, 40, 0.3)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px rgba(240, 90, 40, 0.2)';"><i class="fa-solid fa-paper-plane"></i> แชร์เลย</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}
// ==========================================
// 📥 ระบบพรีวิวและนำเข้าตารางเรียนจากเพื่อน (UI อัปเกรดใหม่)
// ==========================================

let pendingImportCourses = []; // ตัวแปรเก็บข้อมูลตารางเพื่อนชั่วคราวรอผู้ใช้กดยืนยัน

// 1. ฟังก์ชันเปิดหน้าต่างพรีวิวเมื่อกด "เช็คข้อมูลตาราง / ดึงตาราง"
window.importSharedSchedule = function(jsonStr, year, sem) {
    try {
        const decodedJson = jsonStr.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        pendingImportCourses = JSON.parse(decodedJson);

        if (!pendingImportCourses || pendingImportCourses.length === 0) return alert('ตารางเรียนนี้ว่างเปล่าครับ');

        // ตรวจสอบและสร้าง UI Modal ขึ้นมาถ้ายังไม่มี
        createPreviewModalIfNotExist();

        // นำรายวิชาของเพื่อนมาแสดงในรายการพรีวิว
        const listContainer = document.getElementById('preview-schedule-list');
        listContainer.innerHTML = '';
        pendingImportCourses.forEach(c => {
            const timeStr = c.no_time ? 'ไม่มีข้อมูลเวลาเรียน' : `${c.day} ${c.start}.00-${c.end}.00 น.`;
            const iconColor = c.no_time ? '#9ca3af' : '#F05A28';
            listContainer.innerHTML += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; border-bottom: 1px solid #f3f4f6; font-size: 13px; transition: background 0.2s;" onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='transparent'">
                    <div>
                        <strong style="color: #1f2937; font-size: 14px;">${window.formatCourseCodeDisplay(c.code)}</strong><br>
                        <span style="color: #6b7280; font-size: 12px;">${c.name}</span>
                    </div>
                    <div style="color: ${iconColor}; text-align: right; background: ${c.no_time ? '#f3f4f6' : '#fff7ed'}; padding: 6px 10px; border-radius: 8px;">
                        <i class="fa-regular fa-clock"></i> ${timeStr}
                    </div>
                </div>
            `;
        });

        // ตั้งค่าตัวเลือก ปี/เทอม ให้ตรงกับที่เพื่อนส่งมาเป็นค่าเริ่มต้น
        document.getElementById('import-target-year').value = year || 1;
        document.getElementById('import-target-sem').value = sem || 1;

        // แสดงหน้าต่าง Pop-up
        openModal('modal-preview-schedule');

    } catch(e) {
        console.error("Import error:", e);
        alert('เกิดข้อผิดพลาดในการอ่านข้อมูลตารางเรียนครับ');
    }
};

// 2. ฟังก์ชันยืนยันบันทึกวิชาลงตาราง (ทำงานเมื่อกดปุ่มเขียวใน Pop-up)
window.executeImportSharedSchedule = function() {
    const targetYear = parseInt(document.getElementById('import-target-year').value);
    const targetSem = parseInt(document.getElementById('import-target-sem').value);
    const targetKey = `${targetYear}_${targetSem}`;

    let targetIds = [];
    let targetData = [];
    let isActiveTerm = (targetYear === currentYearLevel && targetSem === currentSemester);

    // ตรวจสอบว่าผู้ใช้เลือกลงเทอมปัจจุบัน หรือเลือกลงเทอมอื่น (เซฟลง Cache)
    if (isActiveTerm) {
        targetIds = selectedCourseIds;
        targetData = selectedCoursesData;
    } else {
        if (!scheduleCache[targetKey]) scheduleCache[targetKey] = { ids: [], data: [] };
        targetIds = scheduleCache[targetKey].ids;
        targetData = scheduleCache[targetKey].data;
    }

    let added = 0;
    let skipped = 0;

    // ระบบช่วยกรองวิชาซ้ำและเวลาชน
    pendingImportCourses.forEach(sharedCourse => {
        const baseCode = sharedCourse.code.split(' (')[0];
        const isExist = targetData.some(c => c.code.split(' (')[0] === baseCode);
        
        if (!isExist) {
            let isOverlap = false;
            if (!sharedCourse.no_time && sharedCourse.day !== '-' && sharedCourse.start > 0) {
                for (let existingCourse of targetData) {
                    if (existingCourse.day === sharedCourse.day && !existingCourse.no_time) {
                        if (sharedCourse.start < existingCourse.end && sharedCourse.end > existingCourse.start) {
                            isOverlap = true; break;
                        }
                    }
                }
            }

            if (!isOverlap) {
                const newId = `FRIEND_${baseCode}_${Date.now()}_${Math.floor(Math.random()*1000)}`;
                targetData.push({ ...sharedCourse, id: newId });
                targetIds.push(newId);
                added++;
            } else {
                skipped++;
            }
        } else {
            skipped++;
        }
    });

    // อัปเดตตารางหน้าจอทันที หากนำเข้าใส่เทอมปัจจุบัน
    if (isActiveTerm && added > 0) {
        updateDatabaseTimetableAndCredits();
    }

    closeModal('modal-preview-schedule');

    // แจ้งเตือนผลลัพธ์การดึงข้อมูล
    if (added > 0) {
        showSuccessModal('นำเข้าตารางสำเร็จ!', `ดึง ${added} รายวิชาลงตาราง ปี ${targetYear} เทอม ${targetSem} เรียบร้อยแล้ว\n(ระบบช่วยกรองออก ${skipped} วิชาเนื่องจากซ้ำหรือเวลาชน)`);
    } else {
        alert(`❌ ไม่มีวิชาถูกนำเข้า\n(วิชาทั้งหมดในตารางนี้ คุณมีอยู่แล้วหรือเวลาเรียนชนกันครับ)`);
    }
};

// 3. ตัวช่วยสร้าง UI Pop-up ฝังลงในเว็บแบบอัตโนมัติ
function createPreviewModalIfNotExist() {
    if (document.getElementById('modal-preview-schedule')) return;
    const modalHtml = `
        <div id="modal-preview-schedule" class="chat-modal" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; align-items: center; justify-content: center; backdrop-filter: blur(3px);">
            <div class="modal-content" style="background: white; width: 95%; max-width: 550px; border-radius: 16px; overflow: hidden; box-shadow: 0 25px 50px rgba(0,0,0,0.3); animation: fadeIn 0.3s ease;">
                <div style="padding: 20px 25px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; background: #ffffff;">
                    <h3 style="margin: 0; color: #111827; font-size: 20px; display: flex; align-items: center; gap: 10px;"><i class="fa-solid fa-calendar-check" style="color: #F05A28; font-size: 24px;"></i> พรีวิวตารางเรียน</h3>
                    <span class="close-modal" onclick="closeModal('modal-preview-schedule')" style="cursor: pointer; font-size: 28px; color: #9ca3af; line-height: 1; padding: 0 5px;" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#9ca3af'">&times;</span>
                </div>
                <div style="padding: 25px; background: #f9fafb;">
                    <p style="margin-top: 0; margin-bottom: 12px; font-size: 14px; font-weight: 600; color: #4b5563;">รายการวิชาที่มากับตารางนี้:</p>
                    <div id="preview-schedule-list" style="max-height: 250px; overflow-y: auto; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 10px; margin-bottom: 25px; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);">
                        <!-- รายวิชาจะถูกแทรกตรงนี้ -->
                    </div>
                    
                    <div style="display: flex; gap: 15px; margin-bottom: 25px; background: #fff7ed; padding: 18px; border-radius: 12px; border: 1px solid #fed7aa;">
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 13px; font-weight: 600; color: #c2410c; margin-bottom: 8px;"><i class="fa-solid fa-user-graduate"></i> เลือกลงชั้นปีที่</label>
                            <select id="import-target-year" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #fdba74; background: white; font-family: 'Prompt'; font-size: 15px; color: #1f2937; cursor: pointer; outline: none;">
                                <option value="1">ปี 1</option>
                                <option value="2">ปี 2</option>
                                <option value="3">ปี 3</option>
                                <option value="4">ปี 4</option>
                            </select>
                        </div>
                        <div style="flex: 1;">
                            <label style="display: block; font-size: 13px; font-weight: 600; color: #c2410c; margin-bottom: 8px;"><i class="fa-solid fa-book-open"></i> เลือกลงเทอมที่</label>
                            <select id="import-target-sem" style="width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #fdba74; background: white; font-family: 'Prompt'; font-size: 15px; color: #1f2937; cursor: pointer; outline: none;">
                                <option value="1">เทอม 1</option>
                                <option value="2">เทอม 2</option>
                                <option value="3">เทอม 3</option>
                            </select>
                        </div>
                    </div>

                    <div style="display: flex; gap: 12px; justify-content: flex-end;">
                        <button onclick="closeModal('modal-preview-schedule')" style="padding: 12px 20px; border-radius: 10px; border: 1px solid #d1d5db; background: white; color: #4b5563; cursor: pointer; font-family: 'Prompt'; font-weight: 500; font-size: 15px; transition: 0.2s;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='white'">ยกเลิก</button>
                        <button onclick="executeImportSharedSchedule()" style="padding: 12px 24px; border-radius: 10px; border: none; background: #10b981; color: white; cursor: pointer; font-family: 'Prompt'; font-weight: 600; font-size: 15px; transition: 0.2s; box-shadow: 0 4px 6px rgba(16, 185, 129, 0.2);" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 12px rgba(16, 185, 129, 0.3)';" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 6px rgba(16, 185, 129, 0.2)';"><i class="fa-solid fa-download"></i> บันทึกลงตารางนี้</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

// 3. เสกปุ่ม "แชร์ตาราง" ไปไว้ข้างๆ ช่องพิมพ์แชทอัตโนมัติ
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const chatInput = document.getElementById('community-msg-input');
        if (chatInput && chatInput.parentElement && !document.getElementById('btn-share-schedule')) {
            const wrapper = chatInput.parentElement;
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.gap = '10px';
            
            const shareBtn = document.createElement('button');
            shareBtn.id = 'btn-share-schedule';
            shareBtn.innerHTML = '<i class="fa-solid fa-calendar-plus"></i>';
            shareBtn.title = 'แชร์ตารางเรียนให้เพื่อน';
            shareBtn.style.cssText = 'background: #10b981; color: white; border: none; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; cursor: pointer; flex-shrink: 0; transition: 0.2s; box-shadow: 0 2px 5px rgba(0,0,0,0.1);';
            
            shareBtn.onmouseover = () => shareBtn.style.transform = 'scale(1.1)';
            shareBtn.onmouseout = () => shareBtn.style.transform = 'scale(1)';
            shareBtn.onclick = window.shareMyScheduleToChat;
            
            wrapper.insertBefore(shareBtn, chatInput);
        }
    }, 1500); // ดีเลย์นิดนึงรอให้ HTML โหลดเสร็จก่อน
});

