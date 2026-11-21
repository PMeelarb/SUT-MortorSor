const { inspectAcademicSchema } = require('./academicSchema');
const { AdvisorError, courseKey, creditValue, clockTime, completeOffering } = require('../services/academicData');
const { classLevelIds } = require('../config/academic');

// EXP_CLASS.LEVELID filter (e.g. undergraduate only). Returns SQL plus its own binds.
function levelFilter(levelIds) {
    return alias => {
        const binds = Object.fromEntries(levelIds.map((id, index) => [`level${index}`, id]));
        return { sql: `${alias ? `${alias}.` : ''}LEVELID IN (${Object.keys(binds).map(name => `:${name}`).join(', ')})`, binds };
    };
}

const MAX_PLAN_ROWS = 200;
const MAX_OFFERING_ROWS = 1000;
const MAX_TERM_CATALOG_ROWS = 12000;
const MAX_CATALOG_ROWS = 20;
const MAX_STRUCTURE_ROWS = 300;
const MAX_PROGRAM_COURSES = 2000;

function courseFromRow(row) {
    const english = typeof row.COURSENAMEENG === 'string' ? row.COURSENAMEENG.trim() : '';
    return {
        courseCode: courseKey(row.COURSECODE), courseName: row.COURSENAME,
        ...(english ? { courseNameEng: english } : {}),
        credits: creditValue(row.COURSEUNIT)
    };
}

// Where meeting times may come from. "actual" uses only the target term;
// "simulate" (default) fills courses that lack verified times with real
// historical sections, labelled with their own source year and term.
function normalizeSource(source = {}) {
    const year = Number(source?.sourceAcademicYear);
    const semester = Number(source?.sourceSemester);
    return {
        mode: source?.mode === 'actual' ? 'actual' : 'simulate',
        sourceAcademicYear: Number.isInteger(year) && year > 0 ? year : null,
        sourceSemester: Number.isInteger(semester) && semester >= 1 && semester <= 3 ? semester : null
    };
}

const actualTerm = context => ({
    historical: false,
    sql: 'cl.ACADYEAR = :academicYear AND cl.SEMESTER = :semester',
    binds: { academicYear: context.academicYear, semester: context.semester }
});

// Priority 2: nearest earlier year of the same course and semester whose class
// has complete meeting times. Priority 3: a source term the user picked.
// A different semester is used only when the user picked it explicitly.
function historicalTerm(schema, context, source) {
    const table = schema.tableName;
    const semester = source.sourceSemester ?? context.semester;
    if (source.sourceAcademicYear) {
        return { historical: true, sql: '/* historical */ cl.ACADYEAR = :sourceYear AND cl.SEMESTER = :sourceSemester',
            binds: { sourceYear: source.sourceAcademicYear, sourceSemester: semester } };
    }
    const level = schema.level('h');
    return { historical: true, sql: `/* historical */ cl.SEMESTER = :sourceSemester AND cl.ACADYEAR = (
            SELECT MAX(h.ACADYEAR) FROM ${table('EXP_CLASS')} h
            WHERE h.COURSEID = cl.COURSEID AND h.SEMESTER = :sourceSemester AND h.ACADYEAR < :beforeYear AND ${level.sql}
              AND EXISTS (SELECT 1 FROM ${table('EXP_CLASSTIMETABLE')} ht WHERE ht.CLASSID = h.CLASSID
                  AND ht.WEEKDAY IS NOT NULL AND ht.TIMESLOTFROM IS NOT NULL AND ht.TIMESLOTTO IS NOT NULL))`,
        binds: { sourceSemester: semester, beforeYear: context.academicYear, ...level.binds } };
}

