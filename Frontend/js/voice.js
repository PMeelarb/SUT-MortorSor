// ==========================================
// 🎤 ระบบสั่งงานด้วยเสียง (Voice to Text สำหรับ AI) - สไตล์ Gemini (กดเปิด-ปิดเอง)
// ==========================================
let speechRecognition;
let isRecordingVoice = false;
let initialInputValue = ''; // ตัวแปรจำข้อความเดิมในช่องแชทก่อนเปิดไมค์

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = 'th-TH'; 
    speechRecognition.interimResults = true; 
    speechRecognition.continuous = true; // 🔥 จุดสำคัญ: สั่งให้ฟังต่อเนื่อง ไม่ตัดจบเวลาเงียบเสียง
    speechRecognition.maxAlternatives = 1;

    speechRecognition.onstart = function() {
        isRecordingVoice = true;
        
        // จำข้อความเก่าในช่องพิมพ์ไว้ก่อน เผื่อมีการพิมพ์ค้างไว้
        const inputEl = document.getElementById('ai-msg-input');
        initialInputValue = inputEl ? inputEl.value : ''; 
        
        document.getElementById('voice-overlay').style.display = 'flex';
        document.getElementById('voice-interim-text').innerHTML = '<span style="color: #9ca3af;">กำลังฟัง... (พูดเสร็จแล้วกดที่วงกลมเพื่อส่งข้อความ)</span>';
    };

    speechRecognition.onresult = function(event) {
        let completeFinal = '';
        let interim = '';

        // วนลูปประมวลผลคำพูดตั้งแต่เริ่มเปิดไมค์จนถึงปัจจุบัน
        for (let i = 0; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                completeFinal += event.results[i][0].transcript;
            } else {
                interim += event.results[i][0].transcript;
            }
        }

        // แสดงข้อความสดๆ กลางหน้าจอ
        const displayTarget = document.getElementById('voice-interim-text');
        if (displayTarget) {
            displayTarget.innerHTML = completeFinal + '<span style="color: #9ca3af;">' + interim + '</span>';
        }

        // นำข้อความที่สรุปแล้วไปรวมกับข้อความเดิม ยัดลงในช่องแชท
        const inputEl = document.getElementById('ai-msg-input');
        if (inputEl) {
            inputEl.value = (initialInputValue ? initialInputValue + ' ' : '') + completeFinal;
        }
    };

    speechRecognition.onerror = function(event) {
        console.error("Speech error: ", event.error);
        if (event.error === 'not-allowed') {
            alert('⚠️ ไม่สามารถใช้งานไมโครโฟนได้ กรุณากดอนุญาต (Allow) สิทธิ์การใช้ไมโครโฟนที่แถบ URL ด้านบนครับ');
        }
        resetMicUI();
    };

    speechRecognition.onend = function() {
        resetMicUI();
        // ทันทีที่ผู้ใช้กดปุ่มวงกลมเพื่อสั่งหยุด ให้ยิงข้อความส่งไปหา AI อัตโนมัติ
        const inputEl = document.getElementById('ai-msg-input');
        if (inputEl && inputEl.value.trim() !== '') {
            window.sendAIMessage();
        }
    };
} else {
    console.warn("เบราว์เซอร์นี้ไม่รองรับ Speech Recognition API");
}

function resetMicUI() {
    isRecordingVoice = false;
    document.getElementById('voice-overlay').style.display = 'none';
}

// ผูกฟังก์ชันการทำงานเมื่อคลิกที่ปุ่มไมค์หรือวงกลมกลางจอ
window.toggleVoiceRecognition = function() {
    if (!speechRecognition) return alert('⚠️ เบราว์เซอร์ของคุณไม่รองรับระบบสั่งงานด้วยเสียง แนะนำให้ใช้ Google Chrome ครับ');
    
    if (isRecordingVoice) {
        // หากกำลังฟังอยู่แล้วกดอีกครั้ง -> สั่งหยุดฟัง และทำงานต่อที่ onend (ส่งแชท)
        speechRecognition.stop(); 
    } else {
        // หากยังไม่ได้ฟัง -> สั่งเริ่มฟัง
        speechRecognition.start(); 
    }
};

