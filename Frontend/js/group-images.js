// ==========================================
// 🖼️ ระบบแสดงรูปโปรไฟล์กลุ่ม (จับจากตำแหน่งที่คลิกล่าสุด 100%)
// ==========================================
window.selectedGroupImageBase64 = null;
window.lastClickedAvatarBox = null;

// 1. จำตำแหน่งวงกลมที่คุณปันคลิกล่าสุด
document.addEventListener('click', function(e) {
    // เช็คว่าคลิกโดนพื้นที่เลือกรูปหรือไม่
    const target = e.target;
    const modal = target.closest('div[style*="border-radius"], .modal, .modal-content, form');
    
    if (modal && modal.innerText && modal.innerText.includes('สร้างกลุ่ม')) {
        // ไล่หากล่องวงกลมจากจุดที่คลิก หรือหาจากข้อความ "คลิกเพื่อเพิ่มรูป"
        let circle = target.closest('label, div, span');
        
        // ถ้าคลิกโดนไอคอนข้างใน ให้ถอยออกมาหากล่องวงกลมที่มีขนาดประมาณ 50-140px
        let curr = target;
        while (curr && curr !== modal) {
            const w = curr.offsetWidth;
            const h = curr.offsetHeight;
            if (w >= 45 && w <= 150 && Math.abs(w - h) <= 20) {
                window.lastClickedAvatarBox = curr;
                break;
            }
            curr = curr.parentElement;
        }
    }
}, true);

// 2. เมื่อเลือกไฟล์รูปเสร็จ ให้นำรูปมาใส่ในวงกลมทันที
document.addEventListener('change', function(e) {
    if (e.target && e.target.type === 'file' && e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        if (!file.type.startsWith('image/')) return;

        const reader = new FileReader();
        reader.onload = function(event) {
            const base64Url = event.target.result;
            window.selectedGroupImageBase64 = base64Url;

            let targetCircle = window.lastClickedAvatarBox;

            // แผนสำรอง: ค้นหาจากข้อความ "คลิกเพื่อเพิ่มรูป (ไม่บังคับ)" ในหน้าจอ
            if (!targetCircle) {
                const allEls = document.querySelectorAll('div, span, p, label');
                for (let el of allEls) {
                    if (el.innerText && el.innerText.trim() === 'คลิกเพื่อเพิ่มรูป (ไม่บังคับ)') {
                        // วงกลมมักจะเป็น Element ก่อนหน้าข้อความนี้ หรืออยู่ในกล่องแม่เดียวกัน
                        const prev = el.previousElementSibling;
                        if (prev) {
                            targetCircle = prev.offsetWidth >= 45 && prev.offsetWidth <= 150 ? prev : prev.querySelector('div, label, span');
                        }
                        if (!targetCircle && el.parentElement) {
                            const candidates = el.parentElement.querySelectorAll('div, label, span');
                            for (let c of candidates) {
                                if (c.offsetWidth >= 45 && c.offsetWidth <= 150 && Math.abs(c.offsetWidth - c.offsetHeight) <= 20) {
                                    targetCircle = c;
                                    break;
                                }
                            }
                        }
                        break;
                    }
                }
            }

            // แสดงผลรูปในวงกลม
            if (targetCircle) {
                // เช็คว่าข้างในมีแท็ก <img> ซ่อนอยู่ไหม ถ้าไม่มีให้สร้างใส่เข้าไปเลย
                let img = targetCircle.querySelector('img.custom-group-preview');
                if (!img) {
                    img = document.createElement('img');
                    img.className = 'custom-group-preview';
                    img.style.cssText = 'width: 100%; height: 100%; object-fit: cover; border-radius: 50%; position: absolute; top: 0; left: 0; z-index: 1;';
                    
                    // ตั้งค่ากล่องวงกลมให้รองรับรูปซ้อนทับพอดี
                    if (window.getComputedStyle(targetCircle).position === 'static') {
                        targetCircle.style.position = 'relative';
                    }
                    targetCircle.insertBefore(img, targetCircle.firstChild);
                }
                img.src = base64Url;
                img.style.display = 'block';

                // ซ่อนไอคอนรูปภูเขาเดิม (แต่เก็บปุ่ม + สีส้มไว้ให้อยู่ด้านบน)
                const children = targetCircle.querySelectorAll('i, svg');
                children.forEach(ch => {
                    if (!ch.classList.contains('fa-plus') && !ch.closest('[style*="orange"], [style*="#F05A28"], [style*="#ff"]')) {
                        ch.style.opacity = '0';
                    } else if (ch.parentElement && ch.parentElement !== targetCircle) {
                        ch.parentElement.style.zIndex = '2';
                    }
                });
            }
        };
        reader.readAsDataURL(file);
    }
});