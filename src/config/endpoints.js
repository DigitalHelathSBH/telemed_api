module.exports = {
  telepharma: {
    baseURL: process.env.TELEPHARMA_BASE_URL,
    paths: {
      register: "/telemed-center/register-appointment",
      update: "/telemed-center/appointment/:transaction_id",
      cancel: "/telemed-center/appointment/:transaction_id",
      conferenceList: "/telemed-center/conference-list",
    },
  },
};
