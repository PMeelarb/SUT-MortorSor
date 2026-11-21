// Academic data scope. EXP_LEVELID was checked read-only on 2026-11-21:
// 1 = ปริญญาตรี (Bachelor Degree). The product serves undergraduates only,
// so classes of other levels (โท/เอก/คลังหน่วยกิต/ทดสอบ) are excluded by default.
function parseLevelIds(value) {
    const ids = String(value ?? '1').split(',').map(item => item.trim()).filter(Boolean).map(Number);
    if (!ids.length || ids.some(id => !Number.isInteger(id) || id < 0)) {
        throw new Error('CLASS_LEVEL_IDS must be a comma-separated list of EXP_LEVELID integers');
    }
    return [...new Set(ids)];
}

const classLevelIds = () => parseLevelIds(process.env.CLASS_LEVEL_IDS);

module.exports = { parseLevelIds, classLevelIds };
