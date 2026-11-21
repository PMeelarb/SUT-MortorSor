// Conversation UI renders text only. Oracle facts and actions come from the Backend.
window.chatHistoryContext = [];
let aiChatPending = false;
let aiHistoryScope = localStorage.getItem('sut_student_id');
let aiPageUserId = null;
let aiConversationContext = {};
let aiConversationId = null;
let aiConversationVersion = 0;
let aiAuthUserId;
let aiWelcomeRequest = 0;
let defaultAIWelcome;

function syncAIConversation(authChanged = false) {
    // This legacy browser marker only clears local conversation state.
    // It never authenticates requests or leaves the browser.
    const owner = localStorage.getItem('sut_student_id');
    const pageUserId = typeof verifiedStudentSession === 'undefined' ? null : verifiedStudentSession?.userId ?? null;
    if (aiHistoryScope !== owner || aiPageUserId !== pageUserId || authChanged) {
        aiHistoryScope = owner;
        aiPageUserId = pageUserId;
        aiConversationVersion++;
        aiConversationContext = {};
        aiConversationId = null;
        window.chatHistoryContext = [];
        window.aiChatContext = { curriculumYear: null, academicYear: null };
        const history = document.getElementById('ai-chat-history');
        for (const bubble of Array.from(history?.children || [])) {
            if (bubble.className.startsWith('ai-chat-message ')) bubble.remove();
        }
        const welcome = document.getElementById('ai-welcome-text');
        if (welcome && defaultAIWelcome !== undefined) welcome.textContent = defaultAIWelcome;
    }
    return aiConversationVersion;
}

async function refreshAIWelcome() {
    const welcome = document.getElementById('ai-welcome-text');
    if (!welcome || typeof window.requestAIProfile !== 'function') return;
    defaultAIWelcome ??= welcome.textContent;
    const scope = syncAIConversation();
    const request = ++aiWelcomeRequest;
    welcome.textContent = defaultAIWelcome;
    try {
        if (window.aiProfileReady) await window.aiProfileReady;
        if (request !== aiWelcomeRequest || scope !== syncAIConversation()) return;
        const result = await window.requestAIProfile();
        if (request === aiWelcomeRequest && scope === syncAIConversation()) {
            welcome.textContent = result?.welcome || (result?.profileMessage
                ? `${defaultAIWelcome} ${result.profileMessage}` : defaultAIWelcome);
        }
    } catch {
        if (request === aiWelcomeRequest && scope === syncAIConversation()) {
            welcome.textContent = `${defaultAIWelcome} ติดต่อระบบ AI Advisor เพื่ออ่านโปรไฟล์ไม่สำเร็จครับ`;
        }
    }
}

window.addEventListener?.('storage', event => {
    if (event.key === 'sut_student_id' || event.key === null) {
        syncAIConversation();
        refreshAIWelcome();
    }
});
document.addEventListener?.('DOMContentLoaded', async () => {
    if (window.studentSessionReady && !await window.studentSessionReady) return;
    if (typeof supabaseClient === 'undefined' || !supabaseClient.auth?.onAuthStateChange) {
        refreshAIWelcome();
        return;
    }
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (!['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'].includes(event)) return;
        const userId = session?.user?.id ?? null;
        const changed = aiAuthUserId !== undefined && aiAuthUserId !== userId;
        aiAuthUserId = userId;
        if (changed) syncAIConversation(true);
        if (changed || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') setTimeout(refreshAIWelcome, 0);
    });
});

function sameAIFaculty(left, right) {
    const normalize = name => name.replace(/^สำนักวิชา\s*/, '').toLowerCase();
    return normalize(left) === normalize(right);
}

window.getAIChatContext = function(options = {}) {
    const stored = window.aiChatContext || {};
    const profileFaculty = String(window.aiAcademicProfile?.faculty || '').trim();
    const faculty = stored.faculty && (!profileFaculty || sameAIFaculty(profileFaculty, stored.faculty))
        ? stored.faculty : profileFaculty;
    const major = String(window.aiAcademicProfile?.major || stored.major || '').trim();
    const sameProgram = (!stored.faculty || stored.faculty === faculty) && (!stored.major || stored.major === major);
    const activeYear = document.querySelector('.year-tab.active')?.textContent.match(/\d+/)?.[0];
    const activeSemester = document.getElementById('semester-text')?.textContent.match(/\d+/)?.[0];
    return {
        faculty, major,
        curriculumYear: sameProgram ? stored.curriculumYear ?? null : null,
        // The planner's academic year is the shared target term for schedule actions.
        academicYear: (options.forSchedule && window.planTerm?.academicYear) || (sameProgram ? stored.academicYear ?? null : null),
        yearLevel: options.forSchedule
            ? Number(activeYear || window.currentYearLevel) || null
            : Number((sameProgram && stored.requestedYearLevel) || window.aiAcademicProfile?.yearLevel) || null,
        semester: Number(activeSemester || window.currentSemester) || null
    };
};

