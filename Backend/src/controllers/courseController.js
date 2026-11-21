const database = require('../config/oracle');
const { createAcademicRepository } = require('../repositories/academicRepository');
const { contextFromRequest, requireContext, sourceFromRequest } = require('../services/aiAdvisor');
const { courseKey, AdvisorError } = require('../services/academicData');
const { classLevelIds } = require('../config/academic');

const querySource = query => sourceFromRequest({
    mode: query.mode || undefined, sourceAcademicYear: query.sourceAcademicYear, sourceSemester: query.sourceSemester
});
const { sendAdvisorError } = require('./aiChatController');

// 📦 ฟังก์ชันที่ 1: ดึงรายวิชา 
exports.getAllCourses = async (req, res) => {
    let connection;
    try {
        connection = await database.oracledb.getConnection();
        const result = await connection.execute(
            `SELECT COURSECODE, COURSENAME, COURSEUNIT 
             FROM EXP_COURSE`,
            [], 
            { 
                outFormat: database.oracledb.OUT_FORMAT_OBJECT,
                maxRows: 50000 
            }
        );
        res.status(200).json({ status: "success", total: result.rows.length, data: result.rows });
    } catch (err) {
        console.error('[courses] RETRIEVAL_FAILED', /^(?:ORA|NJS|DPI)-\d+$/.test(err?.code) ? err.code : 'unknown');
        res.status(500).json({ status: 'error', error: "ไม่สามารถดึงข้อมูลจาก Oracle ได้" });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (err) { console.error(err); }
        }
    }
};

/// ⏰ ฟังก์ชันที่ 2: ดึงตารางเรียนของปีการศึกษา/ภาคเรียนที่ระบุ (ห้ามเดาปีหรือเทอม)
// Verified read-only on 2026-11-21: EXP_SYSTIMEWEEK maps WEEKDAY (1 = อาทิตย์),
// EXP_SYSTIMESLOT holds 5-minute slots 1–288, and a meeting ends at the start of
// slot TIMESLOTTO + 1. Only EXP_LEVELID values from config are returned.
exports.getTimetable = async (req, res) => {
    const acadyear = Number(req.query.acadyear);
    const semester = Number(req.query.semester);
    if (!Number.isInteger(acadyear) || acadyear < 1900 || acadyear > 3000 || ![1, 2, 3].includes(semester)) {
        return res.status(400).json({ status: 'error', error: 'ต้องระบุปีการศึกษา (acadyear) และภาคเรียน (semester 1–3)' });
    }
    let connection;
    try {
        connection = await database.oracledb.getConnection();
        const keyword = req.query.keyword;
        const levels = Object.fromEntries(classLevelIds().map((id, index) => [`level${index}`, id]));

        let sqlQuery = `
            SELECT
                crs.COURSECODE, crs.COURSENAME, crs.COURSEUNIT, c.CLASSID, c.SECTION,
                TRIM(wk.WEEKCALLLONG) AS DAY_NAME,
                TRIM(ts_from.TIMEOF) AS START_TIME,
                TRIM(ts_end.TIMEOF) AS END_TIME,
                TO_CHAR(cem.EXAMDATE, 'DD/MM/YYYY') AS MID_DATE,
                TO_CHAR(cem.EXAMTIMEFROM, 'HH24:MI') AS MID_START,
                TO_CHAR(cem.EXAMTIMETO, 'HH24:MI') AS MID_END,
                TO_CHAR(cef.EXAMDATE, 'DD/MM/YYYY') AS FIN_DATE,
                TO_CHAR(cef.EXAMTIMEFROM, 'HH24:MI') AS FIN_START,
                TO_CHAR(cef.EXAMTIMETO, 'HH24:MI') AS FIN_END
            FROM EXP_CLASS c
            JOIN EXP_COURSE crs ON c.COURSEID = crs.COURSEID
            LEFT JOIN EXP_CLASSTIMETABLE ct ON c.CLASSID = ct.CLASSID
            LEFT JOIN EXP_SYSTIMEWEEK wk ON wk.WEEKDAY = ct.WEEKDAY
            LEFT JOIN EXP_SYSTIMESLOT ts_from ON ts_from.TIMESLOT = ct.TIMESLOTFROM
            LEFT JOIN EXP_SYSTIMESLOT ts_end ON ts_end.TIMESLOT = ct.TIMESLOTTO + 1
            LEFT JOIN EXP_CLASSEXAM cem ON c.CLASSID = cem.CLASSID AND cem.EXAMCODE = 'M'
            LEFT JOIN EXP_CLASSEXAM cef ON c.CLASSID = cef.CLASSID AND cef.EXAMCODE = 'F'
            WHERE c.ACADYEAR = :acadyear AND c.SEMESTER = :semester
              AND c.LEVELID IN (${Object.keys(levels).map(name => `:${name}`).join(', ')})
        `;

        const bindParams = { acadyear, semester, ...levels };

        if (keyword) {
            sqlQuery += ` AND (LOWER(crs.COURSECODE) LIKE LOWER(:keyword) OR LOWER(crs.COURSENAME) LIKE LOWER(:keyword))`;
            bindParams.keyword = `%${keyword}%`;
        }

        const result = await connection.execute(
            sqlQuery, bindParams,
            { outFormat: database.oracledb.OUT_FORMAT_OBJECT, maxRows: 50000 }
        );

        res.status(200).json({ status: "success", total: result.rows.length, data: result.rows });

    } catch (err) {
        // Log only the driver code; messages can contain SQL or bind values.
        console.error('[timetable] RETRIEVAL_FAILED', /^(?:ORA|NJS|DPI)-\d+$/.test(err?.code) ? err.code : 'unknown');
        res.status(500).json({ status: 'error', error: 'ไม่สามารถดึงข้อมูลตารางเรียนได้' });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (err) {}
        }
    }
};