async function readOfferings(connection, outFormat, schema, context, scope, term = actualTerm(context), limit = MAX_OFFERING_ROWS) {
    const table = schema.tableName;
    const timetableJoin = schema.timetable ? `LEFT JOIN ${table('EXP_CLASSTIMETABLE')} ct ON ct.CLASSID = cl.CLASSID` : '';
    const weekday = schema.timetable ? 'ct.WEEKDAY' : 'NULL';
    // TIMESLOTTO is the last 5-minute slot of a meeting, so the meeting ends at the
    // start of the next slot (verified: slot 144 = 11:55, 145 = 12:00; registrar
    // shows 08:00–12:00). EXP_SYSTIMESLOT holds 1–288 and TIMESLOTTO never exceeds
    // 276, so the next slot exists; if it did not, the end stays unknown (null).
    const timeJoins = schema.slotTable ? `
        LEFT JOIN ${table(schema.slotTable)} ts_from ON ts_from.TIMESLOT = ct.TIMESLOTFROM
        LEFT JOIN ${table(schema.slotTable)} ts_to ON ts_to.TIMESLOT = ct.TIMESLOTTO + 1` : '';
    const level = schema.level('cl');
    const result = await connection.execute(`
        SELECT c.COURSECODE, c.COURSENAME, c.COURSENAMEENG, c.COURSEUNIT, cl.CLASSID, cl.SECTION,
               cl.ACADYEAR AS SOURCE_YEAR, cl.SEMESTER AS SOURCE_SEMESTER,
               ${weekday} AS WEEKDAY, ${schema.timeExpression('ts_from')} AS START_TIME,
               ${schema.timeExpression('ts_to')} AS END_TIME
        FROM ${table('EXP_COURSE')} c
        JOIN ${table('EXP_CLASS')} cl ON cl.COURSEID = c.COURSEID
        ${timetableJoin}
        ${timeJoins}
        WHERE ${term.sql}
          AND ${level.sql}
          AND ${scope.filter}
        ORDER BY c.COURSECODE, cl.CLASSID${schema.timetable ? ', ct.WEEKDAY, ct.TIMESLOTFROM' : ''}
        FETCH FIRST ${limit + 1} ROWS ONLY`, { ...term.binds, ...level.binds, ...scope.binds }, { outFormat });
    if (result.rows.length > limit) {
        throw new AdvisorError('RESULT_LIMIT', 'ผลค้นกลุ่มเรียนมีจำนวนมาก กรุณาระบุขอบเขตให้แคบลง');
    }
    const offerings = new Map();
    for (const row of result.rows) {
        const classId = String(row.CLASSID ?? '');
        const section = String(row.SECTION ?? '').trim();
        const course = courseFromRow(row);
        // Missing IDs remain displayable, but cannot be used as actions.
        const key = classId || JSON.stringify([course.courseCode, section]);
        if (!offerings.has(key)) {
            const sourceYear = Number(row.SOURCE_YEAR);
            const sourceSemester = Number(row.SOURCE_SEMESTER);
            offerings.set(key, { ...course, classId, section,
                // academicYear/semester are the planned term. A historical
                // section keeps the term its times really come from.
                academicYear: context.academicYear, semester: context.semester, meetings: [],
                ...(term.historical ? { reference: true,
                    sourceAcademicYear: Number.isInteger(sourceYear) && sourceYear > 0 ? sourceYear : null,
                    sourceSemester: Number.isInteger(sourceSemester) && sourceSemester > 0 ? sourceSemester : null } : {}) });
        }
        const group = offerings.get(key);
        if (group.courseCode !== course.courseCode || group.section !== section
            || group.courseName !== course.courseName || group.credits !== course.credits) {
            throw new AdvisorError('DATA_AMBIGUOUS', 'พบข้อมูลกลุ่มเรียนที่มีรหัสกลุ่มเดียวกันหลายรายการ');
        }
        const meeting = { day: schema.resolveDay(row.WEEKDAY), start: clockTime(row.START_TIME), end: clockTime(row.END_TIME) };
        if (!group.meetings.some(item => item.day === meeting.day && item.start === meeting.start && item.end === meeting.end)) {
            group.meetings.push(meeting);
        }
    }
    return [...offerings.values()].map(group => ({ ...group, actionable: completeOffering(group) }));
}

async function termPublished(connection, outFormat, schema, context) {
    const level = schema.level('');
    const result = await connection.execute(`
        SELECT COUNT(*) AS TERM_CLASSES FROM ${schema.tableName('EXP_CLASS')}
        WHERE ACADYEAR = :academicYear AND SEMESTER = :semester AND ${level.sql} AND ROWNUM <= 1`, {
        academicYear: context.academicYear, semester: context.semester, ...level.binds
    }, { outFormat });
    return Number(result.rows[0]?.TERM_CLASSES) > 0;
}