function appendAIChatMessage(text, isUser = false) {
    const history = document.getElementById('ai-chat-history');
    const bubble = document.createElement('div');
    bubble.className = isUser ? 'ai-chat-message advisor-user' : 'ai-chat-message advisor-reply';
    if (!isUser) {
        const heading = document.createElement('div');
        heading.className = 'advisor-reply-label';
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-robot';
        const label = document.createElement('span');
        label.textContent = ' SUT AI Advisor';
        heading.appendChild(icon);
        heading.appendChild(label);
        bubble.appendChild(heading);
    }
    const content = document.createElement('div');
    content.className = 'advisor-message-text';
    content.textContent = text;
    bubble.appendChild(content);
    history.appendChild(bubble);
    history.scrollTop = history.scrollHeight;
    return bubble;
}

function advisorDisclosure(title, className) {
    const details = document.createElement('details');
    details.className = className;
    const summary = document.createElement('summary');
    summary.textContent = title;
    details.appendChild(summary);
    return details;
}

function renderAdvisorCourses(bubble, details) {
    if (!details) return;
    const english = details.english;
    const text = (parent, tag, value) => {
        const element = document.createElement(tag);
        element.textContent = value;
        parent.appendChild(element);
    };
    if (details.text) {
        const structure = advisorDisclosure(english ? 'Curriculum details' : 'ดูโครงสร้างหลักสูตร', 'advisor-result-details');
        structure.open = Boolean(details.showAll);
        text(structure, 'p', details.text);
        bubble.appendChild(structure);
    }
    if (!Array.isArray(details.cards)) return;
    const weekday = { จันทร์: 'Mon', อังคาร: 'Tue', พุธ: 'Wed', พฤหัสบดี: 'Thu', ศุกร์: 'Fri', เสาร์: 'Sat', อาทิตย์: 'Sun' };
    const list = document.createElement('div');
    list.className = 'advisor-course-list';
    const addCourse = (parent, course) => {
        const card = document.createElement('div');
        card.className = 'advisor-course-card';
        text(card, 'strong', [course.code, course.name].filter(Boolean).join(' '));
        if (course.credits !== null && course.credits !== undefined) text(card, 'p', `${course.credits} ${english ? 'credits' : 'หน่วยกิต'}`);
        if (course.note) text(card, 'p', course.note);
        const groups = Array.isArray(course.groups) ? course.groups : [];
        const addGroup = (container, group) => {
            const times = group.meetings.map(({ day, start, end }) => day && start && end
                ? `${english ? weekday[day] || day : day} ${start}–${end}` : (english ? 'Time unavailable' : 'เวลาเรียนยังไม่ครบ')).join(', ');
            const source = group.reference ? ` · ${english ? 'Reference' : 'เวลาอ้างอิง'} ${group.sourceAcademicYear}/${group.sourceSemester}` : '';
            const section = group.section ? `${english ? 'Section' : 'กลุ่ม'} ${group.section}` : (english ? 'Section unavailable' : 'ยังไม่ทราบกลุ่ม');
            text(container, 'p', `${section}${times ? ` · ${times}` : ''}${source}`);
        };
        if (groups.length > 2 && !details.showAll) {
            addGroup(card, groups[0]);
            const all = advisorDisclosure(english ? `See all ${groups.length} sections` : `ดูทุกกลุ่มเรียน (${groups.length})`, 'advisor-result-details');
            groups.forEach(group => addGroup(all, group));
            card.appendChild(all);
        } else groups.forEach(group => addGroup(card, group));
        parent.appendChild(card);
    };
    const limit = details.showAll ? details.cards.length : 5;
    details.cards.slice(0, limit).forEach(course => addCourse(list, course));
    if (details.cards.length > limit) {
        const more = advisorDisclosure(english ? 'More courses' : 'ดูรายวิชาเพิ่มเติม', 'advisor-result-details');
        details.cards.slice(limit).forEach(course => addCourse(more, course));
        list.appendChild(more);
    }
    if (details.footer) text(list, 'p', details.footer);
    bubble.appendChild(list);
}

