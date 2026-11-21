const PRESENTATION_PROMPT = `คุณเป็นที่ปรึกษาวางแผนการเรียนที่คุยเป็นกันเองกับนักศึกษามหาวิทยาลัย
เลือกวิธีเปิดคำตอบที่ตรงกับสิ่งที่นักศึกษาขอ โดยใช้เฉพาะตัวเลือกใน options
overview เหมาะกับคำถามใหม่, continue เหมาะกับการคุยต่อ, criteria เหมาะกับการถามว่าทำไมถึงเสนอรายการนี้
ตอบ JSON {"approach":"..."} เท่านั้น ห้ามเพิ่มข้อความ รายวิชา กลุ่มเรียน เวลา หรือเหตุผลที่ไม่มีหลักฐาน`;

async function presentAcademic(complete, context, view, { english, followUp, rationale = false, showAll }) {
    const term = english ? `year ${context.yearLevel}, term ${context.semester}` : `ปี ${context.yearLevel} เทอม ${context.semester}`;
    const plan = view.kind === 'plan';
    const target = context.academicYear && context.semester ? `${context.academicYear}/${context.semester}` : '';
    const real = view.cards.some(card => card.groups.some(group => !group.reference));
    const historical = view.cards.some(card => card.groups.some(group => group.reference));
    const hasSections = real || historical;
    const overview = plan
        ? (english ? `Here’s what your curriculum lists for ${term}.` : `ตามแผนหลักสูตร ${term} มีวิชาเหล่านี้ครับ`)
        : view.label || (hasSections ? (english ? `Here are the sections I found for ${target}.` : `กลุ่มเรียนที่พบสำหรับปีการศึกษา ${target} อยู่ด้านล่างครับ`)
            : (english ? `I couldn’t find any matching sections${target ? ` for ${target}` : ''}.` : `ยังไม่พบกลุ่มเรียนที่ตรงเงื่อนไข${target ? ` สำหรับปีการศึกษา ${target}` : ''}ครับ`));
    const leads = { overview };
    if (followUp && plan) leads.continue = english ? `For ${term}, these are the courses in the plan.` : `ส่วน${term} ตามแผนมีวิชาเหล่านี้ครับ`;
    if (followUp && hasSections && view.reason) leads.continue = `${view.reason} ${overview}`;
    if (rationale && view.reason && hasSections) leads.criteria = view.reason;
    let lead = leads.continue || overview;
    let presentationStatus = 'ready';
    try {
        const options = Object.keys(leads);
        if (options.length > 1) {
            const choice = JSON.parse(await complete([
                { role: 'system', content: PRESENTATION_PROMPT },
                { role: 'user', content: JSON.stringify({ options, followUp, rationale }) }
            ]));
            if (!options.includes(choice?.approach) || Object.keys(choice).length !== 1) throw new Error('INVALID_APPROACH');
            lead = leads[choice.approach];
        }
    } catch {
        presentationStatus = 'fallback';
    }
    const notes = [...view.notes];
    if (view.reason && !lead.includes(view.reason) && hasSections) notes.push(view.reason);
    if (historical) notes.push(english
        ? 'Reference times are for planning only. Each section shows its original term.'
        : 'กลุ่มเวลาอ้างอิงใช้จำลองตารางครับ ปีต้นทางระบุไว้ที่แต่ละกลุ่ม');
    return { reply: [lead, ...notes].join('\n'), academicDetails: { cards: view.cards, footer: view.footer, showAll, english }, presentationStatus };
}

function courseCard(course, groups = [], note = '') {
    return {
        code: course.courseCode, name: course.courseName || course.courseNameEng || '', credits: course.credits ?? null, note,
        groups: groups.map(group => ({ section: group.section, meetings: group.meetings.map(({ day, start, end }) => ({ day, start, end })),
            ...(group.reference ? { reference: true, sourceAcademicYear: group.sourceAcademicYear, sourceSemester: group.sourceSemester } : {}) }))
    };
}

module.exports = { courseCard, presentAcademic };
