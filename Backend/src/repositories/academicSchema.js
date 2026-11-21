const { AdvisorError, dayName } = require('../services/academicData');

// These mappings come from the existing controller. They are candidates only.
// Every column and relationship is checked against Oracle metadata before use.
const REQUIRED_COLUMNS = {
    EXP_FACULTY: ['FACULTYID', 'FACULTYNAME'],
    EXP_PROGRAM: ['PROGRAMID', 'PROGRAMNAME', 'PROGRAMYEAR', 'FACULTYID'],
    EXP_STUDYPLAN: ['PROGRAMID', 'COURSEID', 'STUDENTYEAR', 'SEMESTER'],
    // COURSENAMEENG verified in USER_TAB_COLUMNS (2026-11-21). EXP_COURSE has no description column.
    EXP_COURSE: ['COURSEID', 'COURSECODE', 'COURSENAME', 'COURSEUNIT', 'COURSENAMEENG'],
    EXP_CLASS: ['CLASSID', 'COURSEID', 'ACADYEAR', 'SEMESTER', 'SECTION', 'LEVELID'],
    EXP_CLASSTIMETABLE: ['CLASSID', 'WEEKDAY', 'TIMESLOTFROM', 'TIMESLOTTO'],
    // No foreign keys are declared on these two tables. PROGRAMID/CONDITIONID/COURSEID
    // were checked against real rows (read-only) before use; columns are rechecked here.
    EXP_PROGRAMSTRUCTURE: ['PROGRAMID', 'CONDITIONID', 'DESCRIPTION', 'CREDITTOTAL', 'CONDITIONTYPE'],
    EXP_COURSEINPROGRAM: ['PROGRAMID', 'CONDITIONID', 'COURSEID']
};
const STRUCTURE_TABLES = ['EXP_PROGRAMSTRUCTURE', 'EXP_COURSEINPROGRAM'];
const WEEK_TABLES = ['EXP_STYTIMEWEEK', 'EXP_SYSTIMEWEEK'];
const TABLES = [...Object.keys(REQUIRED_COLUMNS), 'EXP_STYTIMESLOT', 'EXP_SYSTIMESLOT', ...WEEK_TABLES];
const PLAN_TABLES = ['EXP_FACULTY', 'EXP_PROGRAM', 'EXP_STUDYPLAN', 'EXP_COURSE'];
const PLAN_RELATIONS = [
    ['EXP_PROGRAM', 'FACULTYID', 'EXP_FACULTY', 'FACULTYID'],
    ['EXP_STUDYPLAN', 'PROGRAMID', 'EXP_PROGRAM', 'PROGRAMID'],
    ['EXP_STUDYPLAN', 'COURSEID', 'EXP_COURSE', 'COURSEID']
];
const OFFERING_RELATION = ['EXP_CLASS', 'COURSEID', 'EXP_COURSE', 'COURSEID'];
const TIMETABLE_RELATION = ['EXP_CLASSTIMETABLE', 'CLASSID', 'EXP_CLASS', 'CLASSID'];
const EXPORT_LOOKUPS = [
    ['EXP_CLASSTIMETABLE', 'TIMESLOTFROM', 'EXP_SYSTIMESLOT', 'TIMESLOT'],
    ['EXP_CLASSTIMETABLE', 'TIMESLOTTO', 'EXP_SYSTIMESLOT', 'TIMESLOT'],
    ['EXP_CLASSTIMETABLE', 'WEEKDAY', 'EXP_SYSTIMEWEEK', 'WEEKDAY']
];

function relationKey(relation) {
    return relation.join('.');
}

async function verifyExportRelations(connection, outFormat, tableName, candidates) {
    if (!candidates.length) return new Set();
    // AVSREG metadata and the reviewed aggregate evidence establish these
    // candidate mappings. Recheck integrity because the export can be refreshed.
    const checks = candidates.map(([table, name, target, targetColumn], index) => {
        const child = `c.${identifier(name)}`;
        const parent = `p.${identifier(targetColumn)}`;
        // The plan may reference removed or missing courses. The scoped plan
        // query counts those entries and returns only catalog-backed course facts.
        const allowMissingCourse = table === 'EXP_STUDYPLAN' && name === 'COURSEID';
        const lookup = target === 'EXP_SYSTIMESLOT' || target === 'EXP_SYSTIMEWEEK';
        const missingParent = `NOT EXISTS (SELECT 1 FROM ${tableName(target)} p WHERE ${parent} = ${child})`;
        const brokenChild = lookup ? `${child} IS NOT NULL AND ${missingParent}`
            : `${child} IS NULL OR ${missingParent}`;
        return `SELECT ${index} AS RELATION_ID,
            CASE WHEN EXISTS (
                SELECT 1 FROM ${tableName(target)} p GROUP BY ${parent}
                HAVING COUNT(*) > 1 OR ${parent} IS NULL
            )${allowMissingCourse ? '' : ` OR EXISTS (
                SELECT 1 FROM ${tableName(table)} c WHERE ${brokenChild}
            )`} THEN 0 ELSE 1 END AS VERIFIED
            FROM DUAL`;
    });
    const { rows } = await connection.execute(checks.join('\nUNION ALL\n'), {}, { outFormat });
    return new Set(candidates.filter((relation, index) =>
        rows.some(row => row.RELATION_ID === index && row.VERIFIED === 1)).map(relationKey));
}

