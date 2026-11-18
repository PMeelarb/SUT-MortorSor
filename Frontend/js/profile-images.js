let bgCropper = null;
window.changeProfileBackground = function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const modal = document.getElementById('crop-bg-modal');
            const imageTarget = document.getElementById('crop-image-target');
            imageTarget.src = e.target.result;
            modal.style.display = 'flex';
            if (bgCropper) bgCropper.destroy();
            bgCropper = new Cropper(imageTarget, { viewMode: 1, autoCropArea: 1, zoomable: true, scalable: true, background: false });
        };
        reader.readAsDataURL(file);
    }
    event.target.value = '';
};
window.applyBgCrop = function() {
    if (!bgCropper) return;
    const canvas = bgCropper.getCroppedCanvas({ width: 1920, imageSmoothingEnabled: true, imageSmoothingQuality: 'high' });
    const croppedImageURL = canvas.toDataURL('image/jpeg', 0.8); // ลดขนาดไฟล์เล็กน้อยเพื่อประหยัดพื้นที่ความจำ
    const bgContainer = document.getElementById('profile-bg-container');
    
    if (bgContainer) { 
        bgContainer.style.backgroundImage = `url(${croppedImageURL})`; 
        bgContainer.style.backgroundSize = 'cover'; 
        bgContainer.style.backgroundPosition = 'center'; 
    }

    // 🔥 สั่งบันทึกรูปลงความจำของเบราว์เซอร์
    const studentId = localStorage.getItem('sut_student_id');
    if (studentId) {
        try {
            localStorage.setItem(`sut_bg_${studentId}`, croppedImageURL);
        } catch (e) {
            console.warn('ไม่สามารถบันทึกรูปลง LocalStorage ได้ (ไฟล์อาจใหญ่เกินไป)');
        }
    }

    closeModal('crop-bg-modal');
};
window.changeProfileAvatar = function(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const avatarImg = document.getElementById('profile-avatar-img');
            const defaultIcon = document.getElementById('default-avatar-icon');
            
            if (avatarImg) { 
                avatarImg.src = e.target.result; 
                avatarImg.style.display = 'block'; 
            }
            if (defaultIcon) { 
                defaultIcon.style.display = 'none'; 
            }

            // 🔥 สั่งบันทึกรูปโปรไฟล์ลงความจำเบราว์เซอร์
            const studentId = localStorage.getItem('sut_student_id');
            if (studentId) {
                try {
                    localStorage.setItem(`sut_avatar_${studentId}`, e.target.result);
                } catch (err) {
                    console.warn('ไม่สามารถบันทึกรูปลง LocalStorage ได้ (ไฟล์อาจใหญ่เกินไป)');
                }
            }
        };
        reader.readAsDataURL(file);
    }
};

