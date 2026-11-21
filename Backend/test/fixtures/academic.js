// Synthetic data only. No production records, student profiles or credentials.
const context = {
    faculty: 'สำนักวิชาทดสอบ', major: 'สาขาทดสอบ',
    curriculumYear: 2565, academicYear: 2569, yearLevel: 3, semester: 2
};
const offering = {
    classId: 'fixture-class-1', courseCode: 'TEST1001', courseName: 'รายวิชาจำลอง',
    section: 'A', credits: 2.5, academicYear: 2569, semester: 2,
    meetings: [
        { day: 'จันทร์', start: '09:15', end: '10:45' },
        { day: 'พุธ', start: '13:00', end: '14:30' }
    ],
    actionable: true
};
const evidence = {
    status: 'found', program: { name: 'สาขาทดสอบ-2565', curriculumYear: 2565 },
    plan: [
        { courseCode: 'TEST1001', courseName: 'รายวิชาจำลอง', credits: 2.5 },
        { courseCode: 'TEST1002', courseName: 'วิชาในแผนที่ไม่มีข้อมูลเปิดสอน', credits: 3 }
    ],
    offerings: [offering], warnings: [],
    sources: [{ id: 'oracle-plan', label: 'Oracle fixture plan' }, { id: 'oracle-offerings', label: 'Oracle fixture offerings' }]
};