function identifier(name) {
    if (!/^[A-Z][A-Z0-9_$#]*$/.test(name)) {
        throw new AdvisorError('SCHEMA_UNVERIFIED', 'ชื่อ object ใน metadata ยังไม่รองรับ');
    }
    return `"${name}"`;
}

function schemaError(reason = 'metadata ตารางอ้างอิงไม่ครบหรือไม่สอดคล้องกัน') {
    return new AdvisorError('SCHEMA_UNVERIFIED',
        `ยังยืนยัน schema ของ Oracle ไม่ได้ — ${reason} กรุณารัน Backend/sql/ai-chat-metadata.sql เพื่อตรวจโครงสร้างจริง`, 503);
}

async function inspectAcademicSchema(connection, outFormat, { plan = true, offerings = true, structure = false } = {}) {
    const requiredTables = [...(plan ? PLAN_TABLES : ['EXP_COURSE']), ...(offerings ? ['EXP_CLASS'] : []),
        ...(structure ? STRUCTURE_TABLES : [])];
    const tables = offerings ? TABLES.filter(table => (plan || !PLAN_TABLES.includes(table) || table === 'EXP_COURSE')
        && (structure || !STRUCTURE_TABLES.includes(table))) : requiredTables;
    const binds = Object.fromEntries(tables.map((name, index) => [`table${index}`, name]));
    const placeholders = Object.keys(binds).map(key => `:${key}`).join(', ');
    const columnsResult = await connection.execute(`
        SELECT OWNER, TABLE_NAME, COLUMN_NAME, DATA_TYPE
        FROM ALL_TAB_COLUMNS
        WHERE OWNER = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
          AND TABLE_NAME IN (${placeholders})`, binds, { outFormat });
    const columns = columnsResult.rows;
    const column = (table, name) => columns.find(row => row.TABLE_NAME === table && row.COLUMN_NAME === name);
    const missingColumns = requiredTables.flatMap(table =>
        REQUIRED_COLUMNS[table].filter(name => !column(table, name))
            .map(name => `${table}.${name}`));
    if (missingColumns.length) {
        throw schemaError(`ไม่พบ column ใน current schema ตาม mapping ที่ใช้อยู่ ได้แก่ ${missingColumns.join(', ')} อาจเกี่ยวกับชื่อ column, owner หรือ synonym`);
    }
    const owner = columns[0].OWNER;
    const tableName = table => `${identifier(owner)}.${identifier(table)}`;
    if (!plan && !offerings) return { tableName };
    const relationsResult = await connection.execute(`
        SELECT fk.TABLE_NAME, fc.COLUMN_NAME, pk.TABLE_NAME AS REFERENCED_TABLE,
               pc.COLUMN_NAME AS REFERENCED_COLUMN,
               (SELECT COUNT(*) FROM ALL_CONS_COLUMNS cnt
                WHERE cnt.OWNER = fk.OWNER AND cnt.CONSTRAINT_NAME = fk.CONSTRAINT_NAME) AS KEY_COLUMNS
        FROM ALL_CONSTRAINTS fk
        JOIN ALL_CONS_COLUMNS fc ON fc.OWNER = fk.OWNER AND fc.CONSTRAINT_NAME = fk.CONSTRAINT_NAME
        JOIN ALL_CONSTRAINTS pk ON pk.OWNER = fk.R_OWNER AND pk.CONSTRAINT_NAME = fk.R_CONSTRAINT_NAME
        JOIN ALL_CONS_COLUMNS pc ON pc.OWNER = pk.OWNER AND pc.CONSTRAINT_NAME = pk.CONSTRAINT_NAME
                               AND pc.POSITION = fc.POSITION
        WHERE fk.OWNER = :owner AND pk.OWNER = :owner
          AND fk.CONSTRAINT_TYPE = 'R' AND fk.STATUS = 'ENABLED' AND fk.VALIDATED = 'VALIDATED'
          AND pk.STATUS = 'ENABLED' AND pk.VALIDATED = 'VALIDATED'
          AND fk.TABLE_NAME IN (${placeholders})`, { owner, ...binds }, { outFormat });
    const relations = relationsResult.rows.filter(row => Number(row.KEY_COLUMNS) === 1);
    const typeFamily = value => {
        if (/^(VARCHAR2|CHAR)$/.test(value)) return 'character';
        if (/^(NVARCHAR2|NCHAR)$/.test(value)) return 'national character';
        return value;
    };
    const hasDeclaredRelation = (table, name, target, targetColumn) => {
        const left = column(table, name)?.DATA_TYPE;
        const right = column(target, targetColumn)?.DATA_TYPE;
        return left && right && typeFamily(left) === typeFamily(right) && relations.some(row =>
            row.TABLE_NAME === table && row.COLUMN_NAME === name
            && row.REFERENCED_TABLE === target && row.REFERENCED_COLUMN === targetColumn);
    };
    const requiredRelations = [
        ...(plan ? PLAN_RELATIONS : []), ...(offerings ? [OFFERING_RELATION] : [])
    ];
    const exportCandidates = owner === 'AVSREG' ? [
        ...requiredRelations, ...(offerings ? [TIMETABLE_RELATION, ...EXPORT_LOOKUPS] : [])
    ].filter(([table, name, target, targetColumn]) =>
        column(table, name)?.DATA_TYPE === 'NUMBER' && column(target, targetColumn)?.DATA_TYPE === 'NUMBER'
        && !hasDeclaredRelation(table, name, target, targetColumn)) : [];
    const verifiedExport = await verifyExportRelations(connection, outFormat, tableName, exportCandidates);
    const hasRelation = (...relation) => hasDeclaredRelation(...relation) || verifiedExport.has(relationKey(relation));
    const missingRelations = requiredRelations.filter(args => !hasRelation(...args));
    if (missingRelations.length) {
        const expected = missingRelations.map(([table, column, target, targetColumn]) =>
            `${table}.${column} → ${target}.${targetColumn}`).join(', ');
        throw schemaError(`ไม่พบ foreign key ที่ ENABLED และ VALIDATED แบบคอลัมน์เดียวหรือไม่ผ่านการตรวจข้อมูล export สำหรับ ${expected}`);
    }
    if (!offerings) return { tableName, warnings: [] };

    const timetable = REQUIRED_COLUMNS.EXP_CLASSTIMETABLE.every(name => column('EXP_CLASSTIMETABLE', name))
        && hasRelation(...TIMETABLE_RELATION);
    const slotTables = timetable ? ['EXP_STYTIMESLOT', 'EXP_SYSTIMESLOT'].filter(table =>
        ['TIMESLOT', 'TIMEOF'].every(name => columns.some(row => row.TABLE_NAME === table && row.COLUMN_NAME === name))
        && hasRelation('EXP_CLASSTIMETABLE', 'TIMESLOTFROM', table, 'TIMESLOT')
        && hasRelation('EXP_CLASSTIMETABLE', 'TIMESLOTTO', table, 'TIMESLOT')) : [];
    const slotTable = slotTables.length === 1 ? slotTables[0] : null;
    const slotType = columns.find(row => row.TABLE_NAME === slotTable && row.COLUMN_NAME === 'TIMEOF')?.DATA_TYPE;
    const timeExpression = alias => {
        if (/^(DATE|TIMESTAMP)/.test(slotType)) return `TO_CHAR(${alias}.TIMEOF, 'HH24:MI')`;
        if (/^(VARCHAR2|NVARCHAR2|CHAR|NCHAR)$/.test(slotType)) return `TRIM(${alias}.TIMEOF)`;
        return 'NULL';
    };

    // Numeric weekday codes have no universal meaning. Read their referenced
    // dictionary instead of applying a guessed Sunday/Monday offset.
    const days = new Map();
    const declaredDay = relations.find(row => row.TABLE_NAME === 'EXP_CLASSTIMETABLE'
        && row.COLUMN_NAME === 'WEEKDAY' && WEEK_TABLES.includes(row.REFERENCED_TABLE)
        && hasRelation('EXP_CLASSTIMETABLE', 'WEEKDAY', row.REFERENCED_TABLE, row.REFERENCED_COLUMN));
    const exportDay = EXPORT_LOOKUPS[2];
    const dayTable = timetable && (declaredDay?.REFERENCED_TABLE || (hasRelation(...exportDay) && exportDay[2]));
    if (dayTable) {
        const dayKey = declaredDay?.REFERENCED_COLUMN || exportDay[3];
        const dictionary = await connection.execute(`SELECT * FROM ${tableName(dayTable)} FETCH FIRST 33 ROWS ONLY`, {}, { outFormat });
        if (dictionary.rows.length > 32) throw schemaError('ตารางอ้างอิงวันเรียนมีข้อมูลเกินขอบเขตที่รองรับ');
        for (const row of dictionary.rows) {
            const labels = new Set(Object.values(row).map(dayName).filter(Boolean));
            if (labels.size === 1) {
                const key = String(row[dayKey]);
                const label = [...labels][0];
                if (days.has(key) && days.get(key) !== label) throw schemaError();
                days.set(key, label);
            }
        }
    }

    return {
        tableName, timetable, slotTable, timeExpression,
        resolveDay: value => days.get(String(value)) || dayName(value),
        warnings: !timetable ? ['ยังยืนยันความสัมพันธ์ของข้อมูลตารางเรียนไม่ได้ จึงแสดงได้เฉพาะกลุ่มที่เปิดสอน'] : [
            ...(!slotTable ? ['ยังยืนยันตารางอ้างอิงเวลาเรียนไม่ได้ จึงไม่แปลงรหัส timeslot เป็นเวลา'] : []),
            ...(!days.size ? ['ยังยืนยันตารางอ้างอิงรหัสวันไม่ได้ จึงใช้ได้เฉพาะชื่อวันที่อ่านได้โดยตรง'] : [])
        ]
    };
}

module.exports = { inspectAcademicSchema };
