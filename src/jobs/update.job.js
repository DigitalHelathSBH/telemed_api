require("dotenv").config();
const sql = require("mssql");
const { updateAppointment } = require("../services/telemedCenter.service");

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT || 1433),
    database: process.env.DB_NAME,
    options: { encrypt: false, trustServerCertificate: true },
};

function mapToUpdatePayload(row) {
    return {
        hn: row.HN,
        vn: row.VN,
        patient_cid: row.patient_cid,
        account_title: row.account_title,
        first_name: row.first_name,
        last_name: row.last_name,
        doctor_cid: row.doctor_cid,
        doctor_title: "แพทย์",
        doctor_firstname: row.doctor_firstname,
        doctor_lastname: row.doctor_lastname,
        birth_date: row.birth_date,
        phone_number: row.phone_number,
        phone_number_other: "",
        appointment_date: row.appointment_date,
        appointment_type_name: "Telemedicine",
        hospital_code: "10661",
        hospital_name: "โรงพยาบาลสระบุรี",
        hospital_department_name: row.hospital_department_name,
        hospital_room_name: "Telemedicine",
        time_start: row.time_start,
        time_end: row.time_end,
        require_type: "patient",
        address_detail: {
            province: row.province,
            district: row.district,
            sub_district: row.sub_district,
            road: "",
            moo: row.moo,
            house_no: "",
            zip_code: row.zip_code,
            landmark: "",
            lat: "",
            lng: "",
        },
        address_detail_health_rider: {
            province: "",
            district: "",
            sub_district: "",
            road: "",
            moo: "",
            house_no: "",
            zip_code: "",
            landmark: "",
            lat: "",
            lng: "",
        },
    };
}

async function main() {
    let pool;
    try {
    pool = await sql.connect(dbConfig);

    const query = `
    SELECT HNAPPMNT.HN
            ,VNPRES.VN
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
            ,LEFT(replace(replace(PATIENT_ADDRESS.TEL, '-', ''), ' ', ''),'10') as phone_number
            ,replace(convert(varchar, APPOINTMENTDATETIME, 111), '/', '-') as appointment_date
            ,ClinicName as hospital_department_name
            ,CONVERT(varchar(5), APPOINTMENTDATETIME, 108) as time_start
            ,CONVERT(varchar(5), DATEADD(MINUTE, NOMINUTESALLOWANCELATE, CONVERT(time,APPOINTMENTDATETIME)),108) as time_end
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
    join VNPRES ON HNAPPMNT.APPOINTMENTNO = VNPRES.APPOINTMENTNO 
    WHERE PROCEDURECODE = 'T' and transaction_id is not null
    AND TelemedStatus = 'S'
    AND (HNAPPMNT.CONFIRMSTATUSTYPE != '6' or HNAPPMNT.CONFIRMSTATUSTYPE is null) 
    AND VNPRES.VISITDATE  >= CONVERT(date,getdate())
    `;

    const rs = await pool.request().query(query);
    console.log("UPDATE ROW COUNT:", rs.recordset.length);

        for (const row of rs.recordset) {
            try {
                const payload = mapToUpdatePayload(row);
                const tempData = await updateAppointment(row.transaction_id, payload);

                if (tempData?.status === "success") {
                    console.log("UPDATE SUCCESS:", row.APPOINTMENTNO, row.transaction_id);
                } else {
                    const msg = tempData?.message ?? "update fail";
                    console.warn("UPDATE FAIL:", row.APPOINTMENTNO, msg);
                }
            } catch (err) {
                console.error("UPDATE API ERROR:", row.APPOINTMENTNO);
                console.error("HTTP:", err?.response?.status);
                console.error("BODY:", JSON.stringify(err?.response?.data, null, 2));
                continue;
            }
        }
    } catch (err) {
        console.error("JOB ERROR:", err?.message || err);
        process.exitCode = 1;
    } finally {
        try { await sql.close(); } catch {}
    }
}

if (require.main === module) {
    main();
}
