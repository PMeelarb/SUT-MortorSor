// Shared feedback for the planner and the authentication page.
(() => {
    let confirmationQueue = Promise.resolve();
    let toastRegion;

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    window.showAppNotice = function(message, { title = 'แจ้งเตือน', tone = 'warning' } = {}) {
        if (!toastRegion) {
            toastRegion = element('div', 'sut-toast-region');
            toastRegion.setAttribute('aria-live', 'polite');
            document.body.appendChild(toastRegion);
        }
        const toast = element('div', 'sut-toast');
        toast.dataset.tone = tone;
        const content = element('div');
        content.append(element('strong', '', title), element('p', '', message));
        const dismiss = element('button', 'sut-toast-close', '×');
        dismiss.type = 'button';
        dismiss.setAttribute('aria-label', 'ปิดข้อความแจ้งเตือน');
        const remove = () => toast.remove();
        dismiss.addEventListener('click', remove);
        toast.append(content, dismiss);
        toastRegion.appendChild(toast);
        if (tone === 'success') setTimeout(remove, 5500);
        while (toastRegion.children.length > 3) toastRegion.firstElementChild.remove();
    };

    function showDialog({ title, message, confirmText, tone = 'confirm', choices, initialValue }) {
        return new Promise(resolve => {
            const previousFocus = document.activeElement;
            const dialog = element('dialog', 'sut-dialog');
            dialog.dataset.tone = tone;
            dialog.setAttribute('aria-labelledby', 'sut-dialog-title');
            const heading = element('h2', '', title);
            heading.id = 'sut-dialog-title';
            dialog.appendChild(heading);
            if (message) dialog.appendChild(element('p', 'sut-dialog-message', message));
            let select;
            if (choices) {
                select = element('select', 'sut-dialog-select');
                select.setAttribute('aria-label', title);
                for (const choice of choices) {
                    const option = element('option', '', choice.label);
                    option.value = String(choice.value);
                    select.appendChild(option);
                }
                select.value = String(initialValue);
                dialog.appendChild(select);
            }
            const actions = element('div', 'sut-dialog-actions');
            const cancel = element('button', 'sut-dialog-cancel', 'ยกเลิก');
            const confirm = element('button', 'sut-dialog-confirm', confirmText);
            cancel.type = confirm.type = 'button';
            cancel.addEventListener('click', () => dialog.close());
            confirm.addEventListener('click', () => dialog.close('confirmed'));
            actions.append(cancel, confirm);
            dialog.appendChild(actions);
            dialog.addEventListener('close', () => {
                const result = dialog.returnValue === 'confirmed' ? (select ? select.value : true) : null;
                dialog.remove();
                if (previousFocus?.isConnected && !previousFocus.disabled) previousFocus.focus({ preventScroll: true });
                resolve(result);
            }, { once: true });
            document.body.appendChild(dialog);
            dialog.showModal();
            (select || cancel).focus();
        });
    }

    function queueDialog(options) {
        const opened = confirmationQueue.then(() => showDialog(options));
        confirmationQueue = opened.catch(() => {});
        return opened;
    }

    window.confirmAppAction = async (message, { title = 'ยืนยันการดำเนินการ', confirmText = 'ยืนยัน', tone } = {}) =>
        Boolean(await queueDialog({ title, message, confirmText, tone }));
    window.chooseAppOption = (title, choices, initialValue) => queueDialog({ title, choices, initialValue, confirmText: 'เลือก' });

    // A submit can dispatch several invalid events before control returns to the page.
    let reportingInvalid = false;
    document.addEventListener('invalid', event => {
        event.preventDefault();
        if (reportingInvalid) return;
        reportingInvalid = true;
        queueMicrotask(() => { reportingInvalid = false; });
        event.target.focus();
        window.showAppNotice(event.target.validationMessage, { title: 'ตรวจข้อมูลในแบบฟอร์ม' });
    }, true);
})();
