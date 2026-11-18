// ==========================================
// 🎯 6. ระบบแนะนำวิชาอัตโนมัติ
// ==========================================
// ==========================================
// ⚡ ระบบจัดตารางเรียนแบบเร่งด่วน (ดึงตามหน้า UI เป๊ะๆ แยกปี/เทอมชัดเจน + ออโต้เซฟ)
// ==========================================
window.handleAutoRecommend = async function() {
    const btn = document.getElementById('auto-plan-btn');
    
    // 1. เช็คว่าระบบรู้จักสาขาของผู้ใช้หรือยัง
    if (!selectedMajor || selectedMajor === 'ดึงข้อมูลจากระบบ...') {
        return showErrorModal('ไม่พบข้อมูลสาขา', 'กรุณาไปที่เมนู "ข้อมูลส่วนตัว" เพื่อระบุสำนักและสาขาวิชาก่อนจัดตารางเร่งด่วนครับ');
    }

    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังดึงแผนการเรียน...';
    btn.disabled = true;

    // 🎯 2. [สำคัญมาก] ดึง "ชั้นปี" จากปุ่ม Tab ที่กำลังถูกกด (Active) อยู่บนหน้าจอโดยตรง
    let targetYear = 1;
    const activeYearTab = document.querySelector('.year-tab.active');
    if (activeYearTab) {
        const match = activeYearTab.innerText.match(/\d+/);
        if (match) targetYear = parseInt(match[0]);
    }

    // 🎯 3. ดึง "เทอม" จากข้อความตรงกลาง (เช่น "เทอมที่ 2") บนหน้าจอโดยตรง
    let targetSem = 1;
    const semesterTextEl = document.getElementById('semester-text');
    if (semesterTextEl) {
        const match = semesterTextEl.innerText.match(/\d+/);
        if (match) targetSem = parseInt(match[0]);
    }

    try {
        // 4. ยิง API โดยใช้ ชั้นปีและเทอม ที่ดึงมาจากหน้าจอเมื่อกี้
        const majorParam = encodeURIComponent(selectedMajor);
        const response = await fetch(`http://localhost:3000/api/recommend?major=${majorParam}&year=${targetYear}&semester=${targetSem}`);
        const result = await response.json();

        if (result.status === "success" && result.data && result.data.length > 0) {
            let addedCount = 0;
            let overlapCount = 0;
            let overlapDetails = [];

            for (let planCourse of result.data) {
                const cleanCode = (planCourse.COURSECODE || planCourse.coursecode || '').replace(/\s+/g, '').toUpperCase();
                if (!cleanCode) continue;

                // เช็ควิชาซ้ำ
                const isExist = selectedCoursesData.some(c => c.code.replace(/\s+/g, '').toUpperCase().includes(cleanCode));
                if (isExist) continue;

                const name = planCourse.COURSENAME || planCourse.coursename || 'รายวิชาตามแผน';
                const creditStr = planCourse.COURSEUNIT || planCourse.courseunit || '0';
                const credit = parseInt(String(creditStr).split(' ')[0]) || 0;
                
                let dayName = planCourse.DAY_NAME || planCourse.day_name || '-';
                let startTime = planCourse.START_TIME || planCourse.start_time || '-';
                let endTime = planCourse.END_TIME || planCourse.end_time || '-';

                const dayMapObj = { '1':'อาทิตย์', '2':'จันทร์', '3':'อังคาร', '4':'พุธ', '5':'พฤหัสบดี', '6':'ศุกร์', '7':'เสาร์', 'MON':'จันทร์', 'TUE':'อังคาร', 'WED':'พุธ', 'THU':'พฤหัสบดี', 'FRI':'ศุกร์', 'SAT':'เสาร์', 'SUN':'อาทิตย์' };
                if (dayMapObj[dayName.toUpperCase()]) dayName = dayMapObj[dayName.toUpperCase()];

                let sHour = 0, eHour = 0;
                let noTimeFlag = true;

                if (startTime !== '-' && endTime !== '-' && dayName !== '-' && dayName !== 'ไม่ระบุวัน') {
                    sHour = parseInt(String(startTime).split(':')[0]);
                    let eHourRaw = parseInt(String(endTime).split(':')[0]);
                    let eMin = parseInt(String(endTime).split(':')[1]) || 0;
                    eHour = eMin > 0 ? eHourRaw + 1 : eHourRaw; 
                    if (!isNaN(sHour) && !isNaN(eHour)) noTimeFlag = false; 
                }

                // เช็คเวลาชน
                let isOverlap = false;
                let overlapCourseName = "";
                if (!noTimeFlag) {
                    for (let existingCourse of selectedCoursesData) {
                        if (existingCourse.day === dayName && !existingCourse.no_time) {
                            if (sHour < existingCourse.end && eHour > existingCourse.start) {
                                isOverlap = true; 
                                overlapCourseName = existingCourse.code;
                                break;
                            }
                        }
                    }
                }

                if (isOverlap) {
                    overlapCount++;
                    overlapDetails.push(`• <b>${cleanCode}</b> ทับซ้อนกับ <b>${overlapCourseName}</b>`);
                    continue; 
                }

                const uniqueId = `PLAN_${cleanCode}_${Date.now()}_${Math.floor(Math.random()*1000)}`;
                const displayCode = `${cleanCode} (G.1)`; 
                
                selectedCourseIds.push(uniqueId);
                selectedCoursesData.push({
                    id: uniqueId, 
                    code: displayCode, 
                    name: noTimeFlag ? `${name} (รายวิชาตามแผน)` : name, 
                    credits: credit, 
                    day: noTimeFlag ? '-' : dayName, 
                    start: noTimeFlag ? 0 : sHour, 
                    end: noTimeFlag ? 0 : eHour,
                    custom_mid_text: "-", 
                    custom_fin_text: "-", 
                    no_time: noTimeFlag 
                });

                addedCount++;
            }

            if (addedCount > 0) {
                // 1. อัปเดตตารางหน้าจอ
                updateDatabaseTimetableAndCredits();
                
                // 2. 🚀 ออโต้เซฟลง Database อ้างอิงตามปีและเทอมที่ดึงมาจากหน้าจอเป๊ะๆ
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึกลงระบบ...';
                const studentId = localStorage.getItem('sut_student_id');
                if (studentId) {
                    const safeData = JSON.parse(JSON.stringify(selectedCoursesData));
                    // ลบของเก่าในเทอมนี้ แล้วบันทึกของใหม่ทับ
                    await supabaseClient.from('user_schedules').delete().match({ student_id: studentId, year_level: targetYear, semester: targetSem });
                    await supabaseClient.from('user_schedules').insert([{ student_id: studentId, year_level: targetYear, semester: targetSem, course_ids: safeData }]);
                    
                    // อัปเดต Cache ของเว็บด้วย ข้ามหน้าไปมาก็ไม่หาย
                    const currentKey = `${targetYear}_${targetSem}`;
                    scheduleCache[currentKey] = { 
                        ids: JSON.parse(JSON.stringify(selectedCourseIds)), 
                        data: JSON.parse(JSON.stringify(selectedCoursesData)) 
                    };
                }

                if (overlapCount > 0) {
                    let htmlMsg = `<div style="margin-bottom: 10px; color: #15803d;"><i class="fa-solid fa-circle-check"></i> ดึงแผน ปี ${targetYear} เทอม ${targetSem} สำเร็จ ${addedCount} วิชา</div>`;
                    htmlMsg += `<div style="color: #b91c1c; font-weight: 600; margin-bottom: 5px;"><i class="fa-solid fa-xmark"></i> แต่มี ${overlapCount} วิชาที่เวลาชน:</div>`;
                    htmlMsg += `<div style="font-size: 13px;">${overlapDetails.join('<br>')}</div>`;
                    showWarningModal('ดึงแผนการเรียนได้บางส่วน', htmlMsg);
                } else {
                    showSuccessModal('สำเร็จเรียบร้อย!', `ระบบดึงแผนการเรียน ปี ${targetYear} เทอม ${targetSem} ของสาขา ${selectedMajor} บันทึกลงตารางให้คุณแล้วครับ`);
                }
            } else if (overlapCount > 0) {
                let htmlMsg = `<div style="color: #b91c1c; font-weight: 600; margin-bottom: 5px;"><i class="fa-solid fa-xmark"></i> ไม่สามารถจัดวิชาตามแผนได้ เนื่องจากเวลาชนกับวิชาที่คุณมีอยู่:</div>`;
                htmlMsg += `<div style="font-size: 13px;">${overlapDetails.join('<br>')}</div>`;
                showWarningModal('เวลาเรียนชนกัน', htmlMsg);
            } else {
                Swal.fire({ icon: 'info', title: 'วิชาครบแล้ว', text: `วิชาตามแผน ปี ${targetYear} เทอม ${targetSem} อยู่ในตารางครบถ้วนแล้วครับ` });
            }

        } else {
            Swal.fire({ icon: 'info', title: 'ไม่พบแผนการเรียน', text: `ยังไม่มีข้อมูลแผนการเรียนของสาขา "${selectedMajor}" ปี ${targetYear} เทอม ${targetSem} ในระบบครับ` });
        }
    } catch (err) {
        console.error(err);
        Swal.fire({ icon: 'error', title: 'ข้อผิดพลาด', text: 'ไม่สามารถดึงข้อมูลแผนการเรียนจากฐานข้อมูลได้' });
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

