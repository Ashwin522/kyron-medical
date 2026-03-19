import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
    BLAND_API_KEY: process.env.BLAND_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GMAIL_USER: process.env.GMAIL_USER,
    GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,
  },
};

export default nextConfig;