function mockDatabase(options = {}) {
    const owner = options.exportSchema ? 'AVSREG' : 'ACADEMIC_FIXTURE';
    const names = {
        EXP_FACULTY: ['FACULTYID', 'FACULTYNAME'],
        EXP_PROGRAM: ['PROGRAMID', 'PROGRAMNAME', 'PROGRAMYEAR', 'FACULTYID'],
        EXP_STUDYPLAN: ['PROGRAMID', 'COURSEID', 'STUDENTYEAR', 'SEMESTER'],
        EXP_COURSE: ['COURSEID', 'COURSECODE', 'COURSENAME', 'COURSEUNIT', 'COURSENAMEENG'],
        EXP_CLASS: ['CLASSID', 'COURSEID', 'ACADYEAR', 'SEMESTER', 'SECTION', 'LEVELID'],
        EXP_CLASSTIMETABLE: ['CLASSID', 'WEEKDAY', 'TIMESLOTFROM', 'TIMESLOTTO'],
        EXP_STYTIMESLOT: ['TIMESLOT', 'TIMEOF'],
        EXP_STYTIMEWEEK: ['DAY_ID', 'DAY_LABEL'],
        EXP_PROGRAMSTRUCTURE: ['PROGRAMID', 'CONDITIONID', 'DESCRIPTION', 'CREDITTOTAL', 'CONDITIONTYPE'],
        EXP_COURSEINPROGRAM: ['PROGRAMID', 'CONDITIONID', 'COURSEID']
    };
    if (options.exportSchema) {
        delete names.EXP_STYTIMESLOT;
        delete names.EXP_STYTIMEWEEK;
        names.EXP_SYSTIMESLOT = ['TIMESLOT', 'TIMEOF'];
        names.EXP_SYSTIMEWEEK = ['WEEKDAY', 'WEEKCALL', 'WEEKCALLABB', 'WEEKCALLLONG'];
    }
    const numericKeys = ['FACULTYID', 'PROGRAMID', 'COURSEID', 'CLASSID', 'WEEKDAY', 'TIMESLOT', 'TIMESLOTFROM', 'TIMESLOTTO'];
    let columns = Object.entries(names).flatMap(([table, fields]) => fields.map(name => ({
        OWNER: owner, TABLE_NAME: table, COLUMN_NAME: name,
        DATA_TYPE: options.exportSchema && numericKeys.includes(name) && options.badKeyType !== `${table}.${name}`
            ? 'NUMBER' : 'VARCHAR2'
    })));
    if (options.missingColumn) columns = columns.filter(row => row.COLUMN_NAME !== options.missingColumn);
    const keys = [
        ['EXP_PROGRAM', 'FACULTYID', 'EXP_FACULTY', 'FACULTYID'],
        ['EXP_STUDYPLAN', 'PROGRAMID', 'EXP_PROGRAM', 'PROGRAMID'],
        ['EXP_STUDYPLAN', 'COURSEID', 'EXP_COURSE', 'COURSEID'],
        ['EXP_CLASS', 'COURSEID', 'EXP_COURSE', 'COURSEID'],
        ['EXP_CLASSTIMETABLE', 'CLASSID', 'EXP_CLASS', 'CLASSID'],
        ['EXP_CLASSTIMETABLE', 'TIMESLOTFROM', 'EXP_STYTIMESLOT', 'TIMESLOT'],
        ['EXP_CLASSTIMETABLE', 'TIMESLOTTO', 'EXP_STYTIMESLOT', 'TIMESLOT'],
        ['EXP_CLASSTIMETABLE', 'WEEKDAY', 'EXP_STYTIMEWEEK', 'DAY_ID']
    ];
    let relations = keys.map(([table, column, target, targetColumn]) => ({
        TABLE_NAME: table, COLUMN_NAME: column, REFERENCED_TABLE: target,
        REFERENCED_COLUMN: targetColumn, KEY_COLUMNS: 1
    }));
    if (options.noKeys || options.exportSchema) relations = [];
    if (options.noTimetableKey) relations = relations.filter(row => row.REFERENCED_TABLE !== 'EXP_CLASS');
    if (options.noTimeKeys) relations = relations.filter(row => row.REFERENCED_TABLE !== 'EXP_STYTIMESLOT');
    if (options.noDayKey) relations = relations.filter(row => row.REFERENCED_TABLE !== 'EXP_STYTIMEWEEK');
    const calls = [];
    let closed = 0;
    const connection = {
        async execute(sql, binds) {
            calls.push({ sql, binds });
            if (options.failQuery && sql.includes(options.failQuery)) throw new Error('fixture driver failure');
            if (sql.includes('FROM ALL_TAB_COLUMNS')) return { rows: columns };
            if (sql.includes('FROM ALL_CONSTRAINTS fk')) return { rows: relations };
            if (sql.includes('AS RELATION_ID')) return { rows: Array.from(sql.matchAll(/SELECT (\d+) AS RELATION_ID/g),
                ([, index]) => ({ RELATION_ID: Number(index), VERIFIED: options.failedExportRelations?.includes(Number(index)) ? 0 : 1 })) };
            if (sql.includes('"EXP_SYSTIMEWEEK" FETCH')) return { rows: [
                { WEEKDAY: 10, WEEKCALLLONG: 'วันจันทร์' }, { WEEKDAY: 20, WEEKCALLLONG: 'วันพุธ' }
            ] };
            if (sql.includes('SELECT * FROM')) return { rows: [{ DAY_ID: '10', DAY_LABEL: 'วันจันทร์' }, { DAY_ID: '20', DAY_LABEL: 'วันพุธ' }] };
            if (sql.includes('"EXP_PROGRAM" p')) return { rows: options.programs ?? [{ PROGRAMID: 'fixture-program', PROGRAMNAME: 'สาขาทดสอบ-2565', PROGRAMYEAR: 2565 }] };
            if (sql.includes('SELECT DISTINCT c.COURSECODE')) return { rows: options.planRows ?? [{ COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: '2.5(2-1-4)' }] };
            if (sql.includes('SELECT DISTINCT c.COURSEID')) return { rows: options.catalogRows ?? [
                { COURSEID: 'fixture-course-1', COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: '2.5' }
            ] };
            if (sql.includes('AS TERM_CLASSES')) return { rows: [{ TERM_CLASSES: options.termPublished === false ? 0 : 1 }] };
            if (sql.includes('/* historical */')) return { rows: options.historicalRows ?? [] };
            if (sql.includes('AS LATEST_TERM')) return { rows: options.alternativeRows ?? [] };
            if (sql.includes('AS COURSE_COUNT')) return { rows: options.structureRows ?? [] };
            if (sql.includes('AS HEADING_DESCRIPTION')) return { rows: options.courseCategoryRows ?? [] };
            if (sql.includes('DESCRIPTIONENG FROM')) return { rows: options.headingRows ?? [] };
            if (sql.includes('cip.CONDITIONID\n')) return { rows: options.programCourseRows ?? [] };
            if (sql.includes('AS REFERENCE_YEAR')) return { rows: [{ REFERENCE_YEAR: options.referenceYear ?? null }] };
            if (sql.includes('GROUP BY ACADYEAR, SEMESTER')) return { rows: options.termRows ?? [
                { ACADYEAR: 2568, SEMESTER: 3, CLASSES: 10 }, { ACADYEAR: 2569, SEMESTER: 1, CLASSES: 12 }
            ] };
            if (sql.includes('FROM EXP_CLASS c')) return { rows: options.timetableRows ?? [] };
            if (sql.trim().startsWith('SELECT COURSECODE, COURSENAME, COURSEUNIT')) {
                return { rows: options.catalogCourseRows ?? [{ COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: '2.5' }] };
            }
            if (sql.includes(`JOIN "${owner}"."EXP_CLASS"`)) {
                return { rows: options.offeringRows ?? [
                    { COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: '2.5', CLASSID: 'fixture-class-1', SECTION: 'A', WEEKDAY: '10', START_TIME: '09:15:00', END_TIME: '10:45:00' },
                    { COURSECODE: 'TEST1001', COURSENAME: 'รายวิชาจำลอง', COURSEUNIT: '2.5', CLASSID: 'fixture-class-1', SECTION: 'A', WEEKDAY: '20', START_TIME: '13:00', END_TIME: '14:30' }
                ] };
            }
            throw new Error('Unexpected fixture query');
        },
        async close() { closed++; }
    };
    return {
        oracledb: { OUT_FORMAT_OBJECT: 4002, getConnection: async () => connection },
        calls, closed: () => closed
    };
}

module.exports = { context, offering, evidence, mockDatabase };
