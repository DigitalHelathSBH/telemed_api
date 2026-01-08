const client = require("../clients/telepharmaClient");
const { telepharma } = require("../config/endpoints");

function withTransactionId(pathTemplate, transaction_id) {
  return pathTemplate.replace(":transaction_id", encodeURIComponent(transaction_id));
}

/**
 * 1) Register
 * POST /telemed-center/register-appointment
 */
async function registerAppointment(payload) {
  try {
    const res = await client.post(telepharma.paths.register, payload);
    return res.data;
  } catch (err) {
    const status = err?.response?.status;
    const data = err?.response?.data;
    const headers = err?.response?.headers;

    console.error("REGISTER ERROR STATUS:", status);
    console.error("REGISTER ERROR DATA:", JSON.stringify(data, null, 2));
    // ถ้าต้องการดู header ด้วย (บางทีบอก required fields)
    // console.error("REGISTER ERROR HEADERS:", headers);

    // ดู payload ที่ส่ง (สำคัญมาก)
    console.error("REGISTER PAYLOAD SENT:", JSON.stringify(payload, null, 2));

    throw err; // ให้ JOB จับได้ว่า fail
  }
}


/**
 * 2) Update (รอคุณส่ง logic มาเติม)
 * ส่วนใหญ่จะเป็น PUT หรือ PATCH แล้วแต่ API ปลายทาง
 */
async function updateAppointment(transaction_id, payload) {
  const path = telepharma.paths.update.replace(
    ":transaction_id",
    encodeURIComponent(transaction_id)
  );

  const res = await client.put(path, payload);
  return res.data;
}

/**
 * 3) Check status (conference list)
 * โดยมากเป็น GET (บางระบบเป็น POST) รอคอนเฟิร์มจากคุณ/สเปค
 */
async function getConferenceList({ appointment_date, transaction_id }) {
  const res = await client.get(telepharma.paths.conferenceList, {
    params: { appointment_date, transaction_id },
  });
  return res.data;
}

/**
 * 4) Cancel
 * อาจเป็น DELETE หรือ PATCH/PUT แล้วแต่สเปค
 */
async function cancelAppointment(transaction_id, payload = null) {
  const path = withTransactionId(telepharma.paths.cancel, transaction_id);

  // TODO: ถ้าสเปคเป็น DELETE:
  // const res = await client.delete(path);

  // ตัวอย่างใช้ PATCH (ยืดหยุ่นสุด) ถ้าต้องส่งเหตุผลยกเลิก
  const res = await client.patch(path, payload);
  return res.data;
}

module.exports = {
  registerAppointment,
  updateAppointment,
  getConferenceList,
  cancelAppointment,
};
