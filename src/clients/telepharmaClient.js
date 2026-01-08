require("dotenv").config();
const axios = require("axios");
const https = require("https");
const { telepharma } = require("../config/endpoints");

const rejectUnauthorized = !(String(process.env.TLS_REJECT_UNAUTHORIZED).toLowerCase() === "false");
const httpsAgent = new https.Agent({ rejectUnauthorized });

const client = axios.create({
  baseURL: telepharma.baseURL,
  timeout: 30000,
  httpsAgent,
  headers: {
    "Content-Type": "application/json; charset=UTF-8",
    Accept: "application/json",
    hospitalkey: process.env.HOSPITAL_KEY,
  },
});

module.exports = client;
