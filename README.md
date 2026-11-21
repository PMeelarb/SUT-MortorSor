# SUT MortorSor Plan

เว็บวางแผนการเรียนและจัดตารางเรียนของมหาวิทยาลัยเทคโนโลยีสุรนารี

## เปิดใช้งานบนเครื่อง

1. รัน `npm ci` จากโฟลเดอร์หลักของโปรเจกต์
2. คัดลอก `Backend/.env.example` เป็น `Backend/.env` แล้วใส่ค่าการเชื่อมต่อ Oracle, Supabase และ Groq ของเครื่องที่ใช้งาน
3. คัดลอก `Frontend/supabase.local.example.js` เป็น `Frontend/supabase.local.js` แล้วกรอก Project URL และ Publishable Key ของโปรเจกต์ Supabase เดียวกับ Backend
4. รัน `node Backend/server.js` จากโฟลเดอร์หลักแล้วเปิด `Frontend/auth.html` ด้วย Live Server

ใช้ไฟล์ที่ลงท้ายด้วย `.example` เป็นตัวอย่างใน Git ไฟล์ตั้งค่าจริงอยู่ในเครื่อง สำหรับ Frontend ให้ใช้ Publishable Key เท่านั้น

รันชุดทดสอบด้วย `node --test Backend/test/*.test.js`