// Priority 1 actual offerings, then Priority 2/3 historical sections for courses
// that still have no section with complete times. Nothing is invented.
async function readTermOfferings(connection, outFormat, schema, context, scope, source, limit = MAX_OFFERING_ROWS) {
    const options = normalizeSource(source);
    const published = await termPublished(connection, outFormat, schema, context);
    const term = { academicYear: context.academicYear, semester: context.semester, published, ...options };
    const actual = published ? await readOfferings(connection, outFormat, schema, context, scope, actualTerm(context), limit) : [];
    if (options.mode === 'actual' || !schema.timetable) return { term, offerings: actual };
    const covered = new Set(actual.filter(completeOffering).map(group => group.courseCode));
    const historical = (await readOfferings(connection, outFormat, schema, context, scope,
        historicalTerm(schema, context, options), limit)).filter(group => !covered.has(group.courseCode));
    return { term, offerings: [...actual, ...historical] };
}

// For courses with no usable section at all: the latest term (any semester)
// that has complete times, offered to the user as an explicit choice only.
async function readAlternativeTerms(connection, outFormat, schema, scope, codes) {
    if (!codes.length || !schema.timetable) return {};
    const table = schema.tableName;
    const level = schema.level('h');
    const result = await connection.execute(`
        SELECT c.COURSECODE, MAX(h.ACADYEAR * 10 + h.SEMESTER) AS LATEST_TERM
        FROM ${table('EXP_COURSE')} c
        JOIN ${table('EXP_CLASS')} h ON h.COURSEID = c.COURSEID
        WHERE ${scope.filter} AND h.SEMESTER BETWEEN 1 AND 3 AND ${level.sql}
          AND EXISTS (SELECT 1 FROM ${table('EXP_CLASSTIMETABLE')} ht WHERE ht.CLASSID = h.CLASSID
              AND ht.WEEKDAY IS NOT NULL AND ht.TIMESLOTFROM IS NOT NULL AND ht.TIMESLOTTO IS NOT NULL)
        GROUP BY c.COURSECODE`, { ...scope.binds, ...level.binds }, { outFormat });
    const wanted = new Set(codes);
    return Object.fromEntries(result.rows.map(row => [courseKey(row.COURSECODE), Number(row.LATEST_TERM)])
        .filter(([code, value]) => wanted.has(code) && Number.isInteger(value) && value > 0)
        .map(([code, value]) => [code, { academicYear: Math.floor(value / 10), semester: value % 10 }]));
}

function courseOfferingStatus(plan, offerings, term) {
    return Object.fromEntries(plan.map(course => {
        const groups = offerings.filter(group => group.courseCode === course.courseCode);
        let status;
        if (groups.some(group => !group.reference && completeOffering(group))) status = 'offered';
        else if (groups.some(group => group.reference && completeOffering(group))) status = 'reference';
        else if (groups.length) status = 'incomplete';
        else status = term.published ? 'not_offered' : 'unpublished';
        return [course.courseCode, status];
    }));
}

async function termEvidence(connection, outFormat, schema, scope, termOfferings, plan) {
    if (!termOfferings) return {};
    const courseStatus = courseOfferingStatus(plan, termOfferings.offerings, termOfferings.term);
    const missing = Object.keys(courseStatus).filter(code => ['not_offered', 'unpublished'].includes(courseStatus[code]));
    const alternativeTerms = termOfferings.term.mode === 'simulate'
        ? await readAlternativeTerms(connection, outFormat, schema, scope, missing) : {};
    return { term: termOfferings.term, courseStatus, alternativeTerms };
}

