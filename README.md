# TELEMED_API (Telemed / Telepharma Integration Jobs)

โปรเจกต์นี้เป็นงาน **Node.js แบบ Job (Batch/Cron)** สำหรับเชื่อมต่อระบบ HIS (SQL Server) กับระบบ Telepharma (Telemedicine) โดยมีหน้าที่หลักคือ

1. ส่งข้อมูลนัดหมายไปยัง Telepharma (Register)
2. แก้ไขข้อมูลนัดหมาย (Update)
3. ตรวจสอบสถานะการยืนยันและสถานะการทำ Conference (Conference List)

ระบบถูกออกแบบให้รันบน **Linux Server ผ่าน Docker + crontab** เพื่อให้ทำงานอัตโนมัติทุกวันตามเวลาที่กำหนด

---

## โครงสร้างโปรเจกต์

```
TELEMED_API/
├─ src/
│  ├─ clients/
│  ├─ config/
│  ├─ jobs/
│  ├─ services/
│  └─ index.js
├─ logs/
├─ .env
├─ Dockerfile
├─ docker-compose.yml
├─ package.json
└─ package-lock.json
```

---

## อธิบายโครงสร้างใน `src/`

### 1) `src/jobs/` (Job ที่รันจริง)

โฟลเดอร์นี้เป็นหัวใจของระบบ ใช้สำหรับเก็บไฟล์ job ที่จะถูกรันด้วย cron หรือ docker compose

* `register.job.js`

  * ส่งข้อมูลนัดหมายไป Telepharma (POST register)
  * รับ `transaction_id` กลับมา และอัปเดตลง DB ฝั่งเรา

* `update.job.js`

  * แก้ไขข้อมูลนัดหมายผ่าน `transaction_id` (PUT update)
  * ใช้เมื่อมีการแก้ไขข้อมูลนัดหมายหลังจาก register แล้ว

* `conferenceList.job.js`

  * เรียก API conference-list (GET)
  * ตรวจสอบ 2 สถานะ

    * สถานะการยืนยัน Telemed (confirmation_contact_status)
    * สถานะการทำ Conference (status_active)
  * แปลงสถานะและอัปเดตลง DB ของเรา

> Job ทุกตัวจะทำงานแบบ sequential (ทีละ record) เพื่อความปลอดภัยและง่ายต่อการ debug

---

### 2) `src/services/` (Service สำหรับเรียก API ภายนอก)

โฟลเดอร์นี้ใช้เก็บฟังก์ชันที่ทำหน้าที่เรียก Telepharma API โดยเฉพาะ เช่น

* registerAppointment(payload)
* updateAppointment(transaction_id, payload)
* getConferenceList({ appointment_date, transaction_id })

การแยก service ออกมาช่วยให้ job ไม่ต้องจัดการเรื่อง HTTP โดยตรง และแก้ไข API ได้จากจุดเดียว

---

### 3) `src/clients/` (HTTP Client)

ใช้สำหรับกำหนด axios client กลาง เช่น

* baseURL ของ Telepharma
* header `hospitalkey`
* httpsAgent / timeout

service ทุกตัวจะเรียกผ่าน client นี้

---

### 4) `src/config/` (Config / Endpoint)

ใช้เก็บค่าคงที่ เช่น

* base URL
* path ของ endpoint (register / update / conference-list / cancel)
* config กลางที่ใช้ซ้ำหลายที่

---

### 5) `src/index.js`

ไฟล์รวมสำหรับอนาคต (เช่น เรียกหลาย job พร้อมกัน หรือทำเป็น CLI)

ปัจจุบัน job จะถูกรันโดยตรงจาก `src/jobs/*.job.js`

---

## Environment Variables (`.env`)

ไฟล์ `.env` จะอยู่ที่ root ของโปรเจกต์ และไม่ควร commit ขึ้น Git

ตัวอย่าง:

```env
DB_USER=...
DB_PASSWORD=...
DB_SERVER=...
DB_PORT=1433
DB_NAME=...

HOSPITAL_KEY=xxxx
TELEPHARMA_BASE_URL=https://telepharma.one.th/management/api
```

---

## การรันงานในเครื่อง Dev

ติดตั้ง dependency:

```bash
npm install
```

รันแต่ละ job:

```bash
npm run register
npm run update
npm run conference
```

---

## การรันด้วย Docker (แนะนำสำหรับ Server)

### Build Image

```bash
mkdir -p logs
docker compose build
```

### ทดสอบรันแต่ละ job

```bash
docker compose run --rm telemed-register
docker compose run --rm telemed-update
docker compose run --rm telemed-conference
```

---

## การตั้งเวลาอัตโนมัติด้วย crontab (Linux)

ตัวอย่างรันทุกวันเวลา 22:00

```bash
0 22 * * * cd /opt/telemed_api && docker compose run --rm telemed-register >> logs/register_$(date +\%F).log 2>&1 && docker compose run --rm telemed-update >> logs/update_$(date +\%F).log 2>&1 && docker compose run --rm telemed-conference >> logs/conference_$(date +\%F).log 2>&1
```

(แนะนำให้ใช้ `flock` เพื่อกันการรันซ้ำ)

---

## Workflow เมื่อแก้ไขโค้ด

1. แก้ไขโค้ดใน `src/`
2. ทดสอบในเครื่อง dev ด้วย `npm run ...`
3. commit และ push ขึ้น Git
4. บน server:

```bash
cd /opt/telemed_api
git pull
docker compose build
```

จากนั้นปล่อยให้ cron ทำงานตามเวลา

---

## หมายเหตุ

* ห้าม commit `.env` และ `node_modules`
* ตรวจสอบ log ในโฟลเดอร์ `logs/` เมื่อมีปัญหา
* ถ้า API ตอบ 400 ให้ตรวจ payload และ format วันที่/เวลา

---

เอกสารนี้จัดทำเพื่อใช้งานและดูแลระบบ TELEMED_API ในระยะยาว