// 🪄 ฟังก์ชันที่ 3: ดึงแผนการศึกษา (Auto-Recommendation)
// Study plans use explicit curriculum and academic years.
exports.getStudyPlan = async (req, res) => {
    try {
        const context = contextFromRequest(req.query);
        requireContext(context);
        const source = querySource(req.query);
        const evidence = await createAcademicRepository(database).read(context, { source });
        const data = evidence.plan.map(course => ({
            COURSECODE: course.courseCode, COURSENAME: course.courseName, COURSEUNIT: course.credits
        }));
        res.json({ status: 'success', total: data.length, data, context, source,
            offerings: evidence.offerings, sources: evidence.sources, outcome: evidence.status,
            term: evidence.term ?? null, courseStatus: evidence.courseStatus ?? {},
            alternativeTerms: evidence.alternativeTerms ?? {},
            unresolvedPlanRows: evidence.unresolvedPlanRows ?? 0 });
    } catch (error) {
        sendAdvisorError(res, error);
    }
};

// Course search for the planned term: real sections first, then labelled
// historical sections for simulation. Read-only.
exports.getTermCatalog = async (req, res) => {
    try {
        const context = contextFromRequest(req.query);
        const missing = ['faculty', 'major', 'academicYear', 'semester'].filter(name => !context[name]);
        if (missing.length) throw new AdvisorError('CONTEXT_REQUIRED', 'ต้องมีสำนักวิชา สาขา ปีการศึกษา และภาคเรียนก่อนค้นรายวิชา', 400);
        const source = querySource(req.query);
        const catalog = await createAcademicRepository(database).readTermCatalog(context, source);
        const { status: outcome, ...data } = catalog;
        res.set('Cache-Control', 'no-store').json({ status: 'success', outcome, context, source, ...data });
    } catch (error) {
        sendAdvisorError(res, error);
    }
};

// Academic terms that have classes in Oracle, for choosing a real academic year.
exports.getOfferedTerms = async (req, res) => {
    try {
        const terms = await createAcademicRepository(database).readTerms();
        res.set('Cache-Control', 'no-store').json({ status: 'success', terms });
    } catch (error) {
        sendAdvisorError(res, error);
    }
};