async function findProgram(connection, outFormat, table, context) {
    const programs = await connection.execute(`
        SELECT p.PROGRAMID, p.PROGRAMNAME, p.PROGRAMYEAR, f.FACULTYNAME
        FROM ${table('EXP_PROGRAM')} p
        JOIN ${table('EXP_FACULTY')} f ON f.FACULTYID = p.FACULTYID
        WHERE LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(f.FACULTYNAME), '^สำนักวิชา[[:space:]]*', ''), '[[:space:]]+', ' ')))
                = LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(:faculty), '^สำนักวิชา[[:space:]]*', ''), '[[:space:]]+', ' ')))
          AND (LOWER(TRIM(REGEXP_REPLACE(p.PROGRAMNAME, '[[:space:]]+', ' ')))
                    = LOWER(TRIM(REGEXP_REPLACE(:major, '[[:space:]]+', ' ')))
               OR LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(p.PROGRAMNAME, '-[[:space:]]*[0-9]{4}.*$', ''), '[[:space:]]+', ' ')))
                    = LOWER(TRIM(REGEXP_REPLACE(:major, '[[:space:]]+', ' '))))
          AND (:curriculumYear IS NULL OR p.PROGRAMYEAR = :curriculumYear)
        ORDER BY p.PROGRAMYEAR, p.PROGRAMID
        FETCH FIRST 21 ROWS ONLY`, {
        faculty: context.faculty, major: context.major, curriculumYear: context.curriculumYear
    }, { outFormat });
    if (programs.rows.length === 1) return { program: programs.rows[0] };
    return {
        program: null, status: programs.rows.length ? 'ambiguous_program' : 'program_not_found',
        curriculumYears: [...new Set(programs.rows.map(row => Number(row.PROGRAMYEAR)))].filter(Number.isInteger)
    };
}

const programInfo = program => ({ name: program.PROGRAMNAME, curriculumYear: Number(program.PROGRAMYEAR), programId: String(program.PROGRAMID) });

// Where one course sits in the student's program: its structure condition and
// the top-level heading ("1." / "2." / "3."), joined on PROGRAMID + CONDITIONID
// (no FK is declared; the keys were checked against real rows).
async function readCoursePlacement(connection, outFormat, table, context, courseId) {
    const found = await findProgram(connection, outFormat, table, context);
    if (!found.program) return { programFound: false, conditions: [] };
    const result = await connection.execute(`
        SELECT ps.CONDITIONID, ps.DESCRIPTION, hd.DESCRIPTION AS HEADING_DESCRIPTION
        FROM ${table('EXP_COURSEINPROGRAM')} cip
        JOIN ${table('EXP_PROGRAMSTRUCTURE')} ps ON ps.PROGRAMID = cip.PROGRAMID AND ps.CONDITIONID = cip.CONDITIONID
        LEFT JOIN ${table('EXP_PROGRAMSTRUCTURE')} hd ON hd.PROGRAMID = cip.PROGRAMID
             AND hd.CONDITIONID = REGEXP_SUBSTR(cip.CONDITIONID, '^[0-9]+') || '.'
        WHERE cip.PROGRAMID = :programId AND cip.COURSEID = :courseId
        ORDER BY ps.CONDITIONID
        FETCH FIRST 5 ROWS ONLY`, { programId: found.program.PROGRAMID, courseId }, { outFormat });
    const text = value => String(value ?? '').trim();
    return {
        programFound: true, program: programInfo(found.program),
        conditions: result.rows.map(row => ({ id: text(row.CONDITIONID), description: text(row.DESCRIPTION),
            heading: text(row.HEADING_DESCRIPTION) })).filter(item => item.description)
    };
}

function conditionParts(id) {
    return String(id ?? '').split('.').filter(Boolean).map(Number);
}

function compareConditions(left, right) {
    const a = conditionParts(left);
    const b = conditionParts(right);
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
        const difference = (a[index] ?? -1) - (b[index] ?? -1);
        if (difference) return difference;
    }
    return 0;
}

// Course category from the program's own top-level structure heading.
function categoryOf(conditionId, headings) {
    const top = conditionParts(conditionId)[0];
    const heading = headings.get(top) || '';
    if (/ศึกษาทั่วไป|general/i.test(heading)) return 'genEd';
    if (/เลือกเสรี|free/i.test(heading)) return 'free';
    return 'major';
}

