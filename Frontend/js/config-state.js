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
const supabaseUrl = 'https://wgeameqajwbvnvzcnxwm.supabase.co';
const supabaseKey = 'sb_publishable_-boyi5cXgE9MRC4v261MnQ_j4DCiZ3Q';
const supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);


let selectedMajor = "";

let selectedCourseIds = []; 
let allCourses = [];      
let masterCourses = [];   
let selectedCoursesData = []; 
let scheduleCache = {}; 