exports.getAllCoursesForReview = async (req, res) => {
    let connection;
    try {
        connection = await database.oracledb.getConnection();
        
        const keyword = req.query.keyword ? req.query.keyword.trim() : ''; 

        const codeKeyword = `${keyword}%`; 
        const nameKeyword = `%${keyword}%`;

        let sqlQuery = `
            SELECT DISTINCT COURSECODE, COURSENAME 
            FROM EXP_COURSE 
            WHERE LOWER(COURSECODE) LIKE LOWER(:codeKeyword) 
               OR LOWER(COURSENAME) LIKE LOWER(:nameKeyword)
            ORDER BY COURSECODE ASC
            FETCH FIRST 50 ROWS ONLY
        `;

        const result = await connection.execute(
            sqlQuery,
            { codeKeyword: codeKeyword, nameKeyword: nameKeyword },
            { outFormat: database.oracledb.OUT_FORMAT_OBJECT }
        );

        res.status(200).json({ status: "success", data: result.rows });

    } catch (err) {
        console.error("❌ Error fetching courses for review:", err);
        res.status(500).json({ error: "ไม่สามารถดึงรายวิชาได้" });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (err) {}
        }
    }
};

exports.getAllPrograms = async (req, res) => {
    let connection;
    try {
        connection = await database.oracledb.getConnection();
        
        let sqlQuery = `
            SELECT DISTINCT f.FACULTYNAME, p.PROGRAMNAME 
            FROM EXP_PROGRAM p
            JOIN EXP_FACULTY f ON p.FACULTYID = f.FACULTYID
            WHERE p.PROGRAMNAME IS NOT NULL AND f.FACULTYNAME IS NOT NULL
        `;

        const result = await connection.execute(sqlQuery, [], { outFormat: database.oracledb.OUT_FORMAT_OBJECT });

        const groupedData = {};

        result.rows.forEach(row => {
            const faculty = row.FACULTYNAME.trim();
            const rawMajor = row.PROGRAMNAME.trim();

            let cleanMajor = rawMajor.replace(/-\s*\d{4}.*$/, '').trim();

            if (!groupedData[faculty]) {
                groupedData[faculty] = new Set();
            }
            groupedData[faculty].add(cleanMajor);
        });

        const finalData = {};
        for (const key in groupedData) {
            finalData[key] = Array.from(groupedData[key]).sort();
        }

        res.status(200).json({ status: "success", data: finalData });

    } catch (err) {
        console.error("❌ Error fetching programs:", err);
        res.status(500).json({ error: "ไม่สามารถดึงข้อมูลสาขาวิชาได้" });
    } finally {
        if (connection) {
            try { await connection.close(); } catch (err) {}
        }
    }
};

// ==========================================
// 🚨 [เพิ่มใหม่] ฟังก์ชันที่ 5: API ดึงข้อมูลรายวิชาแบบเจาะจงให้ AI 
// ใช้สำหรับแปลงรหัสวิชาที่ AI ส่งมา (เช่น [COURSES: IF1101]) ให้กลายเป็นข้อมูลตารางพร้อมเวลาเรียน
// ==========================================
// Legacy read endpoint uses the same verified retrieval as AI Chat.
exports.getCourseForAI = async (req, res) => {
    try {
        const context = contextFromRequest(req.query);
        requireContext(context);
        const evidence = await createAcademicRepository(database).read(context);
        const requestedCode = courseKey(req.params.courseCode);
        const offerings = evidence.offerings.filter(course => course.courseCode === requestedCode
            && (!req.query.section || course.section === String(req.query.section)));
        const data = offerings.flatMap(course => course.meetings.map(meeting => ({
            COURSECODE: course.courseCode, COURSENAME: course.courseName, COURSEUNIT: course.credits,
            CLASSID: course.classId, SECTION: course.section,
            DAY_NAME: meeting.day, START_TIME: meeting.start, END_TIME: meeting.end,
            MID_DATE: null, MID_START: null, MID_END: null,
            FIN_DATE: null, FIN_START: null, FIN_END: null
        })));
        if (!data.length) {
            return res.status(404).json({ status: 'error', code: 'OFFERING_NOT_FOUND',
                error: 'ไม่พบกลุ่มเรียนในขอบเขตหลักสูตร ปีการศึกษา และภาคเรียนที่ระบุ' });
        }
        res.json({ status: 'success', data, context, sources: evidence.sources });
    } catch (error) {
        sendAdvisorError(res, error);
    }
};
