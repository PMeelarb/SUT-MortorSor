function linkedStudentId(user) {
    const id = user?.app_metadata?.student_id;
    return user?.id && !user.is_anonymous && typeof id === 'string' && /^[A-Z0-9-]{1,32}$/.test(id) ? id : null;
}

function studentSessionIdentity(user) {
    const linked = linkedStudentId(user);
    if (linked) return { userId: user.id, studentId: linked, reportedStudentId: linked, selfService: false };
    if (user?.is_anonymous || typeof user?.id !== 'string'
        || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(user.id)) return null;
    const registration = user.user_metadata?.student_profile;
    const reportedStudentId = registration?.reported_student_id;
    const text = value => typeof value === 'string' ? value.trim() : '';
    const registrationProfile = {
        first_name: text(registration?.first_name),
        last_name: text(registration?.last_name),
        faculty: text(registration?.faculty),
        major: text(registration?.major)
    };
    return {
        userId: user.id,
        studentId: 'U-' + user.id.replace(/-/g, '').toUpperCase(),
        reportedStudentId: typeof reportedStudentId === 'string' && /^[A-Z0-9-]{1,32}$/.test(reportedStudentId)
            ? reportedStudentId : '',
        registrationProfile: Object.values(registrationProfile).some(Boolean) ? registrationProfile : null,
        selfService: true
    };
}
