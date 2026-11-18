@echo off
title SUT MortorSor Server
color 0A
echo ==========================================
echo Starting Backend and Cloudflare Tunnel...
echo ==========================================

:: 1. เปิดหน้าต่างรันเซิร์ฟเวอร์หลังบ้าน (Node.js)
start cmd /k "cd Backend && node server.js"

:: 2. รันอุโมงค์ Cloudflare (ตัวนี้จะไม่บล็อก CORS แบบ Ngrok)
npx cloudflared tunnel --url http://localhost:3000