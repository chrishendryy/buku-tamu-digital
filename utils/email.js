// backend/utils/email.js
import Brevo from "@getbrevo/brevo";

export const sendEmail = async (to, subject, text) => {
  try {
    const apiInstance = new Brevo.TransactionalEmailsApi();

    apiInstance.setApiKey(
      Brevo.TransactionalEmailsApiApiKeys.apiKey,
      process.env.BREVO_API_KEY
    );

    const sendSmtpEmail = {
      sender: {
        name: "Buku Tamu Digital",
        email: "magangukri2025@gmail.com",
      },
      to: [{ email: to }],
      subject: subject,
      textContent: text,
    };

    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);

    console.log("📨 Email terkirim (Brevo API):", result.messageId);
    return result;

  } catch (error) {
    console.error("❌ Email API Error:", error);
    throw error;
  }
};
