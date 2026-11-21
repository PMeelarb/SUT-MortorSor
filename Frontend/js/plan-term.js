// Shared planner term: target academic year (semester comes from the existing
// term arrows) and where meeting times may come from. Course search, the
// automatic planner, AI Chat and the timetable all read this one state.
(function () {
    const STORAGE_KEY = 'mortorsor_plan_term';
    const state = { academicYear: null, mode: 'simulate', sourceAcademicYear: null, sourceSemester: null, terms: [], loaded: false };
    window.planTerm = state;

    const semesterNow = () => Number(document.getElementById('semester-text')?.textContent.match(/\d+/)?.[0])
        || Number(window.currentSemester) || null;
    const published = (year, semester) => state.terms.some(term => term.academicYear === year && term.semester === semester && term.classes > 0);

    window.getPlanSource = function() {
        const simulate = state.mode === 'simulate';
        return { mode: state.mode, sourceAcademicYear: simulate ? state.sourceAcademicYear : null,
            sourceSemester: simulate ? state.sourceSemester : null };
    };

    function remember() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ academicYear: state.academicYear, mode: state.mode,
                sourceAcademicYear: state.sourceAcademicYear, sourceSemester: state.sourceSemester }));
        } catch { /* Per-viewer convenience only. */ }
    }

    function recall() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || {};
        } catch {
            return {};
        }
    }

    function notify() {
        remember();
        renderSummary();
        window.refreshPlanNotice?.();
        document.dispatchEvent(new CustomEvent('planterm:change', { detail: { ...window.getPlanSource(), academicYear: state.academicYear } }));
    }

    window.setPlanAcademicYear = function(year) {
        const value = Number(year);
        if (!Number.isInteger(value) || value < 1900 || value > 3000 || value === state.academicYear) return;
        state.academicYear = value;
        const select = document.getElementById('plan-academic-year');
        if (select && ![...select.options].some(option => Number(option.value) === value)) select.add(new Option(String(value), String(value)));
        if (select) select.value = String(value);
        notify();
    };

    function option(value, label) {
        const element = document.createElement('option');
        element.value = value;
        element.textContent = label;
        return element;
    }

    function field(labelText, control) {
        const label = document.createElement('label');
        label.className = 'plan-term-field';
        const caption = document.createElement('span');
        caption.textContent = labelText;
        label.append(caption, control);
        return label;
    }

    function renderSummary() {
        const summary = document.getElementById('plan-term-summary');
        const sourceRow = document.getElementById('plan-source-fields');
        if (sourceRow) sourceRow.hidden = state.mode !== 'simulate';
        if (!summary) return;
        const semester = semesterNow();
        const lines = [];
        if (!state.academicYear || !semester) {
            lines.push(state.loaded ? 'เลือกปีการศึกษาที่ต้องการจัดตาราง' : 'กำลังโหลดปีการศึกษาจาก Oracle…');
        } else {
            lines.push(`จัดตารางสำหรับปีการศึกษา ${state.academicYear} เทอม ${semester}`);
            if (state.loaded && !published(state.academicYear, semester)) lines.push(`⚠️ ปีการศึกษา ${state.academicYear} เทอม ${semester} ยังไม่มีตารางสอนจริงใน Oracle`);
            if (state.mode === 'actual') {
                lines.push('ใช้เฉพาะข้อมูลเปิดสอนจริง วิชาที่ไม่มีเวลาจะแสดงว่าไม่มีข้อมูล');
            } else {
                const sourceSemester = state.sourceSemester || semester;
                const from = state.sourceAcademicYear
                    ? `ปี ${state.sourceAcademicYear} เทอม ${sourceSemester}`
                    : `ปีก่อนหน้าที่ใกล้ที่สุด เทอม ${sourceSemester}`;
                lines.push(`ใช้ข้อมูลจริงก่อน วิชาที่ยังไม่มีเวลาใช้เวลาจาก${from} เฉพาะวิชาที่พบข้อมูลย้อนหลังจริง`);
                if (sourceSemester !== semester) lines.push(`⚠️ ใช้เวลาจากต่างเทอม (เทอม ${sourceSemester}) ตารางสอนอาจต่างกันมาก`);
                lines.push('ข้อมูลจำลอง ไม่ใช่กำหนดการเปิดสอนที่ยืนยันแล้ว และใช้ลงทะเบียนจริงไม่ได้');
            }
        }
        summary.replaceChildren(...lines.map(text => {
            const line = document.createElement('div');
            line.textContent = text;
            return line;
        }));
    }

    function renderControls() {
        const host = document.getElementById('plan-term-controls');
        if (!host) return;
        const years = [...new Set(state.terms.map(term => term.academicYear))].sort((a, b) => a - b);
        const latest = years.at(-1);
        const targetYears = latest ? [...years, latest + 1] : [];

        const yearSelect = document.createElement('select');
        yearSelect.id = 'plan-academic-year';
        for (const year of targetYears) {
            yearSelect.append(option(String(year), year > latest ? `${year} (ยังไม่มีข้อมูลในระบบ)` : String(year)));
        }
        if (state.academicYear && !targetYears.includes(state.academicYear)) yearSelect.append(option(String(state.academicYear), String(state.academicYear)));
        yearSelect.value = state.academicYear ? String(state.academicYear) : '';
        yearSelect.addEventListener('change', () => window.setPlanAcademicYear(yearSelect.value));

        const modes = document.createElement('div');
        modes.className = 'plan-term-modes';
        modes.setAttribute('role', 'radiogroup');
        modes.setAttribute('aria-label', 'ประเภทข้อมูลเวลาเรียน');
        for (const [value, text] of [['actual', 'ข้อมูลเปิดสอนจริงเท่านั้น'], ['simulate', 'ใช้ข้อมูลย้อนหลังสำหรับจำลอง']]) {
            const label = document.createElement('label');
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'plan-time-mode';
            radio.value = value;
            radio.checked = state.mode === value;
            radio.addEventListener('change', () => {
                state.mode = value;
                notify();
            });
            const caption = document.createElement('span');
            caption.textContent = text;
            label.append(radio, caption);
            modes.append(label);
        }

        const sourceYear = document.createElement('select');
        sourceYear.id = 'plan-source-year';
        sourceYear.append(option('', 'อัตโนมัติ (ปีก่อนหน้าที่ใกล้ที่สุด)'));
        for (const year of years) sourceYear.append(option(String(year), String(year)));
        sourceYear.value = state.sourceAcademicYear ? String(state.sourceAcademicYear) : '';
        sourceYear.addEventListener('change', () => {
            state.sourceAcademicYear = sourceYear.value ? Number(sourceYear.value) : null;
            notify();
        });
        const sourceSemester = document.createElement('select');
        sourceSemester.id = 'plan-source-semester';
        sourceSemester.append(option('', 'เทอมเดียวกับที่จัดตาราง'));
        for (const semester of [1, 2, 3]) sourceSemester.append(option(String(semester), `เทอม ${semester}`));
        sourceSemester.value = state.sourceSemester ? String(state.sourceSemester) : '';
        sourceSemester.addEventListener('change', () => {
            state.sourceSemester = sourceSemester.value ? Number(sourceSemester.value) : null;
            notify();
        });

        const title = document.createElement('div');
        title.className = 'plan-term-title';
        title.textContent = 'เลือกข้อมูลสำหรับจัดตารางเรียน';
        const target = document.createElement('div');
        target.className = 'plan-term-row';
        target.append(field('ปีการศึกษาเป้าหมาย', yearSelect));
        const hint = document.createElement('p');
        hint.className = 'plan-term-hint';
        hint.textContent = 'ภาคเรียนเป้าหมายเปลี่ยนได้ที่ปุ่มเลือกเทอมด้านบน';
        const sources = document.createElement('div');
        sources.className = 'plan-term-row';
        sources.id = 'plan-source-fields';
        sources.append(field('ปีการศึกษาต้นทางของเวลาเรียน', sourceYear), field('ภาคเรียนต้นทาง', sourceSemester));
        const summary = document.createElement('div');
        summary.id = 'plan-term-summary';
        summary.className = 'plan-term-summary';
        summary.setAttribute('role', 'status');
        host.replaceChildren(title, target, hint, modes, sources, summary);
        renderSummary();
    }

    async function loadTerms(profileReady) {
        const host = document.getElementById('plan-term-controls');
        try {
            const response = await fetch(`${window.aiChatConfig.apiBaseUrl.replace(/\/$/, '')}/api/terms`);
            const result = await response.json().catch(() => null);
            if (!response.ok || result?.status !== 'success' || !Array.isArray(result.terms)) {
                throw new Error(result?.error || 'โหลดปีการศึกษาจาก Oracle ไม่สำเร็จ');
            }
            if (!await profileReady) return;
            state.terms = result.terms;
            state.loaded = true;
            const saved = recall();
            const years = state.terms.map(term => term.academicYear);
            state.academicYear = Number(saved.academicYear) || (years.length ? Math.max(...years) : null);
            state.mode = saved.mode === 'actual' ? 'actual' : 'simulate';
            state.sourceAcademicYear = Number(saved.sourceAcademicYear) || null;
            state.sourceSemester = Number(saved.sourceSemester) || null;
            renderControls();
            notify();
        } catch (error) {
            if (host && await profileReady.catch(() => false)) {
                const message = document.createElement('div');
                message.className = 'plan-term-summary';
                message.setAttribute('role', 'alert');
                message.textContent = `${error.message} — ช่องค้นหารายวิชาจะยังไม่แสดงกลุ่มเรียน`;
                host.replaceChildren(message);
            }
        }
    }

    // Banner for draft rows: simulated times, missing times, and a real timetable published since.
    window.refreshPlanNotice = function() {
        const notice = document.getElementById('plan-sim-notice');
        if (!notice || typeof selectedCoursesData === 'undefined') return;
        const simulated = selectedCoursesData.filter(row => row.reference === true);
        const noTime = new Set(selectedCoursesData.filter(row => row.no_time).map(row => row.code.split(' (G.')[0]));
        const lines = [];
        const actions = [];
        if (simulated.length) {
            const sources = [...new Set(simulated.map(row => `ปี ${row.sourceAcademicYear} เทอม ${row.sourceSemester}`))];
            const codes = new Set(simulated.map(row => row.courseCode || row.code.split(' (G.')[0]));
            lines.push(`ตารางนี้มีวิชาจำลอง ${codes.size} วิชา ใช้เวลาอ้างอิงจาก ${sources.join(', ')} ยังไม่ใช่ตารางลงทะเบียนจริง`);
            const targetYear = Number(simulated[0].academicYear);
            const semester = semesterNow();
            if (state.loaded && published(targetYear, semester)) {
                lines.push(`ปีการศึกษา ${targetYear} เทอม ${semester} มีตารางสอนจริงใน Oracle แล้ว ควรลบวิชาจำลองแล้วจัดใหม่จากข้อมูลจริง`);
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'plan-notice-button';
                button.textContent = 'ลบวิชาจำลองออก';
                button.addEventListener('click', async () => {
                    if (!await window.confirmAppAction(`ลบวิชาจำลอง ${codes.size} วิชาออกจากตารางเทอมนี้?`)) return;
                    if (semester !== semesterNow() || !simulated.every(row => selectedCoursesData.includes(row))) return;
                    window.removeCourseFromList(simulated.map(row => row.id).join(','));
                });
                actions.push(button);
            }
        }
        if (noTime.size) lines.push(`มี ${noTime.size} วิชาที่ไม่มีเวลาเรียน จึงตรวจเวลาชนกันได้ไม่ครบถ้วน`);
        notice.hidden = !lines.length;
        notice.replaceChildren(...lines.map(text => {
            const line = document.createElement('div');
            line.textContent = text;
            return line;
        }), ...actions);
    };

    document.addEventListener('DOMContentLoaded', async () => {
        // initialization.js sets studentSessionReady in a later DOMContentLoaded listener.
        await new Promise(resolve => setTimeout(resolve, 0));
        const profileReady = window.studentSessionReady;
        if (!profileReady || !await (window.studentAuthReady || profileReady)) return;
        renderControls();
        const semesterText = document.getElementById('semester-text');
        if (semesterText && typeof MutationObserver !== 'undefined') {
            new MutationObserver(() => notify()).observe(semesterText, { childList: true, characterData: true, subtree: true });
        }
        await loadTerms(profileReady);
    });
})();
