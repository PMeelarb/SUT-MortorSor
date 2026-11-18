// ---------------------------------------------------------
// ส่วนของระบบรีวิว
// ---------------------------------------------------------
function initReviewSystem() {
    const reviewGrid = document.getElementById('review-grid');
    const searchInput = document.getElementById('review-search');
    const mainPage = document.getElementById('review-main-page');
    const detailPage = document.getElementById('review-detail-page');
    const backBtn = document.getElementById('back-to-reviews');
    const courseTitle = document.getElementById('review-course-title');
    const commentsGrid = document.getElementById('review-comments-grid');

    let courseRatings = {};
    let typingTimer;
    let currentReviewCode = '';
    let currentReviewName = '';
    let selectedRating = 0;

    async function fetchAllRatings() {
        const { data, error } = await supabaseClient.from('course_reviews').select('course_code, rating');
        if (!error && data) {
            const grouped = data.reduce((acc, curr) => {
                if (!acc[curr.course_code]) acc[curr.course_code] = { sum: 0, count: 0 };
                acc[curr.course_code].sum += curr.rating;
                acc[curr.course_code].count += 1;
                return acc;
            }, {});
            for (const code in grouped) courseRatings[code] = Math.round(grouped[code].sum / grouped[code].count);
        }
        fetchCoursesFromAPI('');
    }

    const generateStars = (score) => {
        let starsHTML = '';
        for(let i=1; i<=5; i++) starsHTML += i <= score ? '<i class="fa-solid fa-star" style="color: #f59e0b;"></i> ' : '<i class="fa-regular fa-star" style="color: #d1d5db;"></i> ';
        return `<div class="stars" style="margin-bottom: 0;">${starsHTML}</div>`;
    };

  async function fetchCoursesFromAPI(keyword = '') {
        if (!reviewGrid) return;
        try {
            const response = await fetch('http://localhost:3000/api/courses');
            const result = await response.json();
            reviewGrid.innerHTML = '';

            if (result.status === 'success' && result.data.length > 0) {
                const cleanKeyword = keyword.replace(/\s+/g, '').toLowerCase();
                const matchedData = result.data.filter(c => {
                    
                    if (!c.COURSENAME || String(c.COURSENAME).trim().toLowerCase() === 'null') return false;

                    const cleanCode = (c.COURSECODE || '').replace(/\s+/g, '').toLowerCase();
                    const cleanName = (c.COURSENAME || '').toLowerCase();
                    return cleanCode.includes(cleanKeyword) || cleanName.includes(cleanKeyword);
                });

                const uniqueCourses = [];
                const seen = new Set();
                matchedData.forEach(c => {
                    if(!seen.has(c.COURSECODE) && uniqueCourses.length < 30) {
                        seen.add(c.COURSECODE);
                        uniqueCourses.push(c);
                    }
                });

                if(uniqueCourses.length === 0) {
                    reviewGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #9ca3af; padding: 40px;">ไม่พบรายวิชาที่ค้นหา</div>`;
                    return;
                }

                uniqueCourses.forEach(course => {
                    const card = document.createElement('div');
                    card.className = 'review-card';
                    const avgRating = courseRatings[course.COURSECODE] || 0;
                    const noReviewText = avgRating === 0 ? '<span style="font-size:11px; color:#9ca3af; margin-left:8px;">(ยังไม่มีรีวิว)</span>' : '';

                    card.innerHTML = `
                        <div style="display: flex; align-items: center; margin-bottom: 12px;">${generateStars(avgRating)} ${noReviewText}</div>
                        <h3 style="font-size: 18px; color: #111; margin: 0 0 8px 0;">${window.formatCourseCodeDisplay(course.COURSECODE)}</h3>
                        <div style="font-size: 14px; color: #4b5563; font-weight: 500; margin-bottom: 5px;">${course.COURSENAME}</div>
                        <div style="font-size: 12px; color: #9ca3af; margin-top: 15px;">คลิกเพื่อดูรายละเอียดการรีวิว</div>
                    `;
                    card.onclick = () => openCourseDetail(course.COURSECODE, course.COURSENAME);
                    reviewGrid.appendChild(card);
                });
            } else {
                reviewGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #9ca3af; padding: 40px;">ไม่พบรายวิชาที่ค้นหา</div>`;
            }
        } catch (error) {
            reviewGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #ef4444; padding: 40px;">ไม่สามารถเชื่อมต่อฐานข้อมูลได้</div>`;
        }
    }

    async function openCourseDetail(code, name) {
        window.deleteMyReview = async function(courseCode) {
        if(!confirm('คุณต้องการลบรีวิวนี้ใช่หรือไม่?')) return;
        const myId = localStorage.getItem('sut_student_id');
        try {
            await supabaseClient.from('course_reviews').delete().eq('course_code', courseCode).eq('student_id', myId);
            openCourseDetail(currentReviewCode, currentReviewName); // โหลดหน้าต่างรีวิวใหม่
            fetchAllRatings(); // อัปเดตดาวหน้าแรก
            showSuccessModal('สำเร็จ!', 'ลบรีวิวของคุณเรียบร้อยแล้วครับ');
        } catch (err) {
            alert('เกิดข้อผิดพลาดในการลบรีวิว: ' + err.message);
        }
    };
        currentReviewCode = code; currentReviewName = name;
        mainPage.style.display = 'none'; detailPage.style.display = 'block';
        courseTitle.innerHTML = `รายวิชา<br><span style="color:#F05A28;">${window.formatCourseCodeDisplay(code)}</span> ${name}`;
        commentsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align:center; padding: 40px; color:#9ca3af;"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดรีวิว...</div>';

        const { data: reviews, error } = await supabaseClient.from('course_reviews').select('*').eq('course_code', code).order('created_at', { ascending: false });

        commentsGrid.innerHTML = '';
        if(error || !reviews || reviews.length === 0) {
            commentsGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #9ca3af; padding: 40px; background: white; border-radius: 12px; border: 1px dashed #d1d5db;">ยังไม่มีรีวิวสำหรับวิชานี้ เป็นคนแรกที่รีวิวสิ!</div>`;
            return;
        }

      reviews.forEach(rev => {
            const reviewerName = rev.student_id; 
            const dateObj = rev.created_at ? new Date(rev.created_at) : new Date();
            const dateStr = dateObj.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
            const initial = reviewerName.charAt(0).toUpperCase();

            // เช็คว่าเป็นรีวิวของเราไหม ถ้าใช่ให้แสดงปุ่มลบ
            const myStudentId = localStorage.getItem('sut_student_id');
            const deleteBtnHtml = (reviewerName === myStudentId) 
                ? `<button onclick="deleteMyReview('${code}')" style="background: none; border: none; color: #ef4444; font-size: 12px; cursor: pointer; margin-top: 8px;"><i class="fa-solid fa-trash"></i> ลบรีวิวนี้</button>` 
                : '';

            commentsGrid.innerHTML += `
                <div class="comment-card">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                        <div style="display: flex; align-items: center; gap: 15px;">
                            <div style="width: 45px; height: 45px; background: #10b981; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px; font-weight: bold;">${initial}</div>
                            <div><div style="font-weight: 600; color: #111; font-size: 15px;">${reviewerName}</div><div style="color: #9ca3af; font-size: 12px;">on ${dateStr}</div></div>
                        </div>
                    </div>
                    <div style="margin-bottom: 12px;">${generateStars(rev.rating)}</div>
                    <div style="font-size: 14px; color: #4b5563; line-height: 1.5;">${rev.review_text}</div>
                    <div style="text-align: right;">${deleteBtnHtml}</div>
                </div>
            `;
        });
    }

    const interactiveStars = document.querySelectorAll('#interactive-stars i');
    function highlightStars(val) {
        interactiveStars.forEach(s => {
            if (parseInt(s.getAttribute('data-value')) <= val) {
                s.style.color = '#f59e0b'; s.classList.remove('fa-regular'); s.classList.add('fa-solid');
            } else {
                s.style.color = '#d1d5db'; s.classList.remove('fa-solid'); s.classList.add('fa-regular');
            }
        });
    }

    if(interactiveStars) {
        interactiveStars.forEach(star => {
            star.addEventListener('mouseover', function() { highlightStars(this.getAttribute('data-value')); });
            star.addEventListener('mouseout', function() { highlightStars(selectedRating); });
            star.addEventListener('click', function() { selectedRating = parseInt(this.getAttribute('data-value')); highlightStars(selectedRating); });
        });
    }

    const btnOpenWriteReview = document.getElementById('btn-open-write-review');
    if(btnOpenWriteReview) {
        btnOpenWriteReview.addEventListener('click', () => {
            selectedRating = 0; highlightStars(0);
            document.getElementById('review-text-input').value = '';
            document.getElementById('write-review-course-title').innerText = `${window.formatCourseCodeDisplay(currentReviewCode)} ${currentReviewName}`;
            document.getElementById('modal-write-review').style.display = 'flex';
        });
    }

    const submitReviewBtn = document.getElementById('submit-review-btn');
    if(submitReviewBtn) {
        submitReviewBtn.onclick = async () => {
            if (selectedRating === 0) return alert('กรุณาให้คะแนนดาววิชานี้ก่อนครับ ⭐');
            const text = document.getElementById('review-text-input').value.trim();
            if (!text) return alert('กรุณาเขียนรายละเอียดการรีวิวครับ');

            const studentId = localStorage.getItem('sut_student_id');
            const originalText = submitReviewBtn.innerHTML;
            submitReviewBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...';
            submitReviewBtn.disabled = true;

            try {
                const { error } = await supabaseClient.from('course_reviews').insert([{ course_code: currentReviewCode, student_id: studentId, rating: selectedRating, review_text: text, created_at: new Date().toISOString() }]);
                if (error) throw error;
                document.getElementById('modal-write-review').style.display = 'none';
                showSuccessModal('บันทึกสำเร็จ!', 'ขอบคุณที่ร่วมแบ่งปันรีวิวรายวิชานะครับ');
                openCourseDetail(currentReviewCode, currentReviewName);
                if (typeof fetchAllRatings === 'function') fetchAllRatings(); 
            } catch (err) { alert('เกิดข้อผิดพลาดในการบันทึก: ' + err.message); } 
            finally { submitReviewBtn.innerHTML = originalText; submitReviewBtn.disabled = false; }
        };
    }

    if(searchInput) {
        searchInput.addEventListener('input', (e) => {
            reviewGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #9ca3af;"><i class="fa-solid fa-spinner fa-spin"></i> กำลังค้นหา...</div>';
            clearTimeout(typingTimer);
            typingTimer = setTimeout(() => { fetchCoursesFromAPI(e.target.value); }, 400); 
        });
    }

    if(backBtn) backBtn.addEventListener('click', () => { detailPage.style.display = 'none'; mainPage.style.display = 'block'; });

    fetchAllRatings();
}

