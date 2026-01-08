require("dotenv").config();
const sql = require("mssql");
const { getConferenceList } = require("../services/telemedCenter.service");

const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT || 1433),
    database: process.env.DB_NAME,
    options: {
        encrypt: false,
        trustServerCertificate: true,
    },
};

function mapTelemedStatus(confirm) {
    const s = String(confirm || "").trim();
    if (s === "waiting_confirm") return null;
    if (s === "answered_not_available") return "C";
    if (s === "answered_available") return "Y";
    return null;
}

function mapTelemedStatusAct(active) {
    const s = String(active || "").trim();
    if (s === "pending") return "P";
    if (s === "waiting_conference") return "S";
    if (s === "complete") return "Y";
    if (s === "cancel") return "C";
    return null;
}

function extractFromApi(apiData, wantedTransactionId) {
    const arr = apiData?.result?.data;

    if (!Array.isArray(arr)) {
        return { confirmation_contact_status: null, status_active: null };
    }

    const item = wantedTransactionId
        ? arr.find(x => x?.transaction_id === wantedTransactionId) || null
        : arr[0] || null;

    return {
        confirmation_contact_status: item?.confirmation_contact_status ?? null,
        status_active: item?.status_active ?? null,
    };
}

async function main() {
    let pool;

    try {
        pool = await sql.connect(dbConfig);

        const query = `
        SELECT
            HNAPPMNT.APPOINTMENTNO,
            HNAPPMNT.transaction_id,
            replace(convert(varchar, HNAPPMNT.APPOINTMENTDATETIME, 111), '/', '-') as appointment_date,
            CONVERT(date, DATEADD(DAY, -1, HNAPPMNT.APPOINTMENTDATETIME)) AS appointment_date_minus1
        FROM HNAPPMNT
        WHERE HNAPPMNT.transaction_id IS NOT NULL
            AND PROCEDURECODE = 'T'
            AND (HNAPPMNT.CONFIRMSTATUSTYPE != '6' or HNAPPMNT.CONFIRMSTATUSTYPE is null) 
            AND CONVERT(date, HNAPPMNT.APPOINTMENTDATETIME) > CONVERT(date, GETDATE()) 
            AND TelemedStatus = 'S' 
            AND (TelemedStatusAct not in ('C','Y') OR TelemedStatusAct IS NULL)
        `;

        const rs = await pool.request().query(query);
        console.log("CONFERENCE-LIST ROW COUNT:", rs.recordset.length);

        let updatedStatus = 0;
        let updatedAct = 0;
        let skipped = 0;
        let failed = 0;

        for (const row of rs.recordset) {
        try {

            const apiData = await getConferenceList({
            appointment_date: row.appointment_date,  
            transaction_id: row.transaction_id,
            });

            const { confirmation_contact_status, status_active } = extractFromApi(apiData, row.transaction_id);

            const TelemedStatus = mapTelemedStatus(confirmation_contact_status);

            if (!TelemedStatus) {
            skipped++;
            console.log("SKIP (waiting_confirm/unknown):", row.APPOINTMENTNO, confirmation_contact_status);
            continue;
            }

            await pool.request()
            .input("TelemedStatus", sql.VarChar(1), TelemedStatus)
            .input("APPOINTMENTNO", sql.VarChar, row.APPOINTMENTNO)
            .query(`
                UPDATE HNAPPMNT
                SET TelemedStatus = @TelemedStatus
                WHERE APPOINTMENTNO = @APPOINTMENTNO
            `);

            updatedStatus++;
            console.log("UPDATED TelemedStatus:", row.APPOINTMENTNO, TelemedStatus);

            if (TelemedStatus !== "Y") {
            continue;
            }

            const TelemedStatusAct = mapTelemedStatusAct(status_active);

            if (!TelemedStatusAct) {

            console.warn("NO MAP status_active => SKIP ACT:", row.APPOINTMENTNO, status_active);
            continue;
            }

            await pool.request()
            .input("TelemedStatusAct", sql.VarChar(1), TelemedStatusAct)
            .input("APPOINTMENTNO", sql.VarChar, row.APPOINTMENTNO)
            .query(`
                UPDATE HNAPPMNT
                SET TelemedStatusAct = @TelemedStatusAct
                WHERE APPOINTMENTNO = @APPOINTMENTNO
            `);

            updatedAct++;
            console.log("UPDATED TelemedStatusAct:", row.APPOINTMENTNO, TelemedStatusAct);

        } catch (err) {
            failed++;
            console.error("CONFERENCE API ERROR:", row.APPOINTMENTNO, row.transaction_id);
            console.error("HTTP:", err?.response?.status);
            console.error("BODY:", JSON.stringify(err?.response?.data, null, 2));
            continue;
        }
        }

        console.log(
        `CONFERENCE SUMMARY => updatedStatus=${updatedStatus}, updatedAct=${updatedAct}, skipped=${skipped}, failed=${failed}`
        );

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