const catalogSource = { id: 'oracle-catalog', label: 'Oracle EXP_COURSE' };
const planSource = { id: 'oracle-plan', label: 'Oracle EXP_PROGRAM / EXP_STUDYPLAN / EXP_COURSE' };
const structureSource = { id: 'oracle-structure', label: 'Oracle EXP_PROGRAMSTRUCTURE / EXP_COURSEINPROGRAM' };
const offeringSource = (schema, offerings = []) => {
    const sources = [...new Set(offerings.filter(group => group.reference)
        .map(group => `${group.sourceAcademicYear}/${group.sourceSemester}`))];
    return { id: 'oracle-offerings', label: (schema.timetable
        ? 'Oracle EXP_CLASS / EXP_CLASSTIMETABLE และ metadata ตารางอ้างอิง' : 'Oracle EXP_CLASS')
        + (sources.length ? ` (เวลาอ้างอิงจาก ${sources.join(', ')})` : '') };
};

function createAcademicRepository(database, { levelIds = classLevelIds() } = {}) {
    const level = levelFilter(levelIds);
    // Every query of this repository sees the same class-level scope.
    const inspect = async (...args) => ({ ...await inspectAcademicSchema(...args), level });

    async function read(context, { includeOfferings = Boolean(context.academicYear), source } = {}) {
        const connection = await database.oracledb.getConnection();
        try {
            const outFormat = database.oracledb.OUT_FORMAT_OBJECT;
            const schema = await inspect(connection, outFormat, { offerings: includeOfferings });
            const table = schema.tableName;
            const found = await findProgram(connection, outFormat, table, context);
            if (!found.program) {
                return {
                    program: null, plan: [], offerings: [], sources: [], warnings: schema.warnings,
                    status: found.status, curriculumYears: found.curriculumYears
                };
            }
            const program = found.program;
            const planResult = await connection.execute(`
                SELECT DISTINCT c.COURSECODE, c.COURSENAME, c.COURSEUNIT,
                       COUNT(CASE WHEN c.COURSEID IS NULL
                           OR REGEXP_REPLACE(c.COURSECODE, '[[:space:]]+', '') IS NULL
                           THEN 1 END) OVER () AS UNRESOLVED_PLAN_ROWS
                FROM ${table('EXP_STUDYPLAN')} sp
                LEFT JOIN ${table('EXP_COURSE')} c ON c.COURSEID = sp.COURSEID
                WHERE sp.PROGRAMID = :programId AND sp.STUDENTYEAR = :yearLevel AND sp.SEMESTER = :semester
                ORDER BY c.COURSECODE
                FETCH FIRST ${MAX_PLAN_ROWS + 1} ROWS ONLY`, {
                programId: program.PROGRAMID, yearLevel: context.yearLevel, semester: context.semester
            }, { outFormat });
            if (planResult.rows.length > MAX_PLAN_ROWS) {
                throw new AdvisorError('RESULT_LIMIT', 'ผลค้นแผนการเรียนมีจำนวนมาก กรุณาระบุขอบเขตให้แคบลง');
            }

            // A class is an offering only when EXP_CLASS matches the requested
            // academic year and term. Plan membership alone does not imply this.
            const unresolvedPlanRows = planResult.rows[0]?.UNRESOLVED_PLAN_ROWS ?? 0;
            const plan = planResult.rows.map(courseFromRow).filter(course => course.courseCode);
            if (new Set(plan.map(course => course.courseCode)).size !== plan.length) {
                throw new AdvisorError('DATA_AMBIGUOUS', 'พบข้อมูลรายวิชารหัสเดียวกันหลายรายการในแผน กรุณาตรวจรุ่นรายวิชาใน Oracle');
            }
            const scope = {
                filter: `EXISTS (
                    SELECT 1 FROM ${table('EXP_STUDYPLAN')} sp
                    WHERE sp.COURSEID = c.COURSEID AND sp.PROGRAMID = :programId
                      AND sp.STUDENTYEAR = :yearLevel AND sp.SEMESTER = :planSemester)`,
                binds: { programId: program.PROGRAMID, yearLevel: context.yearLevel, planSemester: context.semester }
            };
            const termOfferings = includeOfferings && plan.length
                ? await readTermOfferings(connection, outFormat, schema, context, scope, source) : null;
            const offerings = termOfferings?.offerings ?? [];
            return {
                status: unresolvedPlanRows ? (plan.length ? 'plan_partial' : 'plan_incomplete') : 'found',
                program: programInfo(program),
                plan, unresolvedPlanRows,
                offerings, ...await termEvidence(connection, outFormat, schema, scope, termOfferings, plan),
                sources: [planSource, ...(termOfferings ? [offeringSource(schema, offerings)] : [])],
                warnings: schema.warnings
            };
        } finally {
            await connection.close();
        }
    }

    // strictOfferings=false: an info question still answers when the offering
    // lookup is ambiguous; it only skips the offering part.
    async function readCourse(search, context, { includeOfferings = false, source, strictOfferings = true } = {}) {
        const connection = await database.oracledb.getConnection();
        try {
            const outFormat = database.oracledb.OUT_FORMAT_OBJECT;
            // With the student's program known, also report where the course sits in that program.
            const withProgram = Boolean(context.faculty && context.major);
            const schema = await inspect(connection, outFormat, { plan: withProgram, offerings: includeOfferings, structure: withProgram });
            const filter = search.code
                ? "UPPER(REGEXP_REPLACE(TRIM(c.COURSECODE), '[[:space:]]+', '')) = :courseCode"
                : 'INSTR(UPPER(c.COURSENAME), UPPER(:courseName)) > 0';
            const binds = search.code ? { courseCode: search.code } : { courseName: search.name };
            const result = await connection.execute(`
                SELECT DISTINCT c.COURSEID, c.COURSECODE, c.COURSENAME, c.COURSENAMEENG, c.COURSEUNIT
                FROM ${schema.tableName('EXP_COURSE')} c
                WHERE ${filter}
                ORDER BY c.COURSECODE, c.COURSEID
                FETCH FIRST ${MAX_CATALOG_ROWS + 1} ROWS ONLY`, binds, { outFormat });
            if (result.rows.length > MAX_CATALOG_ROWS) {
                throw new AdvisorError('RESULT_LIMIT', 'พบรายวิชาหลายรายการ กรุณาระบุรหัสวิชาหรือชื่อให้ชัดเจนขึ้น');
            }
            const plan = result.rows.map(courseFromRow).filter(course => course.courseCode);
            const hasCourseId = result.rows[0]?.COURSEID != null;
            const canQuery = includeOfferings && plan.length === 1 && result.rows.length === 1 && hasCourseId;
            if (strictOfferings && includeOfferings && plan.length === 1 && !canQuery) {
                throw new AdvisorError('DATA_AMBIGUOUS', 'ยังยืนยันรายการรายวิชาเพื่อค้นกลุ่มเรียนไม่ได้ กรุณาระบุรหัสวิชาให้ชัดเจนขึ้น');
            }
            const single = plan.length === 1 && result.rows.length === 1 && hasCourseId;
            const placement = withProgram && single
                ? await readCoursePlacement(connection, outFormat, schema.tableName, context, result.rows[0].COURSEID) : null;
            const scope = { filter: 'c.COURSEID = :courseId', binds: { courseId: result.rows[0]?.COURSEID } };
            const termOfferings = canQuery ? await readTermOfferings(connection, outFormat, schema, context, scope, source) : null;
            const offerings = termOfferings?.offerings ?? [];
            return { program: null, plan, offerings, ...await termEvidence(connection, outFormat, schema, scope, termOfferings, plan),
                ...(placement ? { placement } : {}),
                sources: [catalogSource, ...(placement?.conditions.length ? [structureSource] : []),
                    ...(termOfferings ? [offeringSource(schema, offerings)] : [])], warnings: schema.warnings || [] };
        } finally {
            await connection.close();
        }
    }

    // Curriculum structure: categories, credit totals and elective modules.
    async function readStructure(context) {
        const connection = await database.oracledb.getConnection();
        try {
            const outFormat = database.oracledb.OUT_FORMAT_OBJECT;
            const schema = await inspect(connection, outFormat, { offerings: false, structure: true });
            const table = schema.tableName;
            const found = await findProgram(connection, outFormat, table, context);
            if (!found.program) return { program: null, conditions: [], status: found.status, curriculumYears: found.curriculumYears, sources: [] };
            const result = await connection.execute(`
                SELECT ps.CONDITIONID, ps.DESCRIPTION, ps.CREDITTOTAL, ps.CONDITIONTYPE,
                       (SELECT COUNT(*) FROM ${table('EXP_COURSEINPROGRAM')} cip
                        WHERE cip.PROGRAMID = ps.PROGRAMID AND cip.CONDITIONID = ps.CONDITIONID) AS COURSE_COUNT
                FROM ${table('EXP_PROGRAMSTRUCTURE')} ps
                WHERE ps.PROGRAMID = :programId
                FETCH FIRST ${MAX_STRUCTURE_ROWS + 1} ROWS ONLY`, { programId: found.program.PROGRAMID }, { outFormat });
            if (result.rows.length > MAX_STRUCTURE_ROWS) {
                throw new AdvisorError('RESULT_LIMIT', 'โครงสร้างหลักสูตรมีรายการมากเกินกว่าที่รองรับ');
            }
            const conditions = result.rows.map(row => ({
                id: String(row.CONDITIONID ?? '').trim(), description: String(row.DESCRIPTION ?? '').trim(),
                credits: Number.isFinite(Number(row.CREDITTOTAL)) && row.CREDITTOTAL !== null ? Number(row.CREDITTOTAL) : null,
                type: String(row.CONDITIONTYPE ?? '').trim(), courseCount: Number(row.COURSE_COUNT) || 0
            })).filter(item => item.id && item.description).sort((a, b) => compareConditions(a.id, b.id));
            return { status: 'found', program: programInfo(found.program), conditions, sources: [structureSource] };
        } finally {
            await connection.close();
        }
    }

    // Course search for one planned term: program courses by category plus
    // other offered courses, each with real or clearly labelled historical sections.
    async function readTermCatalog(context, source) {
        const connection = await database.oracledb.getConnection();
        try {
            const outFormat = database.oracledb.OUT_FORMAT_OBJECT;
            const schema = await inspect(connection, outFormat, { structure: true });
            const table = schema.tableName;
            const found = await findProgram(connection, outFormat, table, context);
            if (!found.program) return { status: found.status, curriculumYears: found.curriculumYears, program: null, term: null, courses: [] };
            const programId = found.program.PROGRAMID;
            const headings = await connection.execute(`
                SELECT CONDITIONID, DESCRIPTION, DESCRIPTIONENG FROM ${table('EXP_PROGRAMSTRUCTURE')}
                WHERE PROGRAMID = :programId FETCH FIRST ${MAX_STRUCTURE_ROWS} ROWS ONLY`, { programId }, { outFormat });
            const topHeadings = new Map(headings.rows.filter(row => conditionParts(row.CONDITIONID).length === 1)
                .map(row => [conditionParts(row.CONDITIONID)[0], `${row.DESCRIPTION ?? ''} ${row.DESCRIPTIONENG ?? ''}`]));
            const programRows = await connection.execute(`
                SELECT c.COURSECODE, c.COURSENAME, c.COURSENAMEENG, c.COURSEUNIT, cip.CONDITIONID
                FROM ${table('EXP_COURSEINPROGRAM')} cip
                JOIN ${table('EXP_COURSE')} c ON c.COURSEID = cip.COURSEID
                WHERE cip.PROGRAMID = :programId
                ORDER BY c.COURSECODE, cip.CONDITIONID
                FETCH FIRST ${MAX_PROGRAM_COURSES + 1} ROWS ONLY`, { programId }, { outFormat });
            if (programRows.rows.length > MAX_PROGRAM_COURSES) throw new AdvisorError('RESULT_LIMIT', 'รายวิชาในหลักสูตรมีจำนวนมากเกินกว่าที่รองรับ');
            const courses = new Map();
            for (const row of programRows.rows) {
                const course = courseFromRow(row);
                if (course.courseCode && !courses.has(course.courseCode)) {
                    courses.set(course.courseCode, { ...course, conditionId: String(row.CONDITIONID ?? ''),
                        category: categoryOf(row.CONDITIONID, topHeadings), inProgram: true });
                }
            }
            const inProgram = `SELECT cip.COURSEID FROM ${table('EXP_COURSEINPROGRAM')} cip WHERE cip.PROGRAMID = :programId`;
            const programScope = { filter: `c.COURSEID IN (${inProgram})`, binds: { programId } };
            const programTerm = await readTermOfferings(connection, outFormat, schema, context, programScope, source, MAX_TERM_CATALOG_ROWS);
            const options = normalizeSource(source);
            const otherScope = { filter: `c.COURSEID NOT IN (${inProgram})`, binds: { programId } };
            let others = [];
            if (programTerm.term.published) {
                others = await readOfferings(connection, outFormat, schema, context, otherScope, actualTerm(context), MAX_TERM_CATALOG_ROWS);
            } else if (options.mode === 'simulate' && schema.timetable) {
                // Free electives in an unpublished term: one whole source term
                // (the user's choice, or the latest earlier year of the same semester).
                const semester = options.sourceSemester ?? context.semester;
                let year = options.sourceAcademicYear;
                if (!year) {
                    const latest = await connection.execute(`
                        SELECT MAX(ACADYEAR) AS REFERENCE_YEAR FROM ${table('EXP_CLASS')}
                        WHERE SEMESTER = :semester AND ACADYEAR < :academicYear AND ${level('').sql}`,
                    { semester, academicYear: context.academicYear, ...level('').binds }, { outFormat });
                    year = Number(latest.rows[0]?.REFERENCE_YEAR) || null;
                }
                if (year) {
                    others = await readOfferings(connection, outFormat, schema, context, otherScope, { historical: true,
                        sql: '/* historical */ cl.ACADYEAR = :sourceYear AND cl.SEMESTER = :sourceSemester',
                        binds: { sourceYear: year, sourceSemester: semester } }, MAX_TERM_CATALOG_ROWS);
                }
            }
            const offerings = [...programTerm.offerings, ...others];
            for (const group of offerings) {
                if (!courses.has(group.courseCode)) {
                    courses.set(group.courseCode, { courseCode: group.courseCode, courseName: group.courseName,
                        credits: group.credits, conditionId: '', category: 'free', inProgram: false });
                }
            }
            const list = [...courses.values()];
            const status = courseOfferingStatus(list, offerings, programTerm.term);
            return {
                status: 'found', program: programInfo(found.program), term: programTerm.term,
                courses: list.map(course => ({ ...course, status: status[course.courseCode],
                    sections: offerings.filter(group => group.courseCode === course.courseCode) }))
                    .sort((a, b) => a.courseCode.localeCompare(b.courseCode)),
                sources: [structureSource, offeringSource(schema, offerings)], warnings: schema.warnings
            };
        } finally {
            await connection.close();
        }
    }

    // Terms with at least one class in EXP_CLASS. Semester 0 is not a study term.
    async function readTerms() {
        const connection = await database.oracledb.getConnection();
        try {
            const schema = await inspect(connection, database.oracledb.OUT_FORMAT_OBJECT, { plan: false, offerings: true });
            const result = await connection.execute(`
                SELECT ACADYEAR, SEMESTER, COUNT(*) AS CLASSES FROM ${schema.tableName('EXP_CLASS')}
                WHERE SEMESTER BETWEEN 1 AND 3 AND ${level('').sql}
                GROUP BY ACADYEAR, SEMESTER ORDER BY ACADYEAR, SEMESTER`, level('').binds, { outFormat: database.oracledb.OUT_FORMAT_OBJECT });
            return result.rows.map(row => ({ academicYear: Number(row.ACADYEAR), semester: Number(row.SEMESTER), classes: Number(row.CLASSES) }))
                .filter(row => Number.isInteger(row.academicYear) && Number.isInteger(row.semester));
        } finally {
            await connection.close();
        }
    }

    return { read, readCourse, readStructure, readTermCatalog, readTerms };
}

module.exports = { createAcademicRepository, normalizeSource };