window.sendAIMessage = async function() {
    const input = document.getElementById('ai-msg-input');
    const history = document.getElementById('ai-chat-history');
    const message = input?.value.trim();
    if (!message || !history || aiChatPending) return;
    if (message.length > 2000) {
        window.showAppNotice('กรุณาส่งข้อความความยาวไม่เกิน 2,000 ตัวอักษร');
        return;
    }
    const scope = syncAIConversation();
    const scheduled = window.getAIChatContext({ forSchedule: true });
    const scheduleView = JSON.stringify(scheduled);
    // Snapshot history before displaying/recording the current user message.
    const priorHistory = window.chatHistoryContext.slice(-10).map(item => ({ ...item }));
    appendAIChatMessage(message, true);
    input.value = '';
    const loading = appendAIChatMessage('SUT AI Advisor กำลังตอบ…');
    aiChatPending = true;
    try {
        const plannerSource = window.getPlanSource?.();
        const result = await window.requestAIChat({
            message, context: aiConversationContext, history: priorHistory, selectedSemester: scheduled.semester, presentation: 'conversation',
            trackConversation: true, ...(aiConversationId ? { conversationId: aiConversationId } : {}),
            selectedCourseIds: typeof selectedCoursesData === 'undefined' ? [] : selectedCoursesData.map(course => course.code).filter(Boolean),
            ...(window.planTerm?.academicYear ? { selectedAcademicYear: window.planTerm.academicYear } : {}),
            ...(plannerSource ? { source: plannerSource } : {})
        });
        if (syncAIConversation() !== scope) return;
        if (typeof result.reply !== 'string' || !result.context) throw new Error('รูปแบบคำตอบจากระบบไม่ถูกต้อง');
        const unchangedView = JSON.stringify(window.getAIChatContext({ forSchedule: true })) === scheduleView;
        aiConversationContext = { ...(result.conversationContext || result.context) };
        aiConversationId = result.conversationId || null;
        if (!['personal_profile', 'personal_greeting'].includes(result.outcome)) {
            window.chatHistoryContext = [...priorHistory,
                { role: 'user', content: message }, { role: 'assistant', content: result.reply }].slice(-10);
        }
        const active = window.getAIChatContext({ forSchedule: true });
        const matchesView = unchangedView && result.context.yearLevel === active.yearLevel
            && result.context.semester === active.semester
            && result.context.faculty && result.context.major
            && (!active.faculty || sameAIFaculty(result.context.faculty, active.faculty))
            && (!active.major || result.context.major === active.major);
        if (matchesView) {
            window.aiChatContext = { ...result.context };
        }
        const bubble = appendAIChatMessage(result.reply);
        renderAdvisorCourses(bubble, result.academicDetails);
        if (Array.isArray(result.sources) && result.sources.length) {
            const sources = advisorDisclosure(result.academicDetails?.english ? 'Sources' : 'แหล่งข้อมูล', 'advisor-sources');
            const labels = document.createElement('p');
            labels.textContent = result.sources.map(source => source.label).join(' | ');
            sources.appendChild(labels);
            bubble.appendChild(sources);
        }
        if (matchesView && Array.isArray(result.actions) && result.actions.length) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'primary-button advisor-course-button';
            button.textContent = 'เพิ่มวิชาเหล่านี้ลงตาราง';
            const replyContext = { ...result.context };
            const actions = result.actions.map(action => ({ ...action }));
            const actionSource = result.timetableSource;
            button.addEventListener('click', async () => {
                button.disabled = true;
                const label = button.textContent;
                button.textContent = 'กำลังตรวจกลุ่มเรียน…';
                const added = await window.applyAICoursesList(actions, replyContext, actionSource)
                    && (typeof window.saveSchedule !== 'function' || await window.saveSchedule() !== false);
                button.disabled = added;
                button.textContent = added ? 'เพิ่มลงตารางแล้ว' : label;
            });
            bubble.appendChild(button);
        }
        const planReply = Array.isArray(result.sources) && result.sources.some(source => source?.id === 'oracle-plan')
            && ['grounded', 'plan_partial'].includes(result.outcome)
            && !result.scheduleOptions?.skipPlanAction
            && !(matchesView && Array.isArray(result.actions) && result.actions.length)
            && ['faculty', 'major', 'curriculumYear', 'yearLevel', 'semester'].every(name => result.context[name]);
        if (planReply && typeof window.scheduleAIPlan === 'function') {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'primary-button advisor-course-button';
            button.textContent = `จัดลงตาราง ชั้นปี ${result.context.yearLevel} เทอม ${result.context.semester}`;
            const planContext = { ...result.context };
            const planOptions = { source: result.timetableSource, excludeDays: result.scheduleOptions?.excludeDays || [] };
            button.addEventListener('click', async () => {
                button.disabled = true;
                const label = button.textContent;
                button.textContent = 'กำลังค้นแผนและกลุ่มเรียน…';
                const added = await window.scheduleAIPlan(planContext, planOptions);
                button.disabled = added;
                button.textContent = added ? 'จัดลงตารางแล้ว' : label;
            });
            bubble.appendChild(button);
        }
    } catch (error) {
        if (syncAIConversation() === scope) appendAIChatMessage(error.message || 'เชื่อมต่อระบบ AI ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
        loading.remove();
        aiChatPending = false;
        history.scrollTop = history.scrollHeight;
    }
};
