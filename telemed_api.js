// telemed_api.js
require('dotenv').config();
const sql = require('mssql');
const axios = require('axios');
const https = require('https');

// ===== 1. ตั้งค่า DB =====
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME,
  options: {
    encrypt: false,              // ใน network ภายใน ใช้ false ได้
    trustServerCertificate: true // ถ้าไม่มี cert
  }
};

// ===== 2. ฟังก์ชันยิง API (แทน SendDMHT ใน PHP) =====
async function sendDMHT(listTarget) {
  const url = 'https://uat-hpd-vhv.one.th/management/api/telemed/appointments';

  const httpsAgent = new https.Agent({
    rejectUnauthorized: false // เทียบเท่า CURLOPT_SSL_VERIFYPEER = false
  });

  const res = await axios.post(url, listTarget, {
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      Accept: 'application/json',
      hospitalkey: process.env.HOSPITAL_KEY
    },
    httpsAgent
  });

  return res.data; // เทียบกับ $temp_data = json_decode($resp, true);
}

// ===== 3. main script =====
async function main() {
  let pool;

  const resultObj = { result: 0 }; // เทียบกับ $arr['result']

  try {
    // 3.1 connect DB
    pool = await sql.connect(dbConfig);

    // 3.2 query ดึงข้อมูล (เอา query จาก PHP มาแปะตรงนี้)
    const query = `
      SELECT HNAPPMNT.HN
            ,PATIENT_REF.REF as patient_cid
            ,PYREXT.IDCARD as doctor_cid
            ,case when WORKPERMITNO is not null then 
                (
                    case when PYREXT.SEX = '1' then 'นพ.'
                        when PYREXT.SEX = '2' then 'พญ.'
                        else dbo.GetSSBName(SYSCONFIG.THAINAME)
                        end
                )
                else dbo.GetSSBName(SYSCONFIG.THAINAME) end as doctor_title 
            ,dbo.GetSSBName(PYREXT.FIRSTTHAINAME) as doctor_firstname
            ,dbo.GetSSBName(PYREXT.LASTTHAINAME) as doctor_lastname
            ,dbo.GetTitle(HNAPPMNT.HN) as account_title
            ,dbo.GetSSBName(PATIENT_NAME.FIRSTNAME) as first_name
            ,dbo.GetSSBName(PATIENT_NAME.LASTNAME) as last_name
            ,replace(convert(varchar, PATIENT_INFO.BIRTHDATETIME, 111), '/', '-') as birth_date
            ,PATIENT_ADDRESS.TEL as phone_number
            ,replace(convert(varchar, APPOINTMENTDATETIME, 111), '/', '-') as appointment_date
            ,ClinicName as hospital_department_name
            ,CONVERT(varchar, APPOINTMENTDATETIME, 108) as time_start
            ,CONVERT(varchar,DATEADD(MINUTE, NOMINUTESALLOWANCELATE, CONVERT(time,APPOINTMENTDATETIME)),108) as time_finish
            ,dbo.Province(HNAPPMNT.HN) as province
            ,dbo.Amphoe(HNAPPMNT.HN) as district
            ,dbo.Tambon(HNAPPMNT.HN) as sub_district
            ,PATIENT_ADDRESS.MOO as moo
            ,PATIENT_ADDRESS.POSTALCODE as zip_code
            ,HNAPPMNT.APPOINTMENTNO
        FROM HNAPPMNT
        JOIN ClinicName ON APPOINTMENTWITHCLINIC = CODE
        join PATIENT_REF ON HNAPPMNT.HN = PATIENT_REF.HN and PATIENT_REF.REFTYPE = '01'
        join PYREXT ON APPOINTMENTWITHDOCTOR = PYREXT.PAYROLLNO 
        join PATIENT_NAME ON HNAPPMNT.HN = PATIENT_NAME.HN 
        join PATIENT_INFO ON HNAPPMNT.HN = PATIENT_INFO.HN 
        join PATIENT_ADDRESS ON HNAPPMNT.HN = PATIENT_ADDRESS.HN and PATIENT_ADDRESS.SUFFIX = '1'
        LEFT JOIN SYSCONFIG ON CTRLCODE = '10121' and PYREXT.InitialNameCode = SYSCONFIG.CODE
        WHERE CONVERT(date, HNAPPMNT.MAKEDATETIME)  = CONVERT(date,getdate())
        and PROCEDURECODE = 'T'
    `;

    const rs = await pool.request().query(query);

    for (const row of rs.recordset) {
      const listTarget = {
        hn: row.HN,
        vn: 'False',
        patient_cid: row.patient_cid,
        doctor_cid: row.doctor_cid,
        doctor_title: '',
        doctor_firstname: row.doctor_firstname,
        doctor_lastname: row.doctor_lastname,
        account_title: row.account_title,
        first_name: row.first_name,
        last_name: row.last_name,
        birth_date: row.birth_date,
        phone_number: row.phone_number.replace(/-/g, ''),
        phone_number_other: '',
        appointment_date: row.appointment_date,
        appointment_type_name: 'Telemedicine',
        hospital_code: '10661',
        hospital_department_name: row.hospital_department_name,
        hospital_name: 'โรงพยาบาลสระบุรี',
        hospital_room_name: 'Telemedicine',
        time_start: row.time_start,
        time_finish: row.time_finish,
        require_type: 'patient',
        address_detail:{
            province: row.province,
            district: row.district,
            sub_district: row.sub_district,
            road: '',
            moo: row.moo,
            house_no: '',
            zip_code: row.zip_code,
            landmark: '',
            lat: '',
            lng: ''
          },
        address_detail_health_rider: {
            province: '',
            district: '',
            sub_district: '',
            road: '',
            moo: '',
            house_no: '',
            zip_code: '',
            landmark: '',
            lat: '',
            lng: ''
          }
        
      };

      // ===== 3.3 ยิง API =====
      let tempData;
      try {
        tempData = await sendDMHT(listTarget);
      } catch (e) {
        console.error('เรียก API error:', e.message);
        continue; // ข้ามแถวนี้ไปก่อน
      }

      // ===== 3.4 log ตาม status =====
    if (tempData.status === 'success') {
        const status = tempData.status;
        const message = tempData.message;

        // ✅ ดึงค่า transaction_id จาก result แบบตรง ๆ
        const transaction_id = tempData.result && tempData.result.transaction_id
            ? tempData.result.transaction_id
            : null;

        const insertLog200 = `
            UPDATE HNAPPMNT
            SET transaction_id = @transaction_id
            WHERE APPOINTMENTNO = @APPOINTMENTNO
        `;

        await pool.request()
            .input('transaction_id', sql.VarChar, transaction_id)
            .input('APPOINTMENTNO', sql.VarChar, row.APPOINTMENTNO)
            .query(insertLog200);

        resultObj.result = 1;
    } else if (tempData.status === 'fail') {
        const status = tempData.status;
        const message = tempData.message;

        const insertLog400 = `
          UPDATE HNAPPMNT SET transaction_id = @message
          WHERE APPOINTMENTNO = @APPOINTMENTNO
        `;

        await pool.request()
          .input('message', sql.VarChar, message)
          .input('APPOINTMENTNO', sql.VarChar, row.APPOINTMENTNO)
          .query(insertLog400);

        resultObj.result = 0;
      }
    }

    console.log(JSON.stringify(resultObj));
  } catch (err) {
    console.error('เกิดข้อผิดพลาดหลัก:', err);
  } finally {
    if (pool) {
      await pool.close();
    }
  }
}

main();
