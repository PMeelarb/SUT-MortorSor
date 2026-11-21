const classColors = ['#FF4C4C', '#8E44AD', '#16A085', '#F39C12', '#E67E22', '#2980B9'];
const courseColorMap = {};

// ฟังก์ชันจัดรูปแบบรหัสวิชาให้อ่านง่าย (เช่น IST301101 -> IST30 1101)
window.formatCourseCodeDisplay = function(code) {
    if (!code) return "";
    let cleanCode = code.replace(/\s+/g, '').toUpperCase();
    // เอาสัญลักษณ์ ^ และ $ ออก เพื่อให้จับคู่เว้นวรรคได้แม้จะมีคำว่า (G.1) ต่อท้าย
    return cleanCode.replace(/([A-Z]{3}\d{2})(\d{4})/, '$1 $2').replace(/\(G\./, ' (G.');
};

// ==========================================
// 1. เชื่อมต่อฐานข้อมูล Supabase 
// ==========================================
const { url: supabaseUrl, publishableKey: supabaseKey } = window.sutSupabaseConfig || {};
const supabaseClient = supabaseUrl && supabaseKey && window.supabase
    ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;


let selectedMajor = "";

let selectedCourseIds = []; 
let allCourses = [];      
let masterCourses = [];   
let selectedCoursesData = []; 
let scheduleCache = {}; 

// AI years are explicit context. Neither year is inferred from student IDs.
window.aiChatConfig = Object.assign({
    apiBaseUrl: 'http://localhost:3000'
}, window.aiChatConfig);
window.aiChatContext = { curriculumYear: null, academicYear: null };
window.aiAcademicProfile = { faculty: '', major: '' };

