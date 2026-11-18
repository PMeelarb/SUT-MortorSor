require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const OpenAI = require('openai'); // ไลบรารี OpenAI สำหรับต่อ Groq
const database = require('./src/config/oracle'); 
const apiRoutes = require('./src/routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); 
app.use(express.json()); 

const openai = new OpenAI({
    apiKey: process.env.GROQ_API_KEY, 
    baseURL: "https://api.groq.com/openai/v1",
});

async function startup() {
    console.log(`\n=========================================`);
    console.log(`กำลังบูตระบบ SUT MortorSor Backend...`);
    await database.initialize();
    const server = app.listen(PORT, () => {
        console.log(`🚀 เซิร์ฟเวอร์รันสำเร็จที่ http://localhost:${PORT}`);
        console.log(`⏳ กำลังสแตนด์บายรอรับคำสั่งจากหน้าเว็บ...`);
        console.log(`=========================================\n`);
    });
    server.on('error', (error) => {
        console.error(`\n❌ เซิร์ฟเวอร์พัง! สาเหตุ: ${error.message}\n`);
    });
}

function formatTime(timeslot) {
    if (!timeslot || isNaN(timeslot)) return '-';
    const mins = (Number(timeslot) - 1) * 5;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getDayName(weekday) {
    switch(String(weekday)) {
        case '1': return 'อาทิตย์'; case '2': return 'จันทร์'; case '3': return 'อังคาร';
        case '4': return 'พุธ'; case '5': return 'พฤหัสบดี'; case '6': return 'ศุกร์';
        case '7': return 'เสาร์'; default: return 'ไม่ระบุวัน';
    }
}
// ==============================================================
// 🚀 1. API จัดตารางเร่งด่วน 
// ==============================================================
app.get('/api/recommend', async (req, res) => {
    const { major, year, semester } = req.query;
    let rawMajor = major || '';
    
    // ตรวจจับว่าเป็นเด็กสาขาเทคโนโลยีดิจิทัลแบบเป๊ะๆ
    let isDGT = rawMajor.includes('เทคโนโลยีดิจิทัล') || rawMajor.includes('DGT');
    
    let connection;
    try {
        connection = await database.oracledb.getConnection();
        let programId = null;
        
        if (isDGT) {
            const sqlProgram = `
                SELECT PROGRAMID FROM EXP_PROGRAM 
                WHERE PROGRAMNAME LIKE '%เทคโนโลยีดิจิทัล%' 
                  AND PROGRAMNAME NOT LIKE '%นิเทศ%'
                ORDER BY PROGRAMYEAR DESC FETCH FIRST 1 ROWS ONLY
            `;
            const pRes = await connection.execute(sqlProgram, {}, { outFormat: database.oracledb.OUT_FORMAT_OBJECT });
            if(pRes.rows.length > 0) programId = pRes.rows[0].PROGRAMID;
        } else {
            let keyword = rawMajor.replace(/หลักสูตรวิทยาศาสตรบัณฑิต|หลักสูตรวิศวกรรมศาสตรบัณฑิต|หลักสูตรสาขาวิชา|สาขาวิชา|วิชา/g, '').trim().split('(')[0].trim();
            const sqlProgramNormal = `SELECT PROGRAMID FROM EXP_PROGRAM WHERE PROGRAMNAME LIKE '%' || :keyword || '%' ORDER BY PROGRAMYEAR DESC FETCH FIRST 1 ROWS ONLY`;
            const pRes = await connection.execute(sqlProgramNormal, { keyword }, { outFormat: database.oracledb.OUT_FORMAT_OBJECT });
            if(pRes.rows.length > 0) programId = pRes.rows[0].PROGRAMID;
        }

        let result = { rows: [] };
        
        if (programId) {
            const sqlPlan = `
                WITH PlanCourses AS (
                    SELECT DISTINCT COURSEID FROM EXP_STUDYPLAN 
                    WHERE TO_CHAR(PROGRAMID) = TO_CHAR(:programId)
                      AND TO_CHAR(STUDENTYEAR) = TO_CHAR(:year) 
                      AND TO_CHAR(SEMESTER) = TO_CHAR(:semester)
                ),
                RankedClasses AS (
                    SELECT c.COURSECODE, c.COURSENAME, c.COURSEUNIT, cl.SECTION, t.WEEKDAY, t.TIMESLOTFROM, t.TIMESLOTTO,
                           ROW_NUMBER() OVER (PARTITION BY c.COURSECODE ORDER BY cl.SECTION) as rn
                FROM EXP_COURSE c
                JOIN PlanCourses pc ON TO_CHAR(c.COURSEID) = TO_CHAR(pc.COURSEID)
                LEFT JOIN EXP_CLASS cl ON TO_CHAR(c.COURSEID) = TO_CHAR(cl.COURSEID)
                LEFT JOIN EXP_CLASSTIMETABLE t ON TO_CHAR(cl.CLASSID) = TO_CHAR(t.CLASSID)
                )
                SELECT COURSECODE, COURSENAME, COURSEUNIT, NVL(SECTION, '1') AS SECTION, WEEKDAY, TIMESLOTFROM, TIMESLOTTO
                FROM RankedClasses WHERE rn = 1
            `;
            result = await connection.execute(sqlPlan, { 
                programId, year: Number(year) || 1, semester: Number(semester) || 1 
            }, { outFormat: database.oracledb.OUT_FORMAT_OBJECT });
        }

        // ตัวกรองป้องกันวิชาวิทยาศาสตร์ (SCI) และวิชาพื้นฐานของคณะอื่นหลุดรอดเข้ามา
        let hasWrongCourse = result.rows.some(r => r.COURSECODE && (
            r.COURSECODE.toUpperCase().startsWith('SCI') || 
            r.COURSECODE.toUpperCase().startsWith('102') || 
            r.COURSECODE.toUpperCase().startsWith('103') || 
            r.COURSECODE.toUpperCase().startsWith('105') || 
            r.COURSECODE.toUpperCase().startsWith('106')
        ));

        // บังคับใช้แผน DGT ตามหลักสูตรเมื่อข้อมูลแหว่งหรือมีวิชาผิดปกติ
        if ((result.rows.length === 0 || hasWrongCourse) && isDGT) {
            let fallbackSql = "";
            let yr = Number(year);
            let sem = Number(semester);

            if (yr === 1 && sem === 1) {
                fallbackSql = `WHERE UPPER(REPLACE(c.COURSECODE, ' ', '')) IN ('IST201001', 'IST201002', 'IST201003', 'IST301101', '1101010')`;
            } else if (yr === 1 && sem === 2) {
                fallbackSql = `WHERE UPPER(REPLACE(c.COURSECODE, ' ', '')) IN ('IST301102', '1101020', '1101030')`;
            } else if (yr === 1 && sem === 3) {
                fallbackSql = `WHERE UPPER(REPLACE(c.COURSECODE, ' ', '')) IN ('IST201004', 'IST202001', 'IST301103')`;
            } else if (yr === 2 && sem === 1) {
                fallbackSql = `WHERE UPPER(REPLACE(c.COURSECODE, ' ', '')) IN ('IST202002', 'IST301104')`;
            } else if (yr === 2 && sem === 2) {
                fallbackSql = `WHERE UPPER(REPLACE(c.COURSECODE, ' ', '')) IN ('IST301105')`;
            } else if (yr === 2 && sem === 3) {
                fallbackSql = `WHERE UPPER(c.COURSECODE) LIKE 'IST2015%' OR UPPER(c.COURSECODE) LIKE 'IST2025%'`;
            } else if (yr === 3 && sem === 1) {
                fallbackSql = `WHERE UPPER(REPLACE(c.COURSECODE, ' ', '')) IN ('1101041', '1101911', '1101913')`;
            } else if (yr === 3 && sem === 2) {
                fallbackSql = `WHERE UPPER(REPLACE(c.COURSECODE, ' ', '')) IN ('1101042', '1101043', '1101901', '1101912')`;
            } else if (yr === 3 && sem === 3) {
                fallbackSql = `WHERE UPPER(REPLACE(c.COURSECODE, ' ', '')) IN ('1101902')`;
            } else {
                fallbackSql = `WHERE UPPER(c.COURSECODE) LIKE '1101%'`;
            }
            
            const finalFallbackSql = `
                SELECT c.COURSECODE, c.COURSENAME, c.COURSEUNIT, '1' AS SECTION, t.WEEKDAY, t.TIMESLOTFROM, t.TIMESLOTTO,
                       ROW_NUMBER() OVER (PARTITION BY c.COURSECODE ORDER BY cl.SECTION) as rn
                FROM EXP_COURSE c
                LEFT JOIN EXP_CLASS cl ON TO_CHAR(c.COURSEID) = TO_CHAR(cl.COURSEID)
                LEFT JOIN EXP_CLASSTIMETABLE t ON TO_CHAR(cl.CLASSID) = TO_CHAR(t.CLASSID)
                ${fallbackSql}
            `;
            
            const queryWrapper = `SELECT * FROM (${finalFallbackSql}) WHERE rn = 1 FETCH FIRST 8 ROWS ONLY`;
            result = await connection.execute(queryWrapper, {}, { outFormat: database.oracledb.OUT_FORMAT_OBJECT });
        }

        if (result.rows.length === 0 && !isDGT) {
             return res.json({ status: 'success', data: [] });
        }

        const data = result.rows.map(r => ({
            COURSECODE: r.COURSECODE, COURSENAME: r.COURSENAME, COURSEUNIT: r.COURSEUNIT, SECTION: r.SECTION,
            DAY_NAME: r.WEEKDAY ? getDayName(r.WEEKDAY) : 'ไม่ระบุวัน', 
            START_TIME: r.TIMESLOTFROM ? formatTime(r.TIMESLOTFROM) : '-', 
            END_TIME: r.TIMESLOTTO ? formatTime(r.TIMESLOTTO) : '-'
        }));

        const uniqueData = data.filter((v, i, a) => a.findIndex(t => (t.COURSECODE === v.COURSECODE)) === i);
        res.json({ status: 'success', data: uniqueData });

    } catch (err) {
        console.error('Recommend Error:', err);
        res.status(500).json({ status: 'error', message: err.message });
    } finally {
        if (connection) { try { await connection.close(); } catch (err) {} }
    }
});

// ==============================================================
// 🚀 2. API ช่องค้นหาวิชา 
// ==============================================================
app.get('/api/courses', async (req, res) => {
    let connection;
    try {
        connection = await database.oracledb.getConnection();
        let result;
        try {
            // โค้ดดึงข้อมูลวิชา
            const sql = `
                WITH RankedClasses AS (
                    SELECT c.COURSECODE, c.COURSENAME, c.COURSEUNIT, cl.SECTION, t.WEEKDAY, t.TIMESLOTFROM, t.TIMESLOTTO,
                           ROW_NUMBER() OVER (PARTITION BY c.COURSECODE ORDER BY cl.SECTION) as rn
                    FROM EXP_COURSE c
                    LEFT JOIN EXP_CLASS cl ON TO_CHAR(c.COURSEID) = TO_CHAR(cl.COURSEID) AND TO_CHAR(cl.ACADYEAR) = '2569'
                    LEFT JOIN EXP_CLASSTIMETABLE t ON TO_CHAR(cl.CLASSID) = TO_CHAR(t.CLASSID)
                )
                SELECT COURSECODE, COURSENAME, COURSEUNIT, NVL(SECTION, '1') AS SECTION, WEEKDAY, TIMESLOTFROM, TIMESLOTTO
                FROM RankedClasses WHERE rn = 1
            `;
            result = await connection.execute(sql, {}, { outFormat: database.oracledb.OUT_FORMAT_OBJECT });
        } catch (dbErr) {
            console.log("⚠️ เจอบั๊กช่องค้นหาวิชา สลับไปดึงเฉพาะรายวิชาแบบปลอดภัย!");
            const fallbackSql = `SELECT COURSECODE, COURSENAME, COURSEUNIT, '1' AS SECTION, NULL AS WEEKDAY, NULL AS TIMESLOTFROM, NULL AS TIMESLOTTO FROM EXP_COURSE`;
            result = await connection.execute(fallbackSql, {}, { outFormat: database.oracledb.OUT_FORMAT_OBJECT });
        }
        
        const data = result.rows.map(r => ({
            COURSECODE: r.COURSECODE, 
            COURSENAME: r.COURSENAME, 
            COURSEUNIT: r.COURSEUNIT || '-', 
            SECTION: r.SECTION,
            DAY_NAME: r.WEEKDAY ? getDayName(r.WEEKDAY) : 'ไม่ระบุวัน', 
            START_TIME: r.TIMESLOTFROM ? formatTime(r.TIMESLOTFROM) : '-', 
            END_TIME: r.TIMESLOTTO ? formatTime(r.TIMESLOTTO) : '-'
        }));

        res.json({ status: 'success', data });
    } catch (err) {
        console.error('Courses Error:', err);
        res.status(500).json({ status: 'error', message: err.message });
    } finally {
        if (connection) { try { await connection.close(); } catch (err) {} }
    }
});

// ==============================================================
// 🚀 3. API แชท AI (AI รู้จักคุณปัน 100%)
// ==============================================================
app.post('/api/aichat', async (req, res) => {
    try {
        const { message, major, year, semester, history } = req.body;
        
        let cleanMajor = major || 'ไม่ระบุ';
        cleanMajor = cleanMajor.replace(/หลักสูตรสาขาวิชา|สาขาวิชา/g, '').trim();
        let searchKeyword = cleanMajor.split('(')[0].replace(/[0-9]/g, '').trim();

        const connection = await database.oracledb.getConnection();
        
        const sqlFullPlan = `
            WITH TargetProgram AS (
                SELECT PROGRAMID FROM EXP_PROGRAM 
                WHERE PROGRAMNAME LIKE :cleanMajor || '-%' 
                  AND (INSTR(:cleanMajor, '(') > 0 OR INSTR(PROGRAMNAME, '(') = 0)
                ORDER BY PROGRAMYEAR DESC FETCH FIRST 1 ROWS ONLY
            )
            SELECT sp.STUDENTYEAR, sp.SEMESTER, c.COURSECODE, c.COURSENAME 
            FROM EXP_STUDYPLAN sp
            JOIN TargetProgram tp ON sp.PROGRAMID = tp.PROGRAMID
            JOIN EXP_COURSE c ON sp.COURSEID = c.COURSEID
            ORDER BY sp.STUDENTYEAR ASC, sp.SEMESTER ASC, c.COURSECODE ASC
        `;

        const sqlMajor = `
            WITH RankedClasses AS (
                SELECT c.COURSECODE, c.COURSENAME, cl.SECTION, t.WEEKDAY, t.TIMESLOTFROM, t.TIMESLOTTO,
                       ROW_NUMBER() OVER (PARTITION BY c.COURSECODE ORDER BY cl.SECTION) as rn
                FROM EXP_COURSE c
                LEFT JOIN EXP_CLASS cl ON c.COURSEID = cl.COURSEID AND cl.ACADYEAR = 2569 AND cl.SEMESTER = :semester
                LEFT JOIN EXP_CLASSTIMETABLE t ON cl.CLASSID = t.CLASSID
                WHERE (c.COURSENAME LIKE '%' || :searchKeyword || '%' 
                       OR UPPER(c.COURSECODE) LIKE 'DGT%' 
                       OR UPPER(c.COURSECODE) LIKE '106%' 
                       OR UPPER(c.COURSECODE) LIKE '110%')
            )
            SELECT COURSECODE, COURSENAME, NVL(SECTION, '1') AS SECTION, 
                CASE WEEKDAY WHEN 1 THEN 'อาทิตย์' WHEN 2 THEN 'จันทร์' WHEN 3 THEN 'อังคาร' WHEN 4 THEN 'พุธ' WHEN 5 THEN 'พฤหัสบดี' WHEN 6 THEN 'ศุกร์' WHEN 7 THEN 'เสาร์' ELSE 'รอประกาศ' END AS DAY_NAME,
                NVL(TO_CHAR(TRUNC(SYSDATE) + ((TIMESLOTFROM - 1) * 5) / 1440, 'HH24:MI'), 'TBD') AS START_TIME,
                NVL(TO_CHAR(TRUNC(SYSDATE) + ((TIMESLOTTO - 1) * 5) / 1440, 'HH24:MI'), 'TBD') AS END_TIME
            FROM RankedClasses WHERE rn <= 2 FETCH FIRST 20 ROWS ONLY
        `;

        const sqlGenEd = `
            WITH RankedClasses AS (
                SELECT c.COURSECODE, c.COURSENAME, cl.SECTION, t.WEEKDAY, t.TIMESLOTFROM, t.TIMESLOTTO,
                       ROW_NUMBER() OVER (PARTITION BY c.COURSECODE ORDER BY cl.SECTION) as rn
                FROM EXP_COURSE c
                LEFT JOIN EXP_CLASS cl ON c.COURSEID = cl.COURSEID AND cl.ACADYEAR = 2569 AND cl.SEMESTER = :semester
                LEFT JOIN EXP_CLASSTIMETABLE t ON cl.CLASSID = t.CLASSID
                WHERE (UPPER(c.COURSECODE) LIKE 'IST%' OR UPPER(c.COURSECODE) LIKE 'LNG%' 
                       OR UPPER(c.COURSECODE) LIKE 'HSS%' OR UPPER(c.COURSECODE) LIKE 'SUT%')
            )
            SELECT COURSECODE, COURSENAME, NVL(SECTION, '1') AS SECTION, 
                CASE WEEKDAY WHEN 1 THEN 'อาทิตย์' WHEN 2 THEN 'จันทร์' WHEN 3 THEN 'อังคาร' WHEN 4 THEN 'พุธ' WHEN 5 THEN 'พฤหัสบดี' WHEN 6 THEN 'ศุกร์' WHEN 7 THEN 'เสาร์' ELSE 'รอประกาศ' END AS DAY_NAME,
                NVL(TO_CHAR(TRUNC(SYSDATE) + ((TIMESLOTFROM - 1) * 5) / 1440, 'HH24:MI'), 'TBD') AS START_TIME,
                NVL(TO_CHAR(TRUNC(SYSDATE) + ((TIMESLOTTO - 1) * 5) / 1440, 'HH24:MI'), 'TBD') AS END_TIME
            FROM RankedClasses WHERE rn <= 2 FETCH FIRST 25 ROWS ONLY
        `;

        let fullPlanResult = { rows: [] };
        let majorResult = { rows: [] };
        let genedResult = { rows: [] };

        try { fullPlanResult = await connection.execute(sqlFullPlan, { cleanMajor }); } catch(e) {}
        try { majorResult = await connection.execute(sqlMajor, { searchKeyword, semester: parseInt(semester)||1 }); } catch(e) {}
        try { genedResult = await connection.execute(sqlGenEd, { semester: parseInt(semester)||1 }); } catch(e) {}
        
        await connection.close();

        let fullPlanString = "--- 🗺️ แผนการเรียนตลอดหลักสูตร ---\n";
        if(fullPlanResult.rows.length === 0) fullPlanString += "(ไม่มีข้อมูล)\n";
        let currentPlanYear = 0;
        fullPlanResult.rows.forEach(r => {
            if(currentPlanYear !== r.STUDENTYEAR) {
                fullPlanString += `\n> ปี ${r.STUDENTYEAR} <\n`;
                currentPlanYear = r.STUDENTYEAR;
            }
            fullPlanString += `- เทอม ${r.SEMESTER}: ${r.COURSECODE} ${r.COURSENAME}\n`;
        });

        let dataString = "--- 📅 วิชาสาขาที่เปิดสอน ---\nรูปแบบ: รหัสวิชา | ชื่อวิชา | กลุ่ม | วัน | เริ่ม | จบ\n";
        if(majorResult.rows.length === 0) dataString += "(ไม่มีวิชาสาขาเปิดสอน)\n";
        majorResult.rows.forEach(r => {
            dataString += `${r.COURSECODE} | ${r.COURSENAME} | ${r.SECTION} | ${r.DAY_NAME} | ${r.START_TIME} | ${r.END_TIME}\n`;
        });

        dataString += "\n--- 📚 วิชาศึกษาทั่วไป (GenEd) แนะนำ ---\n";
        if(genedResult.rows.length === 0) dataString += "(ไม่มีวิชาศึกษาทั่วไปเปิดสอน)\n";
        genedResult.rows.forEach(r => {
            dataString += `${r.COURSECODE} | ${r.COURSENAME} | ${r.SECTION} | ${r.DAY_NAME} | ${r.START_TIME} | ${r.END_TIME}\n`;
        });

        // 🔥 ฝังข้อมูลโปรไฟล์ผู้ใช้งานให้ AI รู้จัก
        const systemInstruction = `
คุณคือ "SUT AI Advisor" เป็นที่ปรึกษาด้านการวางแผนการเรียนแบบมืออาชีพสำหรับนักศึกษามหาวิทยาลัยเทคโนโลยีสุรนารี (มทส.)
ผู้ใช้งานคือ ปัณณทัต มีลาภ (Pun) อายุ 20 ปี กำลังศึกษาอยู่ที่ สำนักวิชาศาสตร์และศิลป์ดิจิทัล สาขาวิชาวิทยาการสารสนเทศบัณฑิต (เทคโนโลยีดิจิทัล)

บุคลิกภาพ: แทนตัวเองว่า "ผม" และเรียกผู้ใช้งานว่า "คุณ" เสมอ สุภาพ เป็นมืออาชีพ

กฎเหล็กขั้นเด็ดขาด (CRITICAL RULES):
1. ห้ามสร้างหรือวาดตารางด้วย Markdown เด็ดขาด ให้อธิบายเป็นข้อความ Bullet point สั้นๆ พอ
2. ทันทีที่ผู้ใช้พิมพ์คำว่า "จัดให้หน่อย", "เอาลงตาราง" คุณต้องสรุปคำตอบสั้นๆ และ **บังคับให้แทรกแท็ก [COURSES: รหัสวิชา|กลุ่ม, รหัสวิชา|กลุ่ม] ไว้ที่บรรทัดล่างสุดของคำตอบเสมอ**
3. หากผู้ใช้สอบถามวิชาศึกษาทั่วไป (GenEd) หรือวิชาสาขา ให้หยิบรายชื่อวิชาในหมวดที่ส่งไปให้มาแนะนำได้เลย ห้ามตอบว่า "ข้อมูลเป็นค่าว่าง" เด็ดขาด เพราะมีข้อมูลส่งไปให้แล้ว

ข้อมูลวิชาที่ต้องเรียนตามหลักสูตร (${cleanMajor}):
${fullPlanString}

ข้อมูลรายวิชาที่เปิดสอนเทอมนี้ (หยิบไปแนะนำได้เลย):
${dataString}
`;
        const aiMessages = [{ role: "system", content: systemInstruction }];
        if (history && Array.isArray(history)) aiMessages.push(...history.slice(-6));
        aiMessages.push({ role: "user", content: message });

        const response = await openai.chat.completions.create({
            model: "qwen/qwen3.8-27b",
            temperature: 0.1, 
            max_tokens: 800, 
            messages: aiMessages
        });

        res.status(200).json({ status: "success", reply: response.choices[0].message.content });
    } catch (error) {
        console.error("❌ AI Chat Request Failed:", error);
        res.status(500).json({ error: "เซิร์ฟเวอร์ไม่สามารถติดต่อระบบ AI ได้" });
    }
});

// 🔥 สำคัญมาก: ย้าย apiRoutes มาไว้บรรทัดล่างสุด! 
// เพื่อให้ API ที่เราเขียนใหม่ทำงานได้ 100% โดยไม่โดน Route เก่าแย่งซีน
app.use('/api', apiRoutes);

startup();